import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { constants, DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

import { config } from '../config.ts';
import { db as mainDb } from '../db.ts';
import { ApiError } from '../http.ts';
import { logError } from '../log.ts';
import { backupDatabase } from '../migrations.ts';

/**
 * Admin database browser: introspection, read-only browsing and console, guarded writes with
 * backups + audit, and secret masking. Reads use a SEPARATE read-only connection (node:sqlite
 * `readOnly`, Node ≥ 22.12) with an authorizer; console queries run in a worker so a slow query can
 * be stopped (node:sqlite has no interrupt()). Writes use a dedicated write connection.
 */

export const DB_FILE = () => path.join(config.dataDir, 'app.db');
export const MASK = '••••';
export const PAGE_SIZE = 50;
export const CONSOLE_MAX_ROWS = 1000;
export const CONSOLE_TIMEOUT_MS = 5000;
export const WRITE_WINDOW_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Connections

let readConn: DatabaseSync | null = null;
/** Browsing connection: read-only file open + authorizer that allows reads only. */
export function readDb(): DatabaseSync {
  if (readConn?.isOpen) return readConn;
  readConn = new DatabaseSync(DB_FILE(), { readOnly: true, timeout: 5000 });
  readConn.setAuthorizer(readOnlyAuthorizer);
  return readConn;
}

let writeConn: DatabaseSync | null = null;
function writeDb(): DatabaseSync {
  if (writeConn?.isOpen) return writeConn;
  writeConn = new DatabaseSync(DB_FILE(), { timeout: 5000 });
  writeConn.exec('PRAGMA foreign_keys = ON');
  return writeConn;
}

/** For tests: drop cached connections (e.g. after DATA_DIR changes). */
export function closeDbBrowser() {
  readConn?.close();
  writeConn?.close();
  readConn = writeConn = null;
}

const READ_OK = new Set([
  constants.SQLITE_SELECT,
  constants.SQLITE_READ,
  constants.SQLITE_FUNCTION,
  constants.SQLITE_RECURSIVE,
]);
/** Introspection pragmas used internally (only via the helpers below). */
const SAFE_PRAGMAS = new Set([
  'table_info',
  'index_list',
  'index_info',
  'foreign_key_list',
  'user_version',
]);

function readOnlyAuthorizer(code: number, a1: string | null, a2: string | null): number {
  if (code === constants.SQLITE_FUNCTION && a2 && /^load_extension$/i.test(a2))
    return constants.SQLITE_DENY;
  if (READ_OK.has(code)) return constants.SQLITE_OK;
  // Introspection pragmas only (table_info etc.); a second argument would be an assignment.
  if (code === constants.SQLITE_PRAGMA && a1 && SAFE_PRAGMAS.has(a1.toLowerCase()))
    return constants.SQLITE_OK;
  return constants.SQLITE_DENY;
}

// ---------------------------------------------------------------------------
// Introspection

export type Column = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export function tableNames(): string[] {
  return (
    readDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

export function assertTable(name: string): string {
  if (!IDENT.test(name) || !tableNames().includes(name))
    throw new ApiError(404, `No table named ${name}.`);
  return name;
}

export const columnsOf = (table: string) =>
  readDb()
    .prepare(`PRAGMA table_info(${q(table)})`)
    .all() as unknown as Column[];

export function indexesOf(table: string) {
  const list = readDb()
    .prepare(`PRAGMA index_list(${q(table)})`)
    .all() as {
    name: string;
    unique: number;
    origin: string;
  }[];
  return list.map((ix) => ({
    name: ix.name,
    unique: !!ix.unique,
    origin: ix.origin,
    columns: (
      readDb()
        .prepare(`PRAGMA index_info(${q(ix.name)})`)
        .all() as { name: string | null }[]
    ).map((c) => c.name ?? '(expression)'),
  }));
}

export type Relation = {
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  inferred: boolean;
};

/** Declared foreign keys plus inferred `<x>_id → <x>s.id` links (marked inferred). */
export function relations(): Relation[] {
  const tables = tableNames();
  const out: Relation[] = [];
  for (const t of tables) {
    const declared = readDb()
      .prepare(`PRAGMA foreign_key_list(${q(t)})`)
      .all() as {
      table: string;
      from: string;
      to: string | null;
    }[];
    for (const fk of declared)
      out.push({
        from: t,
        fromColumn: fk.from,
        to: fk.table,
        toColumn: fk.to ?? 'id',
        inferred: false,
      });
    for (const c of columnsOf(t)) {
      const m = /^(\w+)_id$/.exec(c.name);
      if (!m) continue;
      const target = `${m[1]}s`;
      if (!tables.includes(target) || !columnsOf(target).some((x) => x.name === 'id')) continue;
      if (out.some((r) => r.from === t && r.fromColumn === c.name)) continue;
      out.push({ from: t, fromColumn: c.name, to: target, toColumn: 'id', inferred: true });
    }
  }
  return out;
}

export function tableSummaries() {
  const sizes = new Map<string, number>();
  try {
    for (const r of readDb()
      .prepare('SELECT name, SUM(pgsize) AS size FROM dbstat GROUP BY name')
      .all() as {
      name: string;
      size: number;
    }[])
      sizes.set(r.name, r.size);
  } catch {
    // dbstat isn't compiled into every SQLite build; sizes are then omitted.
  }
  return tableNames().map((name) => ({
    name,
    rows: (
      readDb()
        .prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`)
        .get() as { n: number }
    ).n,
    size: sizes.get(name) ?? null,
  }));
}

export const dbFileSize = () =>
  ['app.db', 'app.db-wal']
    .map((f) => path.join(config.dataDir, f))
    .filter((f) => existsSync(f))
    .reduce((n, f) => n + statSync(f).size, 0);

// ---------------------------------------------------------------------------
// Secrets: masked everywhere, never editable

const ALWAYS_MASKED: Record<string, string[]> = {
  users: ['spotify_tokens', 'openrouter_key'],
  admin_account: ['password_hash'],
  sessions: ['token_hash'],
};
/** Secret-looking names; a bare `key` (setting / prompt names) is not a secret. */
const SECRET_NAME = /(secret|token|password|hash|_key)$/i;

export function isMaskedColumn(table: string | null, column: string | null) {
  if (!column) return false;
  if (table && ALWAYS_MASKED[table]?.includes(column)) return true;
  return SECRET_NAME.test(column) || /(^|_)tokens?$/i.test(column);
}

/** Encrypted values ("v1:<base64>", see crypto.ts) are secrets wherever they appear. */
const looksEncrypted = (v: unknown) =>
  typeof v === 'string' && /^"?v1:[A-Za-z0-9+/=]{16,}"?$/.test(v); // also JSON-quoted (server_settings)

export function maskValue(table: string | null, column: string | null, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (isMaskedColumn(table, column) || looksEncrypted(value)) return MASK;
  return value;
}

export function maskRow(table: string, row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, maskValue(table, k, v)]));
}

/** Columns whose values are JSON documents (pretty-printed in the UI, validated on save). */
const JSON_COLUMNS: Record<string, string[]> = {
  users: ['settings', 'spotify_profile', 'spotify_access'],
  jobs: ['request', 'candidates', 'result', 'prompt_versions'],
  server_settings: ['value'],
  db_audit: ['before_json', 'after_json'],
};
export const isJsonColumn = (table: string, column: string) =>
  JSON_COLUMNS[table]?.includes(column) ?? false;

// ---------------------------------------------------------------------------
// Browsing (Data tab)

export type FilterOp = 'contains' | 'eq' | 'empty' | 'notempty' | 'gt' | 'lt';
export type Filter = { column: string; op: FilterOp; value: string };
const OPS: FilterOp[] = ['contains', 'eq', 'empty', 'notempty', 'gt', 'lt'];

/** Parses `f.<col>=<op>:<value>` query params. */
export function parseFilters(query: Record<string, string>, columns: Column[]): Filter[] {
  const names = new Set(columns.map((c) => c.name));
  const out: Filter[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('f.')) continue;
    const column = k.slice(2);
    const i = v.indexOf(':');
    const op = (i < 0 ? v : v.slice(0, i)) as FilterOp;
    if (!names.has(column) || !OPS.includes(op)) continue;
    out.push({ column, op, value: i < 0 ? '' : v.slice(i + 1) });
  }
  return out;
}

export function browse(
  table: string,
  opts: { filters: Filter[]; sort?: string; dir?: 'asc' | 'desc'; page?: number },
) {
  const columns = columnsOf(table);
  const names = columns.map((c) => c.name);
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  for (const f of opts.filters) {
    if (!names.includes(f.column)) continue;
    // Filtering on a secret would leak it a character at a time.
    if (isMaskedColumn(table, f.column) && f.op !== 'empty' && f.op !== 'notempty') {
      throw new ApiError(
        400,
        `${f.column} is a secret column and can only be filtered by empty / not empty.`,
      );
    }
    const col = q(f.column);
    if (f.op === 'contains') {
      where.push(`CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`);
      params.push(`%${f.value.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    } else if (f.op === 'eq') {
      where.push(`${col} = ?`);
      params.push(f.value);
    } else if (f.op === 'empty') where.push(`(${col} IS NULL OR ${col} = '')`);
    else if (f.op === 'notempty') where.push(`(${col} IS NOT NULL AND ${col} != '')`);
    else {
      where.push(`${col} ${f.op === 'gt' ? '>' : '<'} ?`);
      params.push(
        Number.isFinite(Number(f.value)) && f.value.trim() !== '' ? Number(f.value) : f.value,
      );
    }
  }
  // Sorting by a secret would leak its order, so masked columns aren't sortable.
  const sort =
    opts.sort && names.includes(opts.sort) && !isMaskedColumn(table, opts.sort) ? opts.sort : null;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    readDb()
      .prepare(`SELECT COUNT(*) AS n FROM ${q(table)} ${whereSql}`)
      .get(...params) as { n: number }
  ).n;
  const order = sort
    ? `ORDER BY ${q(sort)} ${opts.dir === 'desc' ? 'DESC' : 'ASC'}`
    : 'ORDER BY rowid';
  const rows = readDb()
    .prepare(`SELECT rowid AS __rowid, * FROM ${q(table)} ${whereSql} ${order} LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as Record<string, unknown>[];
  return {
    columns,
    rows: rows.map((r) => maskRow(table, r)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

// ---------------------------------------------------------------------------
// Statement checks (allowlist)

export type StatementKind = 'read' | 'write';

/** Removes comments and string/identifier literals so keywords can be checked safely. */
export function stripLiterals(sql: string) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      out += ch === "'" ? " '' " : ' "x" ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const BLOCKED = /\b(attach|detach|pragma|vacuum|load_extension|reindex|analyze)\b/i;
const READ_START = /^(select|with|values|explain)\b/i;
const WRITE_START = /^(insert|update|delete)\b/i;

/**
 * Allowlist check for console SQL: exactly one statement whose first keyword is a read
 * (SELECT/WITH/VALUES/EXPLAIN) or, in write mode, INSERT/UPDATE/DELETE. Throws a clear 400 otherwise.
 */
export function classifyStatement(sql: string): { kind: StatementKind; sql: string } {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new ApiError(400, 'Enter a SQL statement.');
  if (trimmed.length > 20_000) throw new ApiError(400, 'That statement is too long.');
  const bare = stripLiterals(trimmed).trim();
  if (bare.includes(';'))
    throw new ApiError(400, 'Run one statement at a time (no “;” between statements).');
  const blocked = BLOCKED.exec(bare);
  if (blocked) {
    throw new ApiError(
      400,
      `${blocked[1].toUpperCase()} isn’t allowed here. Schema and maintenance changes go through migrations.`,
    );
  }
  if (/\bsqlite_(master|schema|temp_master|sequence)\b/i.test(bare) && !READ_START.test(bare)) {
    throw new ApiError(400, 'SQLite’s internal tables can’t be changed.');
  }
  if (READ_START.test(bare)) return { kind: 'read', sql: trimmed };
  if (WRITE_START.test(bare)) return { kind: 'write', sql: trimmed };
  const first = /^\s*(\w+)/.exec(bare)?.[1]?.toUpperCase() ?? 'that';
  throw new ApiError(
    400,
    `${first} statements aren’t allowed. Use SELECT / WITH (read) or, in write mode, INSERT / UPDATE / DELETE. Schema changes go through migrations.`,
  );
}

/** Secret columns mentioned by name in a statement (selecting/filtering/writing them is refused). */
export function mentionedSecrets(sql: string): string[] {
  const bare = stripLiterals(sql);
  const found = new Set<string>();
  const words = bare.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const t of tableNames()) {
    for (const c of columnsOf(t)) {
      if (
        isMaskedColumn(t, c.name) &&
        words.some((w) => w.toLowerCase() === c.name.toLowerCase())
      ) {
        found.add(c.name);
      }
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Console: reads in a worker (stoppable), masked by result-column origin

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
};

type WorkerReply =
  | {
      ok: true;
      columns: { name: string; table: string | null; column: string | null }[];
      rows: unknown[][];
      truncated: boolean;
    }
  | { ok: false; error: string };

/**
 * Node flags a worker needs (loaders, warnings, experimental features), taken from the parent's.
 * An allowlist, not a pass-through: --watch, --test, --inspect and runner-injected flags are invalid
 * in workers (ERR_WORKER_INVALID_EXEC_ARGV) and made console queries fail under `npm run dev`.
 */
const WORKER_FLAG =
  /^--(import|require|loader|experimental-loader|conditions|disable-warning|no-warnings|no-deprecation|experimental-[\w-]+|no-experimental-[\w-]+|enable-source-maps)(=|$)/;
const TAKES_VALUE = /^--(import|require|loader|experimental-loader|conditions|disable-warning)$/;

export function workerExecArgv(parent: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < parent.length; i++) {
    const arg = parent[i];
    const takesValue = TAKES_VALUE.test(arg) && i + 1 < parent.length;
    if (WORKER_FLAG.test(arg)) {
      out.push(arg);
      if (takesValue) out.push(parent[++i]);
    } else if (
      /^--[\w-]+$/.test(arg) &&
      /^--(watch-path|watch-kill-signal|inspect-port|debug-port|test-[\w-]+)$/.test(arg)
    ) {
      i++; // drop the flag's value too
    }
  }
  return out;
}

/** A worker start/run failure as a non-empty, logged message. */
function workerFailure(e: unknown): string {
  const err = e as { message?: string; code?: string; name?: string };
  const message = err?.message?.trim() || err?.code || err?.name || 'unknown error';
  logError('db console worker', e);
  return `The query couldn’t run (${message}).`;
}

export async function runReadQuery(sql: string): Promise<QueryResult> {
  const { kind, sql: statement } = classifyStatement(sql);
  if (kind !== 'read')
    throw new ApiError(400, 'That statement changes data: turn on write mode to run it.');
  const secrets = mentionedSecrets(statement);
  if (secrets.length) {
    throw new ApiError(
      400,
      `${secrets.join(', ')} ${secrets.length > 1 ? 'are secret columns' : 'is a secret column'} and can’t be selected or filtered on. SELECT * shows ${secrets.length > 1 ? 'them' : 'it'} masked.`,
    );
  }
  const started = performance.now();
  const reply = await new Promise<WorkerReply>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./db-query-worker.ts', import.meta.url), {
        workerData: { file: DB_FILE(), sql: statement, maxRows: CONSOLE_MAX_ROWS },
        // Not the parent's flags verbatim: --watch & co. are invalid in workers (ERR_WORKER_INVALID_EXEC_ARGV).
        execArgv: workerExecArgv(process.execArgv),
      });
    } catch (e) {
      resolve({ ok: false, error: workerFailure(e) });
      return;
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({
        ok: false,
        error: `The query took longer than ${CONSOLE_TIMEOUT_MS / 1000} s and was stopped.`,
      });
    }, CONSOLE_TIMEOUT_MS);
    // Under `node --watch` the module loader also posts {"watch:import": …} messages on this
    // channel; only our own reply (it has `ok`) counts.
    worker.on('message', (m: unknown) => {
      if (!m || typeof m !== 'object' || !('ok' in m)) return;
      clearTimeout(timer);
      void worker.terminate();
      resolve(m as WorkerReply);
    });
    worker.once('error', (e: Error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: workerFailure(e) });
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      // Only reached if the worker died without replying (message/error resolve first).
      resolve({ ok: false, error: `The query worker stopped unexpectedly (exit code ${code}).` });
    });
  });
  if (!reply.ok) throw new ApiError(400, reply.error);
  const rows = reply.rows.map((r) =>
    r.map((v, i) => maskValue(reply.columns[i].table, reply.columns[i].column, v)),
  );
  return {
    columns: reply.columns.map((c) => c.name),
    rows,
    rowCount: rows.length,
    truncated: reply.truncated,
    durationMs: Math.round(performance.now() - started),
  };
}

/** CSV with every value already masked. */
export function toCsv(result: Pick<QueryResult, 'columns' | 'rows'>) {
  const cell = (v: unknown) => {
    const s =
      v === null || v === undefined
        ? ''
        : typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean' ||
            typeof v === 'bigint'
          ? String(v)
          : JSON.stringify(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    result.columns.map(cell).join(','),
    ...result.rows.map((r) => r.map(cell).join(',')),
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Write mode: per admin session, 15 minutes, backup before the first write

const writeWindows = new Map<string, { until: number; backedUp: boolean }>();

export function openWriteWindow(sessionKey: string) {
  writeWindows.set(sessionKey, { until: Date.now() + WRITE_WINDOW_MS, backedUp: false });
  return writeWindowState(sessionKey);
}
export const closeWriteWindow = (sessionKey: string) => writeWindows.delete(sessionKey);
export function writeWindowState(sessionKey: string) {
  const w = writeWindows.get(sessionKey);
  if (!w || w.until <= Date.now()) {
    writeWindows.delete(sessionKey);
    return { on: false as const };
  }
  return { on: true as const, until: w.until, backedUp: w.backedUp };
}

function requireWriteWindow(sessionKey: string) {
  const w = writeWindows.get(sessionKey);
  if (!w || w.until <= Date.now())
    throw new ApiError(403, 'Turn on write mode first (re-enter your password).');
  if (!w.backedUp) {
    try {
      backupDatabase(mainDb, config.dataDir, 'dbadmin');
    } catch (e) {
      throw new ApiError(
        500,
        `Couldn’t back up the database before writing, so nothing was changed: ${(e as Error).message}`,
      );
    }
    w.backedUp = true;
  }
}

// ---------------------------------------------------------------------------
// Audit

function audit(entry: {
  admin: string;
  table: string;
  rowKey: unknown;
  action: string;
  before: unknown;
  after: unknown;
  sql: string;
}) {
  writeDb()
    .prepare(
      `INSERT INTO db_audit (at, admin, table_name, row_key, action, before_json, after_json, sql)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Date.now(),
      entry.admin,
      entry.table,
      JSON.stringify(entry.rowKey),
      entry.action,
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
      entry.sql,
    );
}

export function auditLog(opts: { table?: string; action?: string; page?: number }) {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (opts.table) {
    where.push('table_name = ?');
    params.push(opts.table);
  }
  if (opts.action) {
    where.push('action = ?');
    params.push(opts.action);
  }
  const page = Math.max(1, opts.page ?? 1);
  return readDb()
    .prepare(
      `SELECT * FROM db_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as {
    id: number;
    at: number;
    admin: string;
    table_name: string;
    row_key: string;
    action: string;
    before_json: string | null;
    after_json: string | null;
    sql: string;
  }[];
}

// ---------------------------------------------------------------------------
// Row writes (drawer)

const PROTECTED_TABLES = new Set(['db_audit']);

function writableTable(table: string) {
  assertTable(table);
  if (PROTECTED_TABLES.has(table)) throw new ApiError(400, 'The audit log can’t be edited.');
  return table;
}

function checkValues(table: string, values: Record<string, unknown>) {
  const cols = columnsOf(table);
  for (const [k, v] of Object.entries(values)) {
    if (!cols.some((c) => c.name === k)) throw new ApiError(400, `${table} has no column ${k}.`);
    if (isMaskedColumn(table, k))
      throw new ApiError(400, `${k} is a secret column and can’t be edited here.`);
    if (looksEncrypted(v)) throw new ApiError(400, `Encrypted values can’t be edited here.`);
    if (v !== null && typeof v === 'object')
      throw new ApiError(400, `${k}: send JSON columns as text.`);
    if (isJsonColumn(table, k) && typeof v === 'string' && v.trim() !== '') {
      try {
        JSON.parse(v);
      } catch {
        throw new ApiError(400, `${k} must be valid JSON.`);
      }
    }
  }
  return values as Record<string, SQLInputValue>;
}

function inTransaction<T>(fn: (conn: DatabaseSync) => T): T {
  const conn = writeDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(conn);
    conn.exec('COMMIT');
    return out;
  } catch (e) {
    conn.exec('ROLLBACK');
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, (e as Error).message);
  }
}

const rowById = (conn: DatabaseSync, table: string, rowid: number) =>
  conn.prepare(`SELECT rowid AS __rowid, * FROM ${q(table)} WHERE rowid = ?`).get(rowid) as
    Record<string, unknown> | undefined;

export function updateRow(
  sessionKey: string,
  admin: string,
  table: string,
  rowid: number,
  values: Record<string, unknown>,
) {
  writableTable(table);
  const vals = checkValues(table, values);
  const keys = Object.keys(vals);
  if (!keys.length) throw new ApiError(400, 'Nothing to change.');
  requireWriteWindow(sessionKey);
  const sql = `UPDATE ${q(table)} SET ${keys.map((k) => `${q(k)} = ?`).join(', ')} WHERE rowid = ?`;
  return inTransaction((conn) => {
    const before = rowById(conn, table, rowid);
    if (!before) throw new ApiError(404, 'That row no longer exists.');
    conn.prepare(sql).run(...keys.map((k) => vals[k]), rowid);
    const after = rowById(conn, table, rowid)!;
    audit({
      admin,
      table,
      rowKey: { rowid },
      action: 'update',
      before: maskRow(table, before),
      after: maskRow(table, after),
      sql,
    });
    return maskRow(table, after);
  });
}

export function insertRow(
  sessionKey: string,
  admin: string,
  table: string,
  values: Record<string, unknown>,
) {
  writableTable(table);
  const vals = checkValues(table, values);
  const keys = Object.keys(vals);
  requireWriteWindow(sessionKey);
  const sql = keys.length
    ? `INSERT INTO ${q(table)} (${keys.map(q).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    : `INSERT INTO ${q(table)} DEFAULT VALUES`;
  return inTransaction((conn) => {
    const res = conn.prepare(sql).run(...keys.map((k) => vals[k]));
    const after = rowById(conn, table, Number(res.lastInsertRowid))!;
    audit({
      admin,
      table,
      rowKey: { rowid: Number(res.lastInsertRowid) },
      action: 'insert',
      before: null,
      after: maskRow(table, after),
      sql,
    });
    return maskRow(table, after);
  });
}

export function deleteRow(sessionKey: string, admin: string, table: string, rowid: number) {
  writableTable(table);
  requireWriteWindow(sessionKey);
  const sql = `DELETE FROM ${q(table)} WHERE rowid = ?`;
  inTransaction((conn) => {
    const before = rowById(conn, table, rowid);
    if (!before) throw new ApiError(404, 'That row no longer exists.');
    conn.prepare(sql).run(rowid);
    audit({
      admin,
      table,
      rowKey: { rowid },
      action: 'delete',
      before: maskRow(table, before),
      after: null,
      sql,
    });
  });
}

// ---------------------------------------------------------------------------
// Console writes: INSERT / UPDATE / DELETE with COUNT preview and confirmation

type ParsedWrite = { action: 'insert' | 'update' | 'delete'; table: string; where: string | null };

/** Target table and WHERE clause of a single INSERT/UPDATE/DELETE (literals masked while searching). */
export function parseWrite(sql: string): ParsedWrite {
  const bare = stripLiterals(sql);
  let m = /^\s*insert\s+(?:or\s+\w+\s+)?into\s+("?)([A-Za-z_]\w*)\1/i.exec(bare);
  if (m) return { action: 'insert', table: m[2], where: null };
  m = /^\s*update\s+(?:or\s+\w+\s+)?("?)([A-Za-z_]\w*)\1\s+set\b/i.exec(bare);
  const isUpdate = !!m;
  if (!m) m = /^\s*delete\s+from\s+("?)([A-Za-z_]\w*)\1/i.exec(bare);
  if (!m) throw new ApiError(400, 'Couldn’t read the target table of that statement.');
  const table = m[2];
  // The WHERE clause is reused verbatim for the COUNT preview and the audit's before-rows.
  const whereAt = findTopLevelWhere(sql);
  const tail = whereAt < 0 ? null : sql.slice(whereAt + 5).trim();
  if (/\b(returning|order\s+by|limit)\b/i.test(tail ? stripLiterals(tail) : '')) {
    throw new ApiError(400, 'RETURNING / ORDER BY / LIMIT aren’t supported in console writes.');
  }
  return { action: isUpdate ? 'update' : 'delete', table, where: tail };
}

function findTopLevelWhere(sql: string): number {
  let i = 0;
  let depth = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      i++;
      while (i < sql.length && !(sql[i] === close && sql[i + 1] !== close))
        i += sql[i] === close ? 2 : 1;
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && /^where\b/i.test(sql.slice(i)) && (i === 0 || /\s/.test(sql[i - 1])))
      return i;
    i++;
  }
  return -1;
}

export function previewWrite(sql: string) {
  const { kind, sql: statement } = classifyStatement(sql);
  if (kind !== 'write') throw new ApiError(400, 'Only INSERT / UPDATE / DELETE run in write mode.');
  const secrets = mentionedSecrets(statement);
  if (secrets.length)
    throw new ApiError(
      400,
      `${secrets.join(', ')}: secret columns can’t be written from the console.`,
    );
  const parsed = parseWrite(statement);
  writableTable(parsed.table);
  if (parsed.action === 'insert')
    return { ...parsed, sql: statement, affected: null as number | null };
  const count = (
    readDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM ${q(parsed.table)}${parsed.where ? ` WHERE ${parsed.where}` : ''}`,
      )
      .get() as { n: number }
  ).n;
  return { ...parsed, sql: statement, affected: count };
}

export function runWrite(
  sessionKey: string,
  admin: string,
  sql: string,
  opts: { affectAll: boolean },
): { changes: number; sql: string } {
  const p = previewWrite(sql);
  if (p.action !== 'insert' && !p.where && !opts.affectAll) {
    throw new ApiError(
      400,
      `${p.action.toUpperCase()} without WHERE would change every row. Tick “affect all rows” to do that.`,
    );
  }
  requireWriteWindow(sessionKey);
  return inTransaction((conn) => {
    const sel = `SELECT rowid AS __rowid, * FROM ${q(p.table)}${p.where ? ` WHERE ${p.where}` : ''}`;
    const before =
      p.action === 'insert' ? [] : (conn.prepare(sel).all() as Record<string, unknown>[]);
    const res = conn.prepare(p.sql).run();
    const changes = Number(res.changes);
    if (p.action === 'insert') {
      const after = rowById(conn, p.table, Number(res.lastInsertRowid));
      audit({
        admin,
        table: p.table,
        rowKey: { rowid: Number(res.lastInsertRowid) },
        action: 'insert',
        before: null,
        after: after ? maskRow(p.table, after) : null,
        sql: p.sql,
      });
    } else {
      for (const b of before) {
        const after = p.action === 'update' ? rowById(conn, p.table, Number(b.__rowid)) : undefined;
        audit({
          admin,
          table: p.table,
          rowKey: { rowid: b.__rowid },
          action: p.action,
          before: maskRow(p.table, b),
          after: after ? maskRow(p.table, after) : null,
          sql: p.sql,
        });
      }
    }
    return { changes, sql: p.sql };
  });
}

// ---------------------------------------------------------------------------
// Console history (last 50) and saved snippets

export function recordHistory(
  sql: string,
  ok: boolean,
  rowCount: number | null,
  durationMs: number,
) {
  const conn = writeDb();
  conn
    .prepare(
      'INSERT INTO db_query_history (at, sql, ok, row_count, duration_ms) VALUES (?, ?, ?, ?, ?)',
    )
    .run(Date.now(), sql, ok ? 1 : 0, rowCount, durationMs);
  conn
    .prepare(
      'DELETE FROM db_query_history WHERE id NOT IN (SELECT id FROM db_query_history ORDER BY id DESC LIMIT 50)',
    )
    .run();
}

export const history = () =>
  readDb().prepare('SELECT * FROM db_query_history ORDER BY id DESC LIMIT 50').all() as {
    id: number;
    at: number;
    sql: string;
    ok: number;
    row_count: number | null;
    duration_ms: number;
  }[];

export const snippets = () =>
  readDb().prepare('SELECT * FROM db_snippets ORDER BY name').all() as {
    id: number;
    name: string;
    sql: string;
    updated_at: number;
  }[];

export function saveSnippet(name: string, sql: string) {
  if (!name.trim() || name.length > 100)
    throw new ApiError(400, 'Give the snippet a name (100 characters max).');
  if (!sql.trim() || sql.length > 20_000)
    throw new ApiError(400, 'The snippet is empty or too long.');
  writeDb()
    .prepare(
      `INSERT INTO db_snippets (name, sql, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET sql = excluded.sql, updated_at = excluded.updated_at`,
    )
    .run(name.trim(), sql, Date.now());
}

export const deleteSnippet = (id: number) =>
  writeDb().prepare('DELETE FROM db_snippets WHERE id = ?').run(id);

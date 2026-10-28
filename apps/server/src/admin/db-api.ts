import { randomBytes } from 'node:crypto';

import { Hono } from 'hono';

import { config } from '../config.ts';
import { sha256 } from '../crypto.ts';
import { ApiError, readJson } from '../http.ts';
import { log } from '../log.ts';
import { listBackups, MIGRATIONS, schemaVersion } from '../migrations.ts';
import { getAccount, verifyPassword } from './account.ts';
import {
  assertTable,
  auditLog,
  browse,
  closeWriteWindow,
  columnsOf,
  CONSOLE_MAX_ROWS,
  CONSOLE_TIMEOUT_MS,
  dbFileSize,
  deleteRow,
  deleteSnippet,
  history,
  indexesOf,
  insertRow,
  isJsonColumn,
  isMaskedColumn,
  maskRow,
  openWriteWindow,
  PAGE_SIZE,
  parseFilters,
  previewWrite,
  q,
  readDb,
  recordHistory,
  relations,
  runReadQuery,
  runWrite,
  saveSnippet,
  snippets,
  tableSummaries,
  toCsv,
  updateRow,
  writeWindowState,
} from './db-browser.ts';

/**
 * JSON API for the admin database browser, mounted at /admin/api/db (admin cookie + JSON
 * content type are enforced by the caller). Reads are never audited; writes always are.
 */
export const dbApi = new Hono<{ Variables: { adminSession: string } }>();

const sessionKey = (raw: string) => sha256(raw);
const adminName = () => getAccount()?.username ?? 'admin';

// Two-step writes: a preview returns `confirmToken`; the same request with that token executes it.
type Pending = { session: string; fingerprint: string; expires: number };
const pending = new Map<string, Pending>();
const CONFIRM_TTL_MS = 2 * 60_000;
function issueToken(session: string, fingerprint: string) {
  const now = Date.now();
  for (const [k, p] of pending) if (p.expires <= now) pending.delete(k);
  const token = randomBytes(18).toString('base64url');
  pending.set(token, { session, fingerprint, expires: now + CONFIRM_TTL_MS });
  return token;
}
function useToken(token: unknown, session: string, fingerprint: string) {
  const p = typeof token === 'string' ? pending.get(token) : undefined;
  if (!p || p.expires <= Date.now() || p.session !== session || p.fingerprint !== fingerprint) {
    throw new ApiError(
      409,
      'This change wasn’t confirmed (or the confirmation expired). Preview it again.',
    );
  }
  pending.delete(token as string);
}

const rowidOf = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ApiError(400, 'Row id must be a whole number.');
  return n;
};

// Overview & structure ---------------------------------------------------------------

dbApi.get('/tables', (c) => {
  const backups = listBackups(config.dataDir);
  return c.json({
    schemaVersion: schemaVersion(readDb()),
    expectedVersion: MIGRATIONS.length,
    fileSize: dbFileSize(),
    backups: backups.length,
    lastBackupAt: backups[0]?.at ?? null,
    tables: tableSummaries(),
  });
});

dbApi.get('/tables/:name/structure', (c) => {
  const table = assertTable(c.req.param('name'));
  return c.json({
    table,
    columns: columnsOf(table).map((col) => ({
      name: col.name,
      type: col.type,
      notNull: !!col.notnull,
      default: col.dflt_value,
      primaryKey: col.pk > 0,
      masked: isMaskedColumn(table, col.name),
      json: isJsonColumn(table, col.name),
    })),
    indexes: indexesOf(table),
  });
});

dbApi.get('/relations', (c) =>
  c.json({ tables: tableSummaries().map((t) => t.name), relations: relations() }),
);

// Rows ---------------------------------------------------------------------------------

dbApi.get('/tables/:name/rows', (c) => {
  const table = assertTable(c.req.param('name'));
  const query = c.req.query();
  const columns = columnsOf(table);
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const result = browse(table, {
    filters: parseFilters(query, columns),
    ...(query.sort ? { sort: query.sort } : {}),
    dir,
    page: Number(query.page ?? 1) || 1,
  });
  return c.json({
    table,
    columns: columns.map((col) => ({
      name: col.name,
      masked: isMaskedColumn(table, col.name),
      json: isJsonColumn(table, col.name),
    })),
    rows: result.rows,
    total: result.total,
    page: result.page,
    pages: result.pages,
    pageSize: PAGE_SIZE,
  });
});

dbApi.get('/tables/:name/rows/:rowid', (c) => {
  const table = assertTable(c.req.param('name'));
  const rowid = rowidOf(c.req.param('rowid'));
  const raw = readDb()
    .prepare(`SELECT rowid AS __rowid, * FROM ${q(table)} WHERE rowid = ?`)
    .get(rowid) as Record<string, unknown> | undefined;
  if (!raw) throw new ApiError(404, 'No such row.');
  const rels = relations();
  // Links to related rows: this row's references, and rows elsewhere that reference this row.
  const outgoing = rels
    .filter(
      (r) => r.from === table && raw[r.fromColumn] !== null && raw[r.fromColumn] !== undefined,
    )
    .map((r) => ({
      column: r.fromColumn,
      table: r.to,
      toColumn: r.toColumn,
      value: raw[r.fromColumn],
      inferred: r.inferred,
    }));
  const incoming = rels
    .filter((r) => r.to === table && raw[r.toColumn] !== null && raw[r.toColumn] !== undefined)
    .map((r) => ({
      table: r.from,
      column: r.fromColumn,
      value: raw[r.toColumn],
      inferred: r.inferred,
      count: (
        readDb()
          .prepare(`SELECT COUNT(*) AS n FROM ${q(r.from)} WHERE ${q(r.fromColumn)} = ?`)
          .get(raw[r.toColumn] as string) as {
          n: number;
        }
      ).n,
    }));
  return c.json({ table, row: maskRow(table, raw), outgoing, incoming });
});

/** Row writes: first call (no confirmToken) previews; repeat with the token to apply. */
dbApi.post('/tables/:name/rows', async (c) => {
  const table = assertTable(c.req.param('name'));
  const { values, confirmToken } = await readJson(c);
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new ApiError(400, 'values must be an object.');
  const session = sessionKey(c.get('adminSession'));
  const fp = sha256(JSON.stringify(['insert', table, values]));
  if (confirmToken === undefined) {
    if (!writeWindowState(session).on)
      throw new ApiError(403, 'Turn on write mode first (re-enter your password).');
    return c.json({
      preview: { action: 'insert', table, affected: 1 },
      confirmToken: issueToken(session, fp),
    });
  }
  useToken(confirmToken, session, fp);
  const row = insertRow(session, adminName(), table, values as Record<string, unknown>);
  log(`admin db: insert into ${table}`);
  return c.json({ ok: true, row }, 201);
});

dbApi.patch('/tables/:name/rows/:rowid', async (c) => {
  const table = assertTable(c.req.param('name'));
  const rowid = rowidOf(c.req.param('rowid'));
  const { values, confirmToken } = await readJson(c);
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new ApiError(400, 'values must be an object.');
  const session = sessionKey(c.get('adminSession'));
  const fp = sha256(JSON.stringify(['update', table, rowid, values]));
  if (confirmToken === undefined) {
    if (!writeWindowState(session).on)
      throw new ApiError(403, 'Turn on write mode first (re-enter your password).');
    const exists = readDb()
      .prepare(`SELECT 1 FROM ${q(table)} WHERE rowid = ?`)
      .get(rowid);
    if (!exists) throw new ApiError(404, 'No such row.');
    return c.json({
      preview: { action: 'update', table, affected: 1 },
      confirmToken: issueToken(session, fp),
    });
  }
  useToken(confirmToken, session, fp);
  const row = updateRow(session, adminName(), table, rowid, values as Record<string, unknown>);
  log(`admin db: update ${table} rowid ${rowid}`);
  return c.json({ ok: true, row });
});

dbApi.delete('/tables/:name/rows/:rowid', async (c) => {
  const table = assertTable(c.req.param('name'));
  const rowid = rowidOf(c.req.param('rowid'));
  const body = c.req.header('Content-Length') === '0' ? {} : await readJson(c).catch(() => ({}));
  const confirmToken = (body as { confirmToken?: unknown }).confirmToken;
  const session = sessionKey(c.get('adminSession'));
  const fp = sha256(JSON.stringify(['delete', table, rowid]));
  if (confirmToken === undefined) {
    if (!writeWindowState(session).on)
      throw new ApiError(403, 'Turn on write mode first (re-enter your password).');
    const exists = readDb()
      .prepare(`SELECT 1 FROM ${q(table)} WHERE rowid = ?`)
      .get(rowid);
    if (!exists) throw new ApiError(404, 'No such row.');
    return c.json({
      preview: { action: 'delete', table, affected: 1 },
      confirmToken: issueToken(session, fp),
    });
  }
  useToken(confirmToken, session, fp);
  deleteRow(session, adminName(), table, rowid);
  log(`admin db: delete from ${table} rowid ${rowid}`);
  return c.json({ ok: true });
});

// SQL console -------------------------------------------------------------------------------

/**
 * Reads run straight away (read-only connection, one statement, 5 s, 1000 rows). Writes
 * (INSERT/UPDATE/DELETE, write mode only) first return a COUNT preview + confirmToken; send the
 * same sql with the token (and `affectAll: true` for a WHERE-less UPDATE/DELETE) to apply.
 */
dbApi.post('/query', async (c) => {
  const { sql, confirmToken, affectAll } = await readJson(c);
  if (typeof sql !== 'string') throw new ApiError(400, 'sql is required.');
  const session = sessionKey(c.get('adminSession'));
  const started = performance.now();
  const isWrite = /^\s*(insert|update|delete)\b/i.test(
    sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/)*/g, ''),
  );
  try {
    if (!isWrite) {
      const result = await runReadQuery(sql);
      recordHistory(sql, true, result.rowCount, result.durationMs);
      return c.json({
        kind: 'read',
        ...result,
        limits: { maxRows: CONSOLE_MAX_ROWS, timeoutMs: CONSOLE_TIMEOUT_MS },
      });
    }
    if (!writeWindowState(session).on)
      throw new ApiError(403, 'Turn on write mode first (re-enter your password).');
    const preview = previewWrite(sql);
    const needsAffectAll = preview.action !== 'insert' && !preview.where;
    const fp = sha256(JSON.stringify(['sql', preview.sql]));
    if (confirmToken === undefined) {
      return c.json({
        kind: 'preview',
        preview: {
          action: preview.action,
          table: preview.table,
          affected: preview.affected,
          needsAffectAll,
        },
        confirmToken: issueToken(session, fp),
      });
    }
    if (needsAffectAll && affectAll !== true) {
      throw new ApiError(
        400,
        `${preview.action.toUpperCase()} without WHERE would change every row. Send affectAll: true to do that.`,
      );
    }
    useToken(confirmToken, session, fp);
    const out = runWrite(session, adminName(), sql, { affectAll: affectAll === true });
    const durationMs = Math.round(performance.now() - started);
    recordHistory(sql, true, out.changes, durationMs);
    log(`admin db: console ${preview.action} on ${preview.table} (${out.changes} row(s))`);
    return c.json({ kind: 'write', changes: out.changes, durationMs });
  } catch (e) {
    if (e instanceof ApiError && e.status !== 409 && e.status !== 403) {
      recordHistory(sql, false, null, Math.round(performance.now() - started));
    }
    throw e;
  }
});

/** CSV of a read query's results (values masked like everywhere else). */
dbApi.post('/query/csv', async (c) => {
  const { sql } = await readJson(c);
  if (typeof sql !== 'string') throw new ApiError(400, 'sql is required.');
  const result = await runReadQuery(sql);
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="query.csv"');
  return c.body(toCsv(result));
});

dbApi.get('/history', (c) =>
  c.json(
    history().map((h) => ({
      id: h.id,
      at: h.at,
      sql: h.sql,
      ok: !!h.ok,
      rowCount: h.row_count,
      durationMs: h.duration_ms,
    })),
  ),
);
dbApi.get('/snippets', (c) =>
  c.json(snippets().map((s) => ({ id: s.id, name: s.name, sql: s.sql, updatedAt: s.updated_at }))),
);
dbApi.post('/snippets', async (c) => {
  const { name, sql } = await readJson(c);
  if (typeof name !== 'string' || typeof sql !== 'string')
    throw new ApiError(400, 'name and sql are required.');
  saveSnippet(name, sql);
  return c.json({ ok: true }, 201);
});
dbApi.delete('/snippets/:id', (c) => {
  deleteSnippet(rowidOf(c.req.param('id')));
  return c.body(null, 204);
});

// Write mode ------------------------------------------------------------------------------------

const unlockAttempts = new Map<string, { n: number; reset: number }>();

dbApi.get('/write-mode', (c) => c.json(writeWindowState(sessionKey(c.get('adminSession')))));

dbApi.post('/write-mode', async (c) => {
  const session = sessionKey(c.get('adminSession'));
  const now = Date.now();
  const a = unlockAttempts.get(session);
  if (a && a.reset > now && a.n >= 5)
    throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
  const { password } = await readJson(c);
  const account = getAccount();
  const ok =
    !!account &&
    typeof password === 'string' &&
    (await verifyPassword(password, account.password_hash));
  if (!ok) {
    unlockAttempts.set(session, {
      n: (a && a.reset > now ? a.n : 0) + 1,
      reset: a && a.reset > now ? a.reset : now + 15 * 60_000,
    });
    throw new ApiError(403, 'Wrong password.'); // 401 is reserved for a missing/expired admin session
  }
  unlockAttempts.delete(session);
  log('admin db: write mode on (15 min)');
  return c.json(openWriteWindow(session));
});

dbApi.delete('/write-mode', (c) => {
  closeWriteWindow(sessionKey(c.get('adminSession')));
  return c.json({ on: false });
});

// Audit -------------------------------------------------------------------------------------------

dbApi.get('/audit', (c) => {
  const table = c.req.query('table') || undefined;
  const action = c.req.query('action') || undefined;
  const page = Number(c.req.query('page') ?? 1) || 1;
  const parse = (v: string | null) => (v === null ? null : (JSON.parse(v) as unknown));
  return c.json(
    auditLog({ ...(table ? { table } : {}), ...(action ? { action } : {}), page }).map((r) => ({
      id: r.id,
      at: r.at,
      admin: r.admin,
      table: r.table_name,
      rowKey: parse(r.row_key),
      action: r.action,
      before: parse(r.before_json),
      after: parse(r.after_json),
      sql: r.sql,
    })),
  );
});

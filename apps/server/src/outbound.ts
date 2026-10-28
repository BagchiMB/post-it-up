import { AsyncLocalStorage } from 'node:async_hooks';

import { newId } from './crypto.ts';
import { all, one, run } from './db.ts';
import { logError } from './log.ts';

/**
 * Every outgoing HTTP call goes through `outbound()`, which records one `integration_calls` row:
 * integration, operation, host+path (never the query string), status, ok, duration, a short
 * redacted error, and who it was for. Never bodies, keys, tokens, images or prompts.
 */

export type Integration = 'openrouter' | 'spotify' | 'lrclib' | 'ntfy' | 'google';
export const INTEGRATIONS: Integration[] = ['openrouter', 'spotify', 'lrclib', 'ntfy', 'google'];

/** Who/what the current calls are for (set around a job, a music change, an app request or a check). */
export const callContext = new AsyncLocalStorage<{
  jobId?: string;
  userId?: string;
  check?: boolean;
}>();

/** Removes anything that looks like a credential, then trims to 300 chars. */
export function redact(text: string) {
  return text
    .replace(/(Bearer|Basic)\s+[^\s"',;]+/gi, '$1 [redacted]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(
      /((?:access|refresh|id)?_?token|key|secret|password|code)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
      '$1$2[redacted]',
    )
    .replace(
      /\b(?=[A-Za-z0-9_\-.=+/]*\d)(?=[A-Za-z0-9_\-.=+/]*[A-Za-z])[A-Za-z0-9_\-.=+/]{24,}/g,
      '[redacted]',
    )
    .slice(0, 300);
}

const ids = new WeakMap<Response, string>();

export async function outbound(
  meta: { integration: Integration; operation: string; logPath?: string },
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const ctx = callContext.getStore();
  const u = new URL(url);
  const started = performance.now();
  const id = newId();
  const write = (status: number | null, ok: boolean, error: string | null) => {
    try {
      run(
        `INSERT INTO integration_calls (id, at, integration, operation, user_id, job_id, method, path, status_code, ok, duration_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        Date.now(),
        meta.integration,
        (ctx?.check ? 'check:' : '') + meta.operation,
        ctx?.userId ?? null,
        ctx?.jobId ?? null,
        (init.method ?? 'GET').toUpperCase(),
        meta.logPath ?? `${u.host}${u.pathname}`,
        status,
        ok ? 1 : 0,
        Math.round(performance.now() - started),
        error === null ? null : redact(error),
      );
    } catch (e) {
      logError('recording integration call', e);
    }
  };
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const err = e as Error;
    write(null, false, err.name === 'TimeoutError' ? 'Timed out' : err.message || 'Network error');
    throw e;
  }
  write(
    res.status,
    res.ok,
    res.ok ? null : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`,
  );
  ids.set(res, id);
  return res;
}

/** Attaches an AI call's cost (from OpenRouter's `usage`) and, for routers, "Router → model" to its log row. */
export function linkCost(res: Response, cost: number | null, model: string | null = null) {
  const id = ids.get(res);
  if (id) run('UPDATE integration_calls SET cost_usd = ?, model = ? WHERE id = ?', cost, model, id);
}

/** Marks a failed call's log row with a classification, e.g. `out_of_credits`. */
export function markOutcome(res: Response, outcome: string) {
  const id = ids.get(res);
  if (id)
    run(
      "UPDATE integration_calls SET error = ? || ': ' || COALESCE(error, '') WHERE id = ?",
      outcome,
      id,
    );
}

/**
 * Whether OpenRouter chat calls are currently failing for lack of credits: the newest
 * out_of_credits failure is more recent than the newest successful chat call.
 */
export function outOfCreditsState() {
  const lastFail = one<{ at: number | null }>(
    "SELECT MAX(at) AS at FROM integration_calls WHERE integration = 'openrouter' AND error LIKE 'out_of_credits%'",
  )!.at;
  if (!lastFail) return null;
  const lastOk = one<{ at: number | null }>(
    "SELECT MAX(at) AS at FROM integration_calls WHERE integration = 'openrouter' AND operation LIKE '%chat' AND ok = 1",
  )!.at;
  return lastOk && lastOk > lastFail ? null : { lastFailureAt: lastFail };
}

/** Overview: failed calls in the last 24 h. */
export const failuresSince = (since: number) =>
  one<{ n: number }>('SELECT COUNT(*) AS n FROM integration_calls WHERE ok = 0 AND at >= ?', since)!
    .n;

export function sweepLogs(retentionDays: number) {
  run('DELETE FROM integration_calls WHERE at < ?', Date.now() - retentionDays * 86_400_000);
}

// Querying (Logs page + API)

export type LogFilter = {
  integrations?: string[];
  user?: string;
  ok?: 'ok' | 'failed';
  operation?: string;
  job?: string;
  from?: number;
  to?: number;
  cursor?: string;
  limit?: number;
};

export type LogRow = {
  id: string;
  at: number;
  integration: string;
  operation: string;
  userId: string | null;
  userEmail: string | null;
  jobId: string | null;
  method: string;
  path: string;
  statusCode: number | null;
  ok: boolean;
  durationMs: number;
  costUsd: number | null;
  /** For router calls: "Router name → model it picked". */
  model: string | null;
  error: string | null;
};

/** Parses `from`/`to` as a date (YYYY-MM-DD, whole UTC day) or any ISO date-time / ms epoch. */
export function parseTime(v: string | undefined, endOfDay: boolean): number | undefined {
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v))
    return Date.parse(`${v}T00:00:00Z`) + (endOfDay ? 86_400_000 - 1 : 0);
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

export function queryLogs(f: LogFilter): { rows: LogRow[]; nextCursor: string | null } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const ints = (f.integrations ?? []).filter((i) => INTEGRATIONS.includes(i as Integration));
  if (ints.length) {
    where.push(`c.integration IN (${ints.map(() => '?').join(', ')})`);
    params.push(...ints);
  }
  if (f.user) {
    where.push('u.email LIKE ?');
    params.push(`%${f.user.toLowerCase()}%`);
  }
  if (f.ok) where.push(f.ok === 'ok' ? 'c.ok = 1' : 'c.ok = 0');
  if (f.operation) {
    where.push('c.operation LIKE ?');
    params.push(`%${f.operation}%`);
  }
  if (f.job) {
    where.push('c.job_id = ?');
    params.push(f.job);
  }
  if (f.from !== undefined) {
    where.push('c.at >= ?');
    params.push(f.from);
  }
  if (f.to !== undefined) {
    where.push('c.at <= ?');
    params.push(f.to);
  }
  if (f.cursor) {
    const [at, id] = Buffer.from(f.cursor, 'base64url').toString().split(':');
    if (at && id) {
      where.push('(c.at < ? OR (c.at = ? AND c.id < ?))');
      params.push(Number(at), Number(at), id);
    }
  }
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  const rows = all<{
    id: string;
    at: number;
    integration: string;
    operation: string;
    user_id: string | null;
    email: string | null;
    job_id: string | null;
    method: string;
    path: string;
    status_code: number | null;
    ok: number;
    duration_ms: number;
    cost_usd: number | null;
    model: string | null;
    error: string | null;
  }>(
    `SELECT c.*, u.email FROM integration_calls c LEFT JOIN users u ON u.id = c.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.at DESC, c.id DESC LIMIT ?`,
    ...params,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({
      id: r.id,
      at: r.at,
      integration: r.integration,
      operation: r.operation,
      userId: r.user_id,
      userEmail: r.email,
      jobId: r.job_id,
      method: r.method,
      path: r.path,
      statusCode: r.status_code,
      ok: !!r.ok,
      durationMs: r.duration_ms,
      costUsd: r.cost_usd,
      model: r.model,
      error: r.error,
    })),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(`${last.at}:${last.id}`).toString('base64url')
        : null,
  };
}

import { newId } from './crypto.ts';
import { all, one, run } from './db.ts';
import { logError } from './log.ts';
import { callContext } from './outbound.ts';

/** Which job/user the current calls belong to (set around a job, music change or app request). */
export const aiContext = callContext;

/** schemaName → prompt key, so spend can be broken down by AI step. */
const STEP: Record<string, string> = {
  shortlist: 'shortlist',
  posts: 'final_post',
  clip: 'song_clip',
  clip_estimate: 'song_clip_estimate',
  song_change: 'song_change',
};

export type OpenRouterUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number };

/** One row per OpenRouter call (OpenRouter always includes `usage`, with `cost` in USD). Never throws. */
export function recordAiCall(
  schemaName: string,
  model: string,
  routedModel: string | null,
  usage: OpenRouterUsage | undefined,
) {
  try {
    const ctx = aiContext.getStore();
    run(
      `INSERT INTO ai_calls (id, job_id, user_id, prompt_key, model, routed_model, prompt_tokens, completion_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      ctx?.jobId ?? null,
      ctx?.userId ?? null,
      STEP[schemaName] ?? schemaName,
      model,
      routedModel,
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? 0,
      typeof usage?.cost === 'number' ? usage.cost : 0,
      Date.now(),
    );
  } catch (e) {
    logError('recording AI usage', e);
  }
}

const dayStart = (daysAgo: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - daysAgo * 86_400_000;
};

export function spendToday() {
  return one<{ cost: number; calls: number }>(
    'SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls FROM ai_calls WHERE created_at >= ?',
    dayStart(0),
  )!;
}

/** Spend breakdowns over the last `days` UTC days (today included). */
export function usageBreakdown(days: number) {
  const since = dayStart(days - 1);
  const rows = all<{ day: string; cost: number; calls: number }>(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, SUM(cost_usd) AS cost, COUNT(*) AS calls
     FROM ai_calls WHERE created_at >= ? GROUP BY day`,
    since,
  );
  const byDayMap = new Map(rows.map((r) => [r.day, r]));
  const byDay = Array.from({ length: days }, (_, i) => {
    const day = new Date(since + i * 86_400_000).toISOString().slice(0, 10);
    const r = byDayMap.get(day);
    return { day, cost: r?.cost ?? 0, calls: r?.calls ?? 0 };
  });
  const byUser = all<{ userId: string; email: string; cost: number; posts: number }>(
    `SELECT u.id AS userId, u.email AS email,
            COALESCE((SELECT SUM(cost_usd) FROM ai_calls a WHERE a.user_id = u.id AND a.created_at >= ?), 0) AS cost,
            (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.created_at >= ?) AS posts
     FROM users u ORDER BY cost DESC, posts DESC`,
    since,
    since,
  );
  const byStep = all<{ key: string; cost: number; calls: number }>(
    `SELECT prompt_key AS key, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM ai_calls
     WHERE created_at >= ? GROUP BY prompt_key ORDER BY cost DESC`,
    since,
  );
  const byModel = all<{ model: string; routedModel: string | null; cost: number; calls: number }>(
    `SELECT model, routed_model AS routedModel, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM ai_calls
     WHERE created_at >= ? GROUP BY model, routed_model ORDER BY cost DESC`,
    since,
  );
  return { byDay, byUser, byStep, byModel };
}

/** All-time spend per user (for the Users page). */
export function spendByUser(): Map<string, number> {
  return new Map(
    all<{ user_id: string; cost: number }>(
      'SELECT user_id, SUM(cost_usd) AS cost FROM ai_calls WHERE user_id IS NOT NULL GROUP BY user_id',
    ).map((r) => [r.user_id, r.cost]),
  );
}

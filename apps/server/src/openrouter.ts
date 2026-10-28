import { linkCost, markOutcome, outbound } from './outbound.ts';
import { type OpenRouterUsage, recordAiCall } from './usage.ts';

const BASE = 'https://openrouter.ai/api/v1';
/** Vision calls with many images can be slow; give each one this long. */
const CALL_TIMEOUT_MS = 4 * 60_000;

const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'X-Title': 'Post It Up',
});

type RawModel = {
  id: string;
  name: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
};

export type ModelChoice = { id: string; name: string; structuredOutputs?: boolean };

/** A text-output model; prices are USD per 1M tokens; `vision` = accepts images. */
export type ListedModel = {
  id: string;
  name: string;
  /** USD per 1M tokens; null for auto-routers (variable price). */
  inputPrice: number | null;
  outputPrice: number | null;
  structuredOutputs: boolean;
  vision: boolean;
  /** Auto-router (e.g. openrouter/auto): picks a model per request. */
  router?: boolean;
};
export type VisionModel = ListedModel;

const MODELS_TTL_MS = 60 * 60 * 1000;
let models: { at: number; list: ListedModel[] } | null = null;
let modelsInflight: Promise<ListedModel[]> | null = null;

async function loadModels(): Promise<ListedModel[]> {
  const res = await outbound({ integration: 'openrouter', operation: 'models' }, `${BASE}/models`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenRouter models returned ${res.status}`);
  const { data } = (await res.json()) as { data: RawModel[] };
  const list = data
    .filter(
      (m) =>
        (m.architecture?.input_modalities?.includes('text') ?? true) &&
        // Must answer in text only (excludes music/image generators that also emit text); older entries omit the field.
        (m.architecture?.output_modalities?.every((o) => o === 'text') ?? true) &&
        // Async batch endpoints and "~latest"-style aliases can't serve this pipeline.
        !m.id.endsWith(':batch') &&
        !m.id.startsWith('~'),
    )
    .map((m): ListedModel => {
      const inP = Number(m.pricing?.prompt ?? 0);
      const outP = Number(m.pricing?.completion ?? 0);
      // Routers report negative ("-1") prices: the price depends on the model they pick.
      const router = inP < 0 || outP < 0 || m.id.startsWith('openrouter/');
      return {
        id: m.id,
        name: m.name,
        inputPrice: router ? null : Math.round(inP * 1e10) / 1e4,
        outputPrice: router ? null : Math.round(outP * 1e10) / 1e4,
        structuredOutputs: m.supported_parameters?.includes('structured_outputs') ?? false,
        vision: m.architecture?.input_modalities?.includes('image') ?? false,
        ...(router ? { router: true } : {}),
      };
    })
    .sort((a, b) => (a.inputPrice ?? Infinity) - (b.inputPrice ?? Infinity));
  models = { at: Date.now(), list };
  return list;
}

async function loadedModels(): Promise<ListedModel[]> {
  if (models && Date.now() - models.at < MODELS_TTL_MS) return models.list;
  modelsInflight ??= loadModels().finally(() => {
    modelsInflight = null;
  });
  try {
    return await modelsInflight;
  } catch (e) {
    if (models) return models.list; // stale beats nothing
    throw e;
  }
}

/** Text-output OpenRouter models, cheapest first (public list, cached 1 h); auto-routers only when asked. */
export async function allModels(opts: { routers?: boolean } = {}): Promise<ListedModel[]> {
  const list = await loadedModels();
  return opts.routers ? list : list.filter((m) => !m.router);
}

/** Image-capable models only (what photo steps need). */
export const visionModels = async (opts: { routers?: boolean } = {}) =>
  (await allModels(opts)).filter((m) => m.vision);

/** Details for one model id, or a bare fallback when the list can't be loaded or doesn't have it. */
export async function modelInfo(id: string): Promise<ModelChoice> {
  const m = (await allModels({ routers: true }).catch(() => [] as ListedModel[])).find(
    (x) => x.id === id,
  );
  return m ? { id: m.id, name: m.name, structuredOutputs: m.structuredOutputs } : { id, name: id };
}

/**
 * Checks a key with OpenRouter's GET /key. `ok: false` with an error when rejected;
 * throws when OpenRouter can't be reached.
 */
export async function checkKey(
  key: string,
): Promise<{ ok: boolean; error?: string; remaining?: number | null }> {
  const res = await outbound({ integration: 'openrouter', operation: 'key' }, `${BASE}/key`, {
    headers: headers(key),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403)
    return { ok: false, error: 'OpenRouter rejected the key.' };
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
  const body = (await res.json().catch(() => null)) as {
    data?: { limit_remaining?: number | null };
  } | null;
  const remaining = body?.data?.limit_remaining;
  return { ok: true, ...(remaining !== undefined ? { remaining } : {}) };
}

/** This key's own numbers from GET /key (spending limit, usage, free tier). */
export type KeyInfo = {
  limit: number | null;
  limitRemaining: number | null;
  usage: number;
  usageDaily?: number;
  usageWeekly?: number;
  usageMonthly?: number;
  isFreeTier: boolean;
  freeRequests?: { used: number; limit: number; remaining: number };
};

/**
 * `source: 'credits'` → total/used/remaining are the ACCOUNT (GET /credits; balance = total − used).
 * `source: 'key'` → /credits failed; total/used/remaining are this key's limit/usage instead.
 * `key` always carries the key's own limit and usage when GET /key worked.
 */
export type Credits = {
  source: 'credits' | 'key';
  total?: number;
  used: number;
  remaining?: number | null;
  usageDaily?: number;
  usageWeekly?: number;
  usageMonthly?: number;
  balance?: number;
  key?: KeyInfo;
};

let creditsCache: { at: number; key: string; value: Credits } | null = null;

/** The OpenRouter account ran out of credits. Users see a generic message; admins see the details. */
export class OutOfCreditsError extends Error {
  readonly userMessage = 'The AI service is temporarily unavailable. Try again later.';
}

/** Drops the cached balance and re-reads it in the background (after an out-of-credits failure). */
function refreshCreditsSoon(key: string) {
  creditsCache = null;
  void credits(key).catch(() => undefined);
}

/** The last credits lookup and when it was made (no network). */
export const cachedCredits = () =>
  creditsCache ? { value: creditsCache.value, at: creditsCache.at } : null;

export type BalanceStatus = {
  status: 'ok' | 'low' | 'empty' | 'unknown';
  balanceUsd?: number;
  keyLimitUsd?: number | null;
  isFreeTier?: boolean;
  checkedAt: number | null;
};

/** Account balance (never the key's limit) vs the low-balance threshold, from the cached lookup. */
export function balanceStatus(key: string | null, lowBalanceUsd: number): BalanceStatus {
  const cached = creditsCache && creditsCache.key === key ? creditsCache : null;
  // Keep the cache warm for banners without making callers wait.
  if (key && (!cached || Date.now() - cached.at > 60_000)) void credits(key).catch(() => undefined);
  if (!cached) return { status: 'unknown', checkedAt: null };
  const c = cached.value;
  const extra = {
    ...(c.key ? { keyLimitUsd: c.key.limit, isFreeTier: c.key.isFreeTier } : {}),
    checkedAt: cached.at,
  };
  if (c.source !== 'credits' || typeof c.balance !== 'number')
    return { status: 'unknown', ...extra };
  const balanceUsd = Math.round(c.balance * 100) / 100;
  const status = c.balance <= 0 ? 'empty' : c.balance < lowBalanceUsd ? 'low' : 'ok';
  return { status, balanceUsd, ...extra };
}
/** Keys whose /credits call failed (e.g. 403): retry after 10 minutes rather than on every page view. */
const creditsFailedUntil = new Map<string, number>();

async function fetchAccount(key: string): Promise<{ total: number; used: number } | null> {
  if ((creditsFailedUntil.get(key) ?? 0) > Date.now()) return null;
  try {
    const res = await outbound(
      { integration: 'openrouter', operation: 'credits' },
      `${BASE}/credits`,
      {
        headers: headers(key),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 401) throw new Error('OpenRouter rejected the key.');
    if (!res.ok) {
      creditsFailedUntil.set(key, Date.now() + 10 * 60_000);
      return null;
    }
    const { data } = (await res.json()) as { data: { total_credits: number; total_usage: number } };
    creditsFailedUntil.delete(key);
    return { total: Number(data.total_credits) || 0, used: Number(data.total_usage) || 0 };
  } catch (e) {
    if ((e as Error).message === 'OpenRouter rejected the key.') throw e;
    creditsFailedUntil.set(key, Date.now() + 10 * 60_000);
    return null;
  }
}

async function fetchKeyInfo(key: string): Promise<KeyInfo | null> {
  const res = await outbound({ integration: 'openrouter', operation: 'key' }, `${BASE}/key`, {
    headers: headers(key),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return null;
  if (res.status === 401) throw new Error('OpenRouter rejected the key.');
  if (!res.ok) return null;
  const { data: d } = (await res.json()) as {
    data: {
      usage?: number;
      usage_daily?: number;
      usage_weekly?: number;
      usage_monthly?: number;
      limit?: number | null;
      limit_remaining?: number | null;
      is_free_tier?: boolean;
      free_model_daily_requests?: { used?: number; limit?: number; remaining?: number };
    };
  };
  const f = d.free_model_daily_requests;
  return {
    limit: typeof d.limit === 'number' ? d.limit : null,
    limitRemaining: typeof d.limit_remaining === 'number' ? d.limit_remaining : null,
    usage: d.usage ?? 0,
    ...(typeof d.usage_daily === 'number' ? { usageDaily: d.usage_daily } : {}),
    ...(typeof d.usage_weekly === 'number' ? { usageWeekly: d.usage_weekly } : {}),
    ...(typeof d.usage_monthly === 'number' ? { usageMonthly: d.usage_monthly } : {}),
    isFreeTier: d.is_free_tier === true,
    ...(f && typeof f.limit === 'number'
      ? {
          freeRequests: {
            used: f.used ?? 0,
            limit: f.limit,
            remaining: f.remaining ?? Math.max(0, f.limit - (f.used ?? 0)),
          },
        }
      : {}),
  };
}

/**
 * Account balance via GET /credits (tried first, every time the ~60 s cache expires; a failure is
 * retried after 10 minutes) plus this key's own limit/usage via GET /key.
 */
export async function credits(key: string): Promise<Credits> {
  if (creditsCache && creditsCache.key === key && Date.now() - creditsCache.at < 60_000)
    return creditsCache.value;
  const [account, info] = await Promise.all([fetchAccount(key), fetchKeyInfo(key)]);
  let value: Credits;
  if (account) {
    value = {
      source: 'credits',
      total: account.total,
      used: account.used,
      remaining: account.total - account.used,
      balance: account.total - account.used,
      ...(info ? { key: info } : {}),
    };
  } else if (info) {
    value = {
      source: 'key',
      ...(info.limit !== null ? { total: info.limit } : {}),
      used: info.usage,
      remaining: info.limitRemaining,
      ...(info.usageDaily !== undefined ? { usageDaily: info.usageDaily } : {}),
      ...(info.usageWeekly !== undefined ? { usageWeekly: info.usageWeekly } : {}),
      ...(info.usageMonthly !== undefined ? { usageMonthly: info.usageMonthly } : {}),
      key: info,
    };
  } else {
    throw new Error('Couldn’t read credits from OpenRouter.');
  }
  creditsCache = { at: Date.now(), key, value };
  return value;
}

/** Free models: ":free" ids or zero prices. */
export const isFreeModel = (m: {
  id: string;
  inputPrice?: number | null;
  outputPrice?: number | null;
}) => m.id.endsWith(':free') || (m.inputPrice === 0 && m.outputPrice === 0);

export type Content =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/**
 * One chat call that must answer with JSON matching `schema`. Uses OpenRouter's
 * structured outputs when the model supports them, otherwise asks for JSON in the prompt.
 */
export async function chatJson<T>(opts: {
  apiKey: string;
  model: { id: string; name?: string; structuredOutputs?: boolean };
  content: Content[];
  schemaName: string;
  schema: object;
}): Promise<T> {
  const structured = opts.model.structuredOutputs !== false;
  const content: Content[] = structured
    ? opts.content
    : [
        ...opts.content,
        {
          type: 'text',
          text: `Reply with only JSON matching this schema:\n${JSON.stringify(opts.schema)}`,
        },
      ];

  let res: Response;
  try {
    res = await outbound(
      { integration: 'openrouter', operation: 'chat' },
      `${BASE}/chat/completions`,
      {
        method: 'POST',
        headers: headers(opts.apiKey),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        body: JSON.stringify({
          model: opts.model.id,
          messages: [{ role: 'user', content }],
          ...(structured && {
            response_format: {
              type: 'json_schema',
              json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
            },
            provider: { require_parameters: true },
          }),
        }),
      },
    );
  } catch (e) {
    const timedOut = (e as Error).name === 'TimeoutError';
    throw new Error(
      timedOut ? 'The AI model took too long to answer. Try again.' : 'Couldn’t reach OpenRouter.',
    );
  }

  type Body = {
    error?: { message?: string; code?: number };
    choices?: { message?: { content?: string | null } }[];
    model?: string;
    usage?: OpenRouterUsage;
  };
  const body = (await res.json().catch(() => null)) as Body | null;
  // OpenRouter includes usage (tokens + cost in USD) in every response; record it even if the answer is unusable.
  if (body?.usage) {
    // A router answers with the model it actually used; record both.
    const routed = body.model && body.model !== opts.model.id ? body.model : null;
    recordAiCall(opts.schemaName, opts.model.id, routed, body.usage);
    linkCost(
      res,
      typeof body.usage.cost === 'number' ? body.usage.cost : null,
      routed ? `${opts.model.name ?? opts.model.id} → ${routed}` : null,
    );
  }
  if (!res.ok || body?.error) {
    const message = body?.error?.message ?? `OpenRouter returned ${res.status}`;
    // Insufficient credits: HTTP 402 (error.code mirrors the status), or a body that says so.
    if (res.status === 402 || body?.error?.code === 402 || /insufficient credits/i.test(message)) {
      markOutcome(res, 'out_of_credits');
      refreshCreditsSoon(opts.apiKey);
      throw new OutOfCreditsError(message);
    }
    throw new Error(message);
  }

  const text = body?.choices?.[0]?.message?.content ?? '';
  // Some models wrap JSON in ``` fences even when asked not to.
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error('The model’s answer wasn’t valid JSON. Try again or pick another model.');
  }
}

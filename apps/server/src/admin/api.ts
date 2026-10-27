import { type Context, Hono } from 'hono';

import { all } from '../db.ts';
import { ApiError, readJson } from '../http.ts';
import { log } from '../log.ts';
import { notifyUser } from '../ntfy.ts';
import { allModels, checkKey, credits, type ModelChoice, visionModels } from '../openrouter.ts';
import { type LogFilter, parseTime, queryLogs } from '../outbound.ts';
import {
  activateVersion,
  createVersion,
  listPrompts,
  listVersions,
  PROMPT_KEYS,
  promptDef,
  type PromptKey,
  VISION_STEPS,
} from '../prompts.ts';
import {
  keyHint,
  openRouterKey,
  secretHint,
  type ServerSettings,
  serverSettings,
  setOpenRouterKey,
  setSpotifyCredentials,
  spotifyClientId,
  spotifyClientSecret,
  updateServerSettings,
} from '../server-settings.ts';
import { appConfigured, requestAppToken, resetAppToken, SpotifyHttpError } from '../spotify.ts';
import { spendByUser, usageBreakdown } from '../usage.ts';
import {
  clearSpotify,
  getNtfyTopic,
  getSpotifyAccess,
  setSpotifyAccess,
  spotifySlotsUsed,
  type StoredSpotifyAccess,
} from '../users.ts';
import { changePassword, endOtherSessions, getAccount, verifyPassword } from './account.ts';
import { CHECKS, runChecks } from './checks.ts';

/** JSON API under /admin/api (cookie auth + JSON content type are enforced by the caller). */
export const adminApi = new Hono<{ Variables: { adminSession: string } }>();

// Settings -------------------------------------------------------------------

function settingsView() {
  const key = openRouterKey();
  return {
    ...serverSettings(),
    openRouterKey: key ? { set: true, hint: keyHint(key) } : { set: false },
    spotify: { appCredentials: appConfigured() },
  };
}

const intIn = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

adminApi.get('/settings', (c) => c.json(settingsView()));

adminApi.put('/settings', async (c) => {
  const body = await readJson(c);
  const patch: Partial<ServerSettings> = {};
  if (body.model !== undefined) {
    const m = body.model as Record<string, unknown> | null;
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id || m.id.length > 200) {
      throw new ApiError(400, 'model needs an id.');
    }
    const list = await visionModels({ routers: true }).catch(() => null);
    const known = list?.find((x) => x.id === m.id);
    // If OpenRouter's list is unreachable, accept the id as given rather than block the admin.
    if (list && !known) throw new ApiError(400, `${m.id} isn't a vision-capable OpenRouter model.`);
    const model: ModelChoice = known
      ? { id: known.id, name: known.name, structuredOutputs: known.structuredOutputs }
      : {
          id: m.id,
          name: typeof m.name === 'string' && m.name ? m.name.slice(0, 200) : m.id,
          ...(typeof m.structuredOutputs === 'boolean'
            ? { structuredOutputs: m.structuredOutputs }
            : {}),
        };
    patch.model = model;
  }
  if (body.stepModels !== undefined) {
    const v = body.stepModels;
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new ApiError(400, 'stepModels must be an object.');
    const next = { ...serverSettings().stepModels };
    const list = await allModels({ routers: true }).catch(() => null);
    for (const [key, m] of Object.entries(v as Record<string, unknown>)) {
      if (!PROMPT_KEYS.includes(key as PromptKey))
        throw new ApiError(400, `Unknown AI step: ${key}.`);
      const k = key as PromptKey;
      if (m === null) {
        delete next[k];
        continue;
      }
      const mm = m as Record<string, unknown>;
      if (
        !mm ||
        typeof mm !== 'object' ||
        typeof mm.id !== 'string' ||
        !mm.id ||
        mm.id.length > 200
      ) {
        throw new ApiError(400, `stepModels.${k} needs an id (or null to use the default).`);
      }
      const known = list?.find((x) => x.id === mm.id);
      if (list && !known)
        throw new ApiError(400, `${mm.id} isn't an available OpenRouter text model.`);
      if (VISION_STEPS.has(k) && known && !known.vision) {
        throw new ApiError(
          400,
          `${promptDef(k)!.title} sees photos, so it needs an image-capable model; ${known.name} isn't.`,
        );
      }
      next[k] = known
        ? { id: known.id, name: known.name, structuredOutputs: known.structuredOutputs }
        : {
            id: mm.id,
            name: typeof mm.name === 'string' && mm.name ? mm.name.slice(0, 200) : mm.id,
            ...(typeof mm.structuredOutputs === 'boolean'
              ? { structuredOutputs: mm.structuredOutputs }
              : {}),
          };
    }
    patch.stepModels = next;
  }
  if (body.dailyJobLimit !== undefined) {
    if (!intIn(body.dailyJobLimit, 1, 500))
      throw new ApiError(400, 'Daily task limit must be a whole number from 1 to 500.');
    patch.dailyJobLimit = body.dailyJobLimit as number;
  }
  if (body.dailyMusicChangeLimit !== undefined) {
    if (!intIn(body.dailyMusicChangeLimit, 0, 500)) {
      throw new ApiError(400, 'Daily music changes must be a whole number from 0 to 500.');
    }
    patch.dailyMusicChangeLimit = body.dailyMusicChangeLimit as number;
  }
  if (body.clipLengths !== undefined) {
    const v = body.clipLengths;
    if (!Array.isArray(v) || v.length < 1 || v.length > 8 || !v.every((n) => intIn(n, 5, 90))) {
      throw new ApiError(400, 'Clip lengths must be 1–8 whole numbers of seconds, each 5–90.');
    }
    patch.clipLengths = [...new Set(v as number[])].sort((a, b) => a - b);
  }
  if (body.lowFitThreshold !== undefined) {
    if (!intIn(body.lowFitThreshold, 0, 100))
      throw new ApiError(400, 'Low-fit threshold must be a whole number from 0 to 100.');
    patch.lowFitThreshold = body.lowFitThreshold as number;
  }
  if (body.spotifyUserCap !== undefined) {
    if (!intIn(body.spotifyUserCap, 0, 25))
      throw new ApiError(400, 'Spotify user cap must be a whole number from 0 to 25.');
    patch.spotifyUserCap = body.spotifyUserCap as number;
  }
  if (body.spotifyOwnerUserId !== undefined) {
    const id = body.spotifyOwnerUserId;
    if (
      id !== null &&
      (typeof id !== 'string' || !all('SELECT 1 FROM users WHERE id = ?', id).length)
    ) {
      throw new ApiError(400, 'spotifyOwnerUserId must be a user id or null.');
    }
    patch.spotifyOwnerUserId = id;
  }
  if (body.logRetentionDays !== undefined) {
    if (!intIn(body.logRetentionDays, 1, 365))
      throw new ApiError(400, 'Log retention must be 1–365 days.');
    patch.logRetentionDays = body.logRetentionDays as number;
  }
  updateServerSettings(patch);
  log(`admin updated settings: ${Object.keys(patch).join(', ') || 'nothing'}`);
  return c.json(settingsView());
});

adminApi.get('/models', async (c) => {
  const visionOnly = c.req.query('vision') !== '0';
  const routers = c.req.query('routers') === '1';
  try {
    return c.json(visionOnly ? await visionModels({ routers }) : await allModels({ routers }));
  } catch {
    throw new ApiError(502, 'Couldn’t load models from OpenRouter.');
  }
});

/** Each AI step's model (override or default) and its last-30-day averages from ai_calls. */
adminApi.get('/step-models', (c) => c.json(stepModelsView()));

export function stepModelsView() {
  const s = serverSettings();
  const since = Date.now() - 30 * 86_400_000;
  const stats = new Map(
    all<{ key: string; calls: number; cost: number; pt: number; ct: number }>(
      `SELECT prompt_key AS key, COUNT(*) AS calls, AVG(cost_usd) AS cost, AVG(prompt_tokens) AS pt, AVG(completion_tokens) AS ct
       FROM ai_calls WHERE created_at >= ? GROUP BY prompt_key`,
      since,
    ).map((r) => [r.key, r]),
  );
  return PROMPT_KEYS.map((key) => {
    const def = promptDef(key)!;
    const override = s.stepModels[key] ?? null;
    const eff = override ?? s.model;
    const st = stats.get(key);
    return {
      key,
      label: def.title,
      description: def.description,
      vision: VISION_STEPS.has(key),
      model: override,
      effective: { id: eff.id, name: eff.name },
      last30d: {
        calls: st?.calls ?? 0,
        avgCostUsd: st ? Math.round(st.cost * 1e6) / 1e6 : 0,
        avgPromptTokens: st ? Math.round(st.pt) : 0,
        avgCompletionTokens: st ? Math.round(st.ct) : 0,
      },
    };
  });
}

// Integrations -------------------------------------------------------------------

function integrationsView() {
  const key = openRouterKey();
  const id = spotifyClientId();
  const secret = spotifyClientSecret();
  return {
    openrouter: key ? { set: true, hint: keyHint(key) } : { set: false },
    spotify: {
      ...(id ? { clientId: id } : {}),
      secretSet: !!secret,
      ...(secret ? { secretHint: secretHint(secret) } : {}),
    },
  };
}

adminApi.get('/integrations', (c) => c.json(integrationsView()));

async function replaceOpenRouterKey(c: Context) {
  const { key } = await readJson(c);
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k || k.length > 500) throw new ApiError(400, 'Paste an OpenRouter key.');
  let result;
  try {
    result = await checkKey(k);
  } catch {
    throw new ApiError(502, 'Couldn’t reach OpenRouter to check the key. Try again.');
  }
  if (!result.ok) throw new ApiError(400, result.error ?? 'OpenRouter rejected the key.');
  setOpenRouterKey(k);
  log('admin replaced the OpenRouter key');
}

adminApi.put('/integrations/openrouter', async (c) => {
  await replaceOpenRouterKey(c);
  return c.json(integrationsView());
});
// Older path, kept for the previous admin page.
adminApi.put('/openrouter-key', async (c) => {
  await replaceOpenRouterKey(c);
  return c.json(settingsView());
});

adminApi.put('/integrations/spotify', async (c) => {
  const { clientId, clientSecret } = await readJson(c);
  const id = typeof clientId === 'string' ? clientId.trim() : undefined;
  const secret = typeof clientSecret === 'string' ? clientSecret.trim() : undefined;
  if (id === undefined && secret === undefined)
    throw new ApiError(400, 'Send clientId and/or clientSecret.');
  if (id !== undefined && !/^[A-Za-z0-9]{16,64}$/.test(id))
    throw new ApiError(400, 'That doesn’t look like a Spotify client ID.');
  if (secret !== undefined && !/^[A-Za-z0-9]{16,64}$/.test(secret)) {
    throw new ApiError(400, 'That doesn’t look like a Spotify client secret.');
  }
  const testId = id ?? spotifyClientId();
  const testSecret = secret ?? spotifyClientSecret();
  if (!testId || !testSecret)
    throw new ApiError(400, 'Set both the client ID and the client secret.');
  try {
    await requestAppToken(testId, testSecret);
  } catch (e) {
    if (e instanceof SpotifyHttpError)
      throw new ApiError(400, 'Spotify rejected these credentials.');
    throw new ApiError(502, 'Couldn’t reach Spotify to check the credentials. Try again.');
  }
  setSpotifyCredentials(id, secret);
  resetAppToken();
  log(
    `admin replaced Spotify ${[id !== undefined && 'client ID', secret !== undefined && 'client secret'].filter(Boolean).join(' and ')}`,
  );
  return c.json(integrationsView());
});

adminApi.post('/openrouter-key/test', async (c) => {
  const key = openRouterKey();
  if (!key) return c.json({ ok: false, error: 'No key is set.' });
  try {
    return c.json(await checkKey(key));
  } catch {
    return c.json({ ok: false, error: 'Couldn’t reach OpenRouter.' });
  }
});

// Checks & logs -------------------------------------------------------------------

adminApi.post('/checks/run', async (c) => {
  const { checks } = await readJson(c);
  if (
    checks !== undefined &&
    (!Array.isArray(checks) || !checks.every((x) => CHECKS.some((k) => k.id === x)))
  ) {
    throw new ApiError(400, `checks must be a list of: ${CHECKS.map((k) => k.id).join(', ')}.`);
  }
  return c.json(await runChecks(checks as string[] | undefined));
});

export function logFilterFrom(
  q: (name: string) => string | undefined,
  qs: (name: string) => string[] | undefined,
): LogFilter {
  const integrations = (qs('integration') ?? [])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  const ok = q('ok');
  return {
    ...(integrations.length ? { integrations } : {}),
    ...(q('user') ? { user: q('user') } : {}),
    ...(ok === 'ok' || ok === 'failed' ? { ok } : {}),
    ...(q('operation') ? { operation: q('operation') } : {}),
    ...(q('job') ? { job: q('job') } : {}),
    ...(parseTime(q('from'), false) !== undefined ? { from: parseTime(q('from'), false) } : {}),
    ...(parseTime(q('to'), true) !== undefined ? { to: parseTime(q('to'), true) } : {}),
    ...(q('cursor') ? { cursor: q('cursor') } : {}),
  };
}

adminApi.get('/logs', (c) =>
  c.json(
    queryLogs(
      logFilterFrom(
        (n) => c.req.query(n) || undefined,
        (n) => c.req.queries(n),
      ),
    ),
  ),
);

// Usage -------------------------------------------------------------------

adminApi.get('/usage', async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 30) || 30));
  const key = openRouterKey();
  const cr = key ? await credits(key).catch(() => null) : null;
  return c.json({ credits: cr, ...usageBreakdown(days) });
});

// Users -------------------------------------------------------------------

adminApi.get('/users', (c) => c.json(usersList()));

adminApi.post('/users/:id/spotify/disconnect', (c) => {
  const id = c.req.param('id');
  if (!all('SELECT 1 FROM users WHERE id = ?', id).length) throw new ApiError(404, 'No such user.');
  clearSpotify(id);
  // Disconnecting frees the slot: drop their approval too (they can request again).
  if (getSpotifyAccess(id).status === 'approved') setSpotifyAccess(id, { status: 'none' });
  log(`admin disconnected Spotify for user ${id}`);
  return c.json({ ok: true });
});

// Spotify access requests -------------------------------------------------------

export function spotifyAccessList() {
  return all<{
    id: string;
    email: string;
    name: string | null;
    spotify_access: string | null;
    connected: number;
  }>(
    `SELECT id, email, name, spotify_access, (spotify_tokens IS NOT NULL) AS connected FROM users
     WHERE spotify_access IS NOT NULL OR spotify_tokens IS NOT NULL ORDER BY created_at`,
  ).map((r) => {
    const a = r.spotify_access
      ? (JSON.parse(r.spotify_access) as StoredSpotifyAccess)
      : ({ status: 'none' } as StoredSpotifyAccess);
    return {
      userId: r.id,
      email: r.email,
      ...(r.name ? { name: r.name } : {}),
      access: a,
      connected: !!r.connected,
    };
  });
}

/** Waiting requests (connected users and the owner never count as pending). */
export const pendingSpotifyRequests = () =>
  all(
    `SELECT 1 FROM users WHERE json_extract(spotify_access, '$.status') = 'requested'
       AND spotify_tokens IS NULL AND id IS NOT ?`,
    serverSettings().spotifyOwnerUserId,
  ).length;

adminApi.get('/spotify-access', (c) =>
  c.json({
    items: spotifyAccessList(),
    used: spotifySlotsUsed(),
    cap: serverSettings().spotifyUserCap,
  }),
);

function accessFor(c: Context) {
  const id = c.req.param('userId') ?? '';
  if (!all('SELECT 1 FROM users WHERE id = ?', id).length) throw new ApiError(404, 'No such user.');
  return { id, access: getSpotifyAccess(id) };
}

adminApi.post('/spotify-access/:userId/approve', async (c) => {
  const { id, access } = accessFor(c);
  if (access.status !== 'requested') throw new ApiError(409, 'This user has no pending request.');
  setSpotifyAccess(id, { ...access, status: 'approved', at: Date.now() });
  log(`admin approved Spotify access for user ${id}`);
  await notifyUser(getNtfyTopic(id), {
    title: 'Spotify access approved',
    body: 'You can connect Spotify in Post It Up now',
    click: 'postitup://settings',
    tags: 'musical_note',
  });
  return c.json({ ok: true });
});

adminApi.post('/spotify-access/:userId/decline', async (c) => {
  const { id, access } = accessFor(c);
  const { note } = await readJson(c);
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 300)) {
    throw new ApiError(400, 'The note must be text (300 characters max).');
  }
  if (access.status !== 'requested') throw new ApiError(409, 'This user has no pending request.');
  const n = typeof note === 'string' ? note.trim() : '';
  setSpotifyAccess(id, { status: 'declined', at: Date.now(), ...(n ? { note: n } : {}) });
  log(`admin declined Spotify access for user ${id}`);
  await notifyUser(getNtfyTopic(id), {
    title: 'Spotify access request',
    body: "Your Spotify access request wasn't approved",
    click: 'postitup://settings',
    tags: 'musical_note',
  });
  return c.json({ ok: true });
});

adminApi.post('/spotify-access/:userId/revoke', (c) => {
  const { id } = accessFor(c);
  setSpotifyAccess(id, { status: 'none' });
  clearSpotify(id);
  log(`admin revoked Spotify access for user ${id}`);
  return c.json({ ok: true });
});

export function usersList() {
  const today = new Date().toISOString().slice(0, 10);
  const spend = spendByUser();
  return all<{
    id: string;
    email: string;
    name: string | null;
    created_at: number;
    spotify: number;
    today: number | null;
    total: number;
  }>(
    `SELECT u.id, u.email, u.name, u.created_at,
            (u.spotify_tokens IS NOT NULL) AS spotify,
            (SELECT count FROM job_usage WHERE user_id = u.id AND day = ?) AS today,
            (SELECT COUNT(*) FROM jobs WHERE user_id = u.id) AS total
     FROM users u ORDER BY u.created_at DESC`,
    today,
  ).map((r) => ({
    id: r.id,
    email: r.email,
    ...(r.name ? { name: r.name } : {}),
    createdAt: r.created_at,
    spotify: !!r.spotify,
    postsToday: r.today ?? 0,
    postsTotal: r.total,
    spendUsd: spend.get(r.id) ?? 0,
  }));
}

// Prompts -------------------------------------------------------------------

function promptKey(c: Context): PromptKey {
  const key = c.req.param('key') ?? '';
  if (!promptDef(key)) throw new ApiError(404, 'No such prompt.');
  return key as PromptKey;
}

adminApi.get('/prompts', (c) => c.json(listPrompts()));
adminApi.get('/prompts/:key/versions', (c) => c.json(listVersions(promptKey(c))));

adminApi.post('/prompts/:key', async (c) => {
  const key = promptKey(c);
  const { body, note } = await readJson(c);
  if (typeof body !== 'string' || body.trim().length < 20 || body.length > 20_000) {
    throw new ApiError(400, 'The prompt must be 20 to 20,000 characters.');
  }
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 300)) {
    throw new ApiError(400, 'The note must be text (300 characters max).');
  }
  const version = createVersion(key, body, typeof note === 'string' ? note.trim() : '');
  log(`admin saved prompt ${key} v${version}`);
  return c.json({ version }, 201);
});

adminApi.post('/prompts/:key/activate', async (c) => {
  const key = promptKey(c);
  const { version } = await readJson(c);
  if (!Number.isInteger(version) || !activateVersion(key, version as number))
    throw new ApiError(404, 'No such version.');
  log(`admin activated prompt ${key} v${String(version)}`);
  return c.json({ ok: true });
});

// Account -------------------------------------------------------------------

export function accountView() {
  const a = getAccount();
  return a
    ? {
        username: a.username,
        updatedAt: a.updated_at,
        lastLoginAt: a.last_login_at,
        lastLoginIp: a.last_login_ip,
        previousLoginAt: a.prev_login_at,
        previousLoginIp: a.prev_login_ip,
        weakPassword: !!a.weak_password,
      }
    : null;
}

adminApi.get('/account', (c) => c.json(accountView()));

adminApi.post('/account/password', async (c) => {
  const { currentPassword, newPassword } = await readJson(c);
  const account = getAccount();
  if (!account) throw new ApiError(409, 'There is no admin account.');
  if (
    typeof currentPassword !== 'string' ||
    !(await verifyPassword(currentPassword, account.password_hash))
  ) {
    throw new ApiError(400, 'The current password is wrong.');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 200) {
    throw new ApiError(400, 'The new password must be at least 10 characters.');
  }
  if (newPassword === currentPassword)
    throw new ApiError(400, 'The new password must be different.');
  await changePassword(newPassword);
  endOtherSessions(c.get('adminSession'));
  log('admin password changed; other admin sessions signed out');
  return c.json({ ok: true });
});

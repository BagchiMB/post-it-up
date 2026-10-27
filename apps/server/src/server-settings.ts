import { DEFAULT_CLIP_LENGTHS, DEFAULT_LOW_FIT_THRESHOLD } from '@postitup/shared';

import { config } from './config.ts';
import { decrypt, encrypt } from './crypto.ts';
import { all, run } from './db.ts';
import { log } from './log.ts';
import type { ModelChoice } from './openrouter.ts';

/**
 * Runtime settings, editable from the admin page. Stored in `server_settings` (one JSON value
 * per key), seeded from env on first boot, read through a cache that every write refreshes.
 */
export type ServerSettings = {
  /** The default model; each AI step uses `stepModels[step] ?? model`. */
  model: ModelChoice;
  stepModels: Partial<
    Record<
      'shortlist' | 'final_post' | 'song_clip' | 'song_clip_estimate' | 'song_change',
      ModelChoice
    >
  >;
  dailyJobLimit: number;
  /** Allowed song clip lengths in seconds, ascending; the model picks one per song. */
  clipLengths: number[];
  dailyMusicChangeLimit: number;
  /** Days of integration_calls history to keep. */
  logRetentionDays: number;
  /** Most users with a Spotify connection at once (Spotify dev-mode apps allow few users). */
  spotifyUserCap: number;
  /** The app user who owns the Spotify app: may connect without an access request. */
  spotifyOwnerUserId: string | null;
  /** Below this fit score (0–100) a restricted-source song also gets an `alternative`. */
  lowFitThreshold: number;
};

const KEY_CONTEXT = 'server:openrouter';

const SPOTIFY_SECRET_CONTEXT = 'server:spotify-secret';

let cache: {
  settings: ServerSettings;
  openRouterKey: string | null;
  spotifyClientId: string | null;
  spotifySecret: string | null;
} | null = null;

function decryptOrNull(stored: unknown, context: string, what: string) {
  if (typeof stored !== 'string') return null;
  try {
    return decrypt(stored, context);
  } catch {
    log(
      `stored ${what} could not be decrypted (master key changed?) — set it again in /admin/integrations`,
    );
    return null;
  }
}

function load() {
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM server_settings');
  const map = new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  const openRouterKey = decryptOrNull(map.get('openRouterKey'), KEY_CONTEXT, 'OpenRouter key');
  const spotifySecret = decryptOrNull(
    map.get('spotifySecret'),
    SPOTIFY_SECRET_CONTEXT,
    'Spotify client secret',
  );
  const clientId = map.get('spotifyClientId');
  cache = {
    settings: {
      model: map.get('model') as ModelChoice,
      stepModels: (map.get('stepModels') as ServerSettings['stepModels'] | undefined) ?? {},
      dailyJobLimit: map.get('dailyJobLimit') as number,
      clipLengths: map.get('clipLengths') as number[],
      dailyMusicChangeLimit: map.get('dailyMusicChangeLimit') as number,
      logRetentionDays: map.get('logRetentionDays') as number,
      spotifyUserCap: map.get('spotifyUserCap') as number,
      spotifyOwnerUserId: (map.get('spotifyOwnerUserId') as string | null | undefined) ?? null,
      lowFitThreshold: map.get('lowFitThreshold') as number,
    },
    openRouterKey,
    spotifyClientId: typeof clientId === 'string' && clientId ? clientId : null,
    spotifySecret,
  };
  return cache;
}

const put = (key: string, value: unknown) =>
  run(
    `INSERT INTO server_settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    JSON.stringify(value),
  );

const putIfMissing = (key: string, value: unknown) =>
  run(
    'INSERT OR IGNORE INTO server_settings (key, value) VALUES (?, ?)',
    key,
    JSON.stringify(value),
  );

/** First boot (or a newly added setting): fill missing values from env. Never overwrites admin edits. */
export function seedServerSettings() {
  putIfMissing('model', { id: config.defaultModel, name: config.defaultModel });
  putIfMissing('dailyJobLimit', config.dailyJobLimit);
  putIfMissing('clipLengths', DEFAULT_CLIP_LENGTHS);
  putIfMissing('dailyMusicChangeLimit', 30);
  putIfMissing('logRetentionDays', 30);
  putIfMissing('spotifyUserCap', 5);
  putIfMissing('lowFitThreshold', DEFAULT_LOW_FIT_THRESHOLD);
  putIfMissing('stepModels', {});
  if (config.openRouterKey) {
    const res = putIfMissing('openRouterKey', encrypt(config.openRouterKey, KEY_CONTEXT));
    if (Number(res.changes) > 0) log('OpenRouter key seeded from OPENROUTER_API_KEY');
  }
  if (config.spotifyClientId) putIfMissing('spotifyClientId', config.spotifyClientId);
  if (config.spotifyClientSecret) {
    const res = putIfMissing(
      'spotifySecret',
      encrypt(config.spotifyClientSecret, SPOTIFY_SECRET_CONTEXT),
    );
    if (Number(res.changes) > 0) log('Spotify client secret seeded from SPOTIFY_CLIENT_SECRET');
  }
  load();
}

export const serverSettings = (): ServerSettings => (cache ?? load()).settings;
export const openRouterKey = (): string | null => (cache ?? load()).openRouterKey;
export const spotifyClientId = (): string | null => (cache ?? load()).spotifyClientId;
export const spotifyClientSecret = (): string | null => (cache ?? load()).spotifySecret;

export function setSpotifyCredentials(clientId: string | undefined, secret: string | undefined) {
  if (clientId !== undefined) put('spotifyClientId', clientId);
  if (secret !== undefined) put('spotifySecret', encrypt(secret, SPOTIFY_SECRET_CONTEXT));
  load();
}

export function updateServerSettings(patch: Partial<ServerSettings>) {
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) put(k, v);
  load();
}

export function setOpenRouterKey(key: string) {
  put('openRouterKey', encrypt(key, KEY_CONTEXT));
  load();
}

/** "sk-or-…abcd" — enough to recognise the key, never the key itself. */
export function keyHint(key: string) {
  const prefix = key.startsWith('sk-or-') ? 'sk-or-' : key.slice(0, 3);
  return `${prefix}…${key.slice(-4)}`;
}

export const secretHint = (secret: string) => `••••${secret.slice(-4)}`;

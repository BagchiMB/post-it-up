import {
  type CaptionTone,
  defaultUserSettings,
  type InstagramProfile,
  type Me,
  type SpotifyAccess,
  type SpotifyProfile,
  type SpotifyTokens,
  type TaskConfig,
  type UserSettings,
} from '@postitup/shared';

import { decrypt, encrypt, newId, randomAlnum } from './crypto.ts';
import { one, run } from './db.ts';
import { ApiError } from './http.ts';
import { parseMusic } from './music.ts';
import { serverSettings } from './server-settings.ts';
import { parsePosts, parseTaskConfig } from './task.ts';

/** Stored form: the public SpotifyAccess plus the optional display name from the request. */
export type StoredSpotifyAccess = SpotifyAccess & { name?: string };

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  ntfy_topic: string;
  settings: string;
  spotify_tokens: string | null;
  spotify_profile: string | null;
  spotify_access: string | null;
};

export const defaultSettings = defaultUserSettings;

/** Finds the user for a sign-in identity, creating it on first sign-in; refreshes profile fields. */
export function upsertUser(
  identity: string,
  profile: { email: string; name?: string; picture?: string },
) {
  const existing = one<{ id: string }>('SELECT id FROM users WHERE identity = ?', identity);
  if (existing) {
    run(
      'UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?',
      profile.email,
      profile.name ?? null,
      profile.picture ?? null,
      existing.id,
    );
    return { id: existing.id, created: false };
  }
  const id = newId();
  run(
    `INSERT INTO users (id, identity, email, name, picture, ntfy_topic, settings, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    identity,
    profile.email,
    profile.name ?? null,
    profile.picture ?? null,
    `postitup-${randomAlnum(16)}`,
    JSON.stringify(defaultSettings()),
    Date.now(),
  );
  return { id, created: true };
}

function row(userId: string) {
  const r = one<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!r) throw new ApiError(401, 'Please sign in again.');
  return r;
}

export function getMe(userId: string): Me {
  const r = row(userId);
  return {
    id: r.id,
    email: r.email,
    ...(r.name ? { name: r.name } : {}),
    ...(r.picture ? { picture: r.picture } : {}),
    ntfyTopic: r.ntfy_topic,
    spotify:
      r.spotify_tokens && r.spotify_profile
        ? (JSON.parse(r.spotify_profile) as SpotifyProfile)
        : null,
    spotifyAccess: publicAccess(r),
    settings: JSON.parse(r.settings) as UserSettings,
  };
}

export const getSettings = (userId: string) => JSON.parse(row(userId).settings) as UserSettings;
export const getNtfyTopic = (userId: string) => row(userId).ntfy_topic;

export function setSettings(userId: string, settings: UserSettings) {
  run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(settings), userId);
}

// Spotify tokens (encrypted at rest; the AAD ties each ciphertext to its user and field)

export function getSpotifyTokens(userId: string): SpotifyTokens | null {
  const v = row(userId).spotify_tokens;
  return v ? (JSON.parse(decrypt(v, `${userId}:spotify`)) as SpotifyTokens) : null;
}

export function setSpotifyTokens(userId: string, tokens: SpotifyTokens) {
  run(
    'UPDATE users SET spotify_tokens = ? WHERE id = ?',
    encrypt(JSON.stringify(tokens), `${userId}:spotify`),
    userId,
  );
}

export function setSpotify(userId: string, tokens: SpotifyTokens, profile: SpotifyProfile) {
  setSpotifyTokens(userId, tokens);
  run('UPDATE users SET spotify_profile = ? WHERE id = ?', JSON.stringify(profile), userId);
}

/** Users with stored Spotify tokens. */
export const spotifyConnectedCount = () =>
  one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE spotify_tokens IS NOT NULL')?.n ?? 0;

/** What the Spotify cap counts: users who are connected, approved, or waiting for approval. */
export const spotifySlotsUsed = () =>
  one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users WHERE spotify_tokens IS NOT NULL
       OR (json_extract(spotify_access, '$.status') IN ('requested', 'approved') AND id IS NOT ?)`,
    serverSettings().spotifyOwnerUserId,
  )?.n ?? 0;

function storedAccess(r: { spotify_access: string | null }): StoredSpotifyAccess {
  return r.spotify_access
    ? (JSON.parse(r.spotify_access) as StoredSpotifyAccess)
    : { status: 'none' };
}

/** Connected users and the Spotify owner are reported as approved (the app has no owner flag). */
function publicAccess(r: {
  id: string;
  email: string;
  spotify_access: string | null;
  spotify_tokens: string | null;
}): SpotifyAccess {
  const a = storedAccess(r);
  const { name: _n, ...pub } = a;
  const isOwner = serverSettings().spotifyOwnerUserId === r.id;
  if ((r.spotify_tokens || isOwner) && pub.status !== 'approved') {
    return {
      status: 'approved',
      spotifyEmail: 'spotifyEmail' in pub && pub.spotifyEmail ? pub.spotifyEmail : r.email,
      at: 'at' in pub ? pub.at : 0,
    };
  }
  return pub;
}

export const getSpotifyAccess = (userId: string) => storedAccess(row(userId));

export function setSpotifyAccess(userId: string, access: StoredSpotifyAccess) {
  run(
    'UPDATE users SET spotify_access = ? WHERE id = ?',
    access.status === 'none' ? null : JSON.stringify(access),
    userId,
  );
}

export function clearSpotify(userId: string) {
  run('UPDATE users SET spotify_tokens = NULL, spotify_profile = NULL WHERE id = ?', userId);
}

// Validation of PUT /me/settings

const TONES: CaptionTone[] = ['casual', 'witty', 'poetic', 'minimal'];
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

export function parseSettings(body: Record<string, unknown>): UserSettings {
  const bad = (what: string): never => {
    throw new ApiError(400, `Invalid settings: ${what}.`);
  };
  if (typeof body.onboarded !== 'boolean') bad('onboarded must be true or false');
  const r = body.reminder;
  if (!isObj(r) || !isInt(r.hour, 0, 23) || !isInt(r.minute, 0, 59))
    bad('reminder needs hour 0–23 and minute 0–59');
  const rem = r as { hour: number; minute: number };

  // `model` is no longer a user setting (the server picks the model); ignore it if sent.

  if (!Array.isArray(body.accounts) || body.accounts.length > 50) bad('accounts must be a list');
  const accounts = (body.accounts as unknown[]).map((a, i): InstagramProfile => {
    const at = `accounts[${i}]`;
    if (!isObj(a)) return bad(`${at} must be an object`);
    if (!str(a.id, 100) || !a.id) bad(`${at}.id is required`);
    if (!str(a.handle, 100)) bad(`${at}.handle must be text`);
    if (a.avatarUri !== undefined && a.avatarUri !== null && !str(a.avatarUri, 500_000)) {
      bad(`${at}.avatarUri must be a small data URI`);
    }
    if (!TONES.includes(a.tone as CaptionTone))
      bad(`${at}.tone must be one of ${TONES.join(', ')}`);
    if (typeof a.emojis !== 'boolean') bad(`${at}.emojis must be true or false`);
    if (!str(a.hashtags, 2000)) bad(`${at}.hashtags must be text`);
    if (!Array.isArray(a.activeDays) || !a.activeDays.every((d) => isInt(d, 0, 6))) {
      bad(`${at}.activeDays must be days 0–6`);
    }
    return {
      id: a.id as string,
      handle: a.handle as string,
      ...(typeof a.avatarUri === 'string' ? { avatarUri: a.avatarUri } : {}),
      tone: a.tone as CaptionTone,
      emojis: a.emojis as boolean,
      hashtags: a.hashtags as string,
      activeDays: [...new Set(a.activeDays as number[])].sort((x, y) => x - y),
    };
  });

  const lastMusic =
    body.lastMusic === undefined || body.lastMusic === null
      ? undefined
      : parseMusic(body.lastMusic, 'settings.lastMusic');

  const lastPosts =
    body.lastPosts === undefined || body.lastPosts === null
      ? undefined
      : parsePosts(body.lastPosts, 'settings.lastPosts');
  let dailyTask: (TaskConfig & { enabled: boolean }) | undefined;
  if (body.dailyTask !== undefined && body.dailyTask !== null) {
    const d = body.dailyTask;
    if (!isObj(d)) bad('dailyTask must be an object');
    const dt = d as Record<string, unknown>;
    if (typeof dt.enabled !== 'boolean') bad('dailyTask.enabled must be true or false');
    dailyTask = { ...parseTaskConfig(dt, 'settings.dailyTask'), enabled: dt.enabled as boolean };
  }

  return {
    onboarded: body.onboarded as boolean,
    ...(lastMusic ? { lastMusic } : {}),
    ...(lastPosts ? { lastPosts } : {}),
    ...(dailyTask ? { dailyTask } : {}),
    reminder: { hour: rem.hour, minute: rem.minute },
    accounts,
  };
}

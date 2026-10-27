import type { Me } from '@postitup/shared';
import { useSyncExternalStore } from 'react';

import { api, ApiError, setAuthToken, setUnauthorizedHandler } from '@/lib/api';
import { cancelDailyReminder, scheduleDailyReminder } from '@/lib/notifications';
import { startServerWatch, stopServerWatch } from '@/lib/server-watch';
import { kv, secrets } from '@/lib/storage';

import { loadCachedJobs, resetJobs } from './jobs';
import {
  cachedSettings,
  flushSettings,
  hasPendingSettings,
  hydrateSettings,
  resetSettings,
} from './settings';

export type Session =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Me };

const TOKEN = 'session.token';
const ME_CACHE = 'me.v1';
/** Keys from the on-phone version of the app, removed on first launch of this one. */
const LEGACY_KV = ['settings.v1', 'drafts.v1'];
const LEGACY_SECRETS = ['openrouter.apiKey', 'spotify.tokens'];

let session: Session = { status: 'loading' };
/** Kept after sign-out so screens that are animating away can still render. */
let lastMe: Me | undefined;
const listeners = new Set<() => void>();

function set(next: Session) {
  session = next;
  if (next.status === 'signedIn') lastMe = next.me;
  listeners.forEach((l) => l());
}

setUnauthorizedHandler(() => void signOut({ remote: false }));

let loading: Promise<void> | undefined;

/**
 * At launch: restores the saved session. Works offline from the cached profile.
 * Safe to call more than once (the background task awaits it too).
 */
export function loadSession() {
  loading ??= restoreSession();
  return loading;
}

export const getSession = () => session;

async function restoreSession() {
  LEGACY_KV.forEach((k) => void kv.remove(k).catch(() => {}));
  LEGACY_SECRETS.forEach((k) => void secrets.remove(k).catch(() => {}));

  const token = await secrets.get(TOKEN);
  if (!token) return set({ status: 'signedOut' });
  setAuthToken(token);

  const raw = await kv.get(ME_CACHE);
  if (raw) {
    // Open instantly (and offline) from the cached profile, then refresh from the server.
    const cached = JSON.parse(raw) as Me;
    enter({ ...cached, settings: (await cachedSettings()) ?? cached.settings });
    void refreshMe();
    return;
  }
  try {
    enter(await api<Me>('GET', '/me'));
  } catch (e) {
    // A 401 already signed us out; otherwise the server is down and there's nothing cached.
    if (!(e instanceof ApiError && e.status === 401)) set({ status: 'signedOut' });
  }
}

/** Re-reads the profile from the server; keeps local settings edits that haven't synced yet. */
export async function refreshMe() {
  try {
    const me = await api<Me>('GET', '/me');
    if (session.status !== 'signedIn') return;
    if (!hasPendingSettings()) hydrateSettings(me.settings);
    cacheMe(me);
    set({ status: 'signedIn', me });
  } catch {
    // Offline: keep showing the cached profile.
  }
}

/** Google sign-in: trades Google's ID token for a session. */
export const signInWithGoogle = (idToken: string) => start('/auth/google', { idToken });

/** Local testing only (server runs with DEV_LOGIN=1). */
export const signInAsDeveloper = (email: string) => start('/auth/dev', { email: email.trim() });

async function start(path: string, body: object) {
  const { token, me } = await api<{ token: string; me: Me }>('POST', path, { body });
  await secrets.set(TOKEN, token);
  setAuthToken(token);
  enter(me);
}

function enter(me: Me) {
  hydrateSettings(me.settings);
  void loadCachedJobs();
  cacheMe(me);
  set({ status: 'signedIn', me });
  void startServerWatch().catch(() => {});
  // Reminders are per user; restore this user's (no-op without notification permission).
  if (me.settings.onboarded)
    void scheduleDailyReminder(me.settings.reminder, {
      dailyTask: !!me.settings.dailyTask?.enabled,
    }).catch(() => {});
}

/** Signs out and clears everything stored for this user on the phone. */
export async function signOut({ remote = true }: { remote?: boolean } = {}) {
  if (session.status === 'signedOut') return;
  if (remote) {
    await flushSettings().catch(() => {});
    await api('POST', '/auth/logout').catch(() => {});
  }
  setAuthToken(null);
  set({ status: 'signedOut' });
  resetSettings();
  resetJobs();
  await Promise.all([
    secrets.remove(TOKEN),
    kv.remove(ME_CACHE),
    cancelDailyReminder(),
    stopServerWatch(),
  ]).catch(() => {});
}

/** Applies a change the server confirmed (e.g. key saved, Spotify connected). */
export function patchMe(patch: Partial<Omit<Me, 'settings'>>) {
  if (session.status !== 'signedIn') return;
  const me = { ...session.me, ...patch };
  cacheMe(me);
  set({ status: 'signedIn', me });
}

function cacheMe(me: Me) {
  void kv.set(ME_CACHE, JSON.stringify(me));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSession() {
  return useSyncExternalStore(subscribe, () => session);
}

/** The signed-in user. Only use on screens behind the sign-in guard. */
export function useMe(): Me {
  const s = useSession();
  if (s.status === 'signedIn') return s.me;
  if (lastMe) return lastMe;
  throw new Error('useMe() needs a signed-in session');
}

import { defaultUserSettings, type InstagramProfile, type UserSettings } from '@postitup/shared';
import { useSyncExternalStore } from 'react';

import { api } from '@/lib/api';
import { kv } from '@/lib/storage';

/** Offline copy, so the app opens with your settings even when the server is down. */
export const SETTINGS_CACHE = 'settings.v2';
const SYNC_DELAY = 600;
const RETRY_DELAY = 15_000;

export const defaultSettings: UserSettings = defaultUserSettings();

let state: UserSettings = defaultSettings;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped on sign-in/out so a sync that finishes late doesn't retry for the wrong user. */
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Replaces the local copy with settings from the server (or the offline cache). */
export function hydrateSettings(next: UserSettings) {
  clearTimeout(syncTimer);
  generation++;
  state = { ...defaultSettings, ...next };
  void kv.set(SETTINGS_CACHE, JSON.stringify(state));
  emit();
}

export async function cachedSettings(): Promise<UserSettings | null> {
  const raw = await kv.get(SETTINGS_CACHE);
  return raw ? (JSON.parse(raw) as UserSettings) : null;
}

/** Sign-out: forget everything about the previous user. */
export function resetSettings() {
  clearTimeout(syncTimer);
  generation++;
  state = defaultSettings;
  void kv.remove(SETTINGS_CACHE);
  emit();
}

export function getSettings() {
  return state;
}

/** Updates right away and saves to the server shortly after (edits in a burst are sent once). */
export function updateSettings(
  patch: Partial<UserSettings> | ((s: UserSettings) => Partial<UserSettings>),
) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  void kv.set(SETTINGS_CACHE, JSON.stringify(state));
  emit();
  scheduleSync(SYNC_DELAY);
}

function scheduleSync(delay: number) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void sync();
  }, delay);
}

async function sync() {
  const gen = generation;
  try {
    await api('PUT', '/me/settings', { body: state });
  } catch {
    // Server down or a hiccup: try again later. A 401 signs out, which bumps `generation`.
    if (gen === generation && !syncTimer) scheduleSync(RETRY_DELAY);
  }
}

export const hasPendingSettings = () => !!syncTimer;

/** Sends a pending change now (before signing out). */
export async function flushSettings() {
  if (!syncTimer) return;
  clearTimeout(syncTimer);
  syncTimer = undefined;
  await sync();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettings() {
  return useSyncExternalStore(subscribe, () => state);
}

// Instagram profile helpers

export function newProfile(): InstagramProfile {
  return {
    id: Math.random().toString(36).slice(2, 10),
    handle: '',
    tone: 'casual',
    emojis: true,
    hashtags: '',
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  };
}

export function saveProfile(profile: InstagramProfile) {
  updateSettings((s) => {
    const exists = s.accounts.some((a) => a.id === profile.id);
    return {
      accounts: exists
        ? s.accounts.map((a) => (a.id === profile.id ? profile : a))
        : [...s.accounts, profile],
    };
  });
}

export function removeProfile(id: string) {
  updateSettings((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }));
}

export function formatTime({ hour, minute }: { hour: number; minute: number }) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

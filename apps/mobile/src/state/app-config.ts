import { type AppConfig, DEFAULT_LOW_FIT_THRESHOLD } from '@postitup/shared';
import { useEffect, useSyncExternalStore } from 'react';

import { api } from '@/lib/api';
import { useAppActive } from '@/lib/app-state';
import { kv } from '@/lib/storage';

export const SPOTIFY_FULL = 'Spotify sign-in is full. Use playlists, artists or AI pick instead.';

const CACHE = 'appConfig.v1';
const ENV_SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';

/** Public settings from the server (`GET /config`), cached for offline starts. */
let config: AppConfig | undefined;
/** True once the cache was read (so screens know whether "missing" is final). */
let ready = false;
let fetched = false;
const listeners = new Set<() => void>();

function set(next: AppConfig | undefined) {
  config = next;
  ready = true;
  listeners.forEach((l) => l());
}

/** Reads the cached copy, then asks the server. Never throws. */
export async function loadAppConfig() {
  if (!config) {
    const raw = await kv.get(CACHE).catch(() => null);
    set(raw ? (JSON.parse(raw) as AppConfig) : config);
  }
  try {
    const fresh = await api<AppConfig>('GET', '/config', { timeoutMs: 5_000 });
    fetched = true;
    set(fresh);
    void kv.set(CACHE, JSON.stringify(fresh));
  } catch {
    // Offline or old server: keep the cached value (or the .env fallback).
  }
}

/** The Spotify client ID: the server's setting, else EXPO_PUBLIC_SPOTIFY_CLIENT_ID, else ''. */
export function getSpotifyClientId() {
  return config?.spotifyClientId || ENV_SPOTIFY_CLIENT_ID;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `loading` until the cached config has been read; then the ID or '' when Spotify isn't set up. */
export function useSpotifyClientId(): { clientId: string; loading: boolean } {
  const clientId = useSyncExternalStore(subscribe, getSpotifyClientId);
  const isReady = useSyncExternalStore(subscribe, () => ready);
  return { clientId, loading: !clientId && !isReady };
}

/** Whether new users can still connect Spotify (true until the server says otherwise). */
export function useSpotifyConnectAvailable() {
  return useSyncExternalStore(subscribe, () => config?.spotifyConnect?.available ?? true);
}

export function useLowFitThreshold() {
  return useSyncExternalStore(
    subscribe,
    () => config?.lowFitThreshold ?? DEFAULT_LOW_FIT_THRESHOLD,
  );
}

/** Loads the config at startup and again on foreground until the server has answered once. */
export function useAppConfigSync() {
  const active = useAppActive();
  useEffect(() => {
    if (active && !fetched) void loadAppConfig();
  }, [active]);
}

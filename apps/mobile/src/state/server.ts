import type { Health } from '@postitup/shared';
import { useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { fetchHealth } from '@/lib/api';
import { isAppActive } from '@/lib/app-state';

export type ServerStatus = 'unknown' | 'up' | 'down';

const POLL_MS = 30_000;

let status: ServerStatus = 'unknown';
let health: Health | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let appSub: NativeEventSubscription | undefined;
const listeners = new Set<() => void>();

// Always notifies: subscribers re-render only if their snapshot (status or devLogin) changed.
function set(next: ServerStatus) {
  status = next;
  listeners.forEach((l) => l());
}

/** Checks `/health` now. */
export async function checkServer() {
  health = await fetchHealth();
  set(health ? 'up' : 'down');
  return health;
}

/** A request just failed to reach the server; show it without waiting for the next check. */
export const reportServerDown = () => set('down');

export const getServerStatus = () => status;

// Polls only while some screen is watching the status.
function start() {
  void checkServer();
  timer = setInterval(() => {
    if (isAppActive()) void checkServer();
  }, POLL_MS);
  appSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void checkServer();
  });
}

function stop() {
  clearInterval(timer);
  appSub?.remove();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** "up" / "down" (or "unknown" before the first check); re-checked every 30 s and on app focus. */
export function useServerStatus() {
  return useSyncExternalStore(subscribe, () => status);
}

/** Whether the server offers developer sign-in (only meaningful once the status is "up"). */
export function useDevLoginAvailable() {
  return useSyncExternalStore(subscribe, () => status === 'up' && !!health?.devLogin);
}

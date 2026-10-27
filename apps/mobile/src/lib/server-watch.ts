import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { fetchHealth } from './api';
import { notifyServerDown } from './notifications';
import { kv } from './storage';

/** The one background task: checks the server and runs the daily task (defined in curation/background). */
export const BACKGROUND_TASK = 'server-health-check';
const LAST_ALERT = 'serverWatch.lastAlertAt';
/** At most one "server isn't running" notification in this window. */
const QUIET_MS = 6 * 60 * 60 * 1000;

/** Returns whether the server is up; if not, notifies (at most once every 6 hours). */
export async function checkServerInBackground() {
  if (await fetchHealth()) return true;
  const last = Number((await kv.get(LAST_ALERT)) ?? 0);
  if (Date.now() - last >= QUIET_MS) {
    await notifyServerDown();
    await kv.set(LAST_ALERT, String(Date.now()));
  }
  return false;
}

/** Asks iOS to check the server now and then while the app is in the background (signed in only). */
export async function startServerWatch() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) return;
  // iOS treats this as a minimum and picks the actual times itself.
  await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 60 });
}

export async function stopServerWatch() {
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK))
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK);
  await kv.remove(LAST_ALERT);
}

import { ApiError } from '@/lib/api';
import { loadJobs, toDay } from '@/state/jobs';
import { getSession, loadSession } from '@/state/session';
import { getSettings } from '@/state/settings';

import { NoPhotosError, uploadJob } from './upload';

export type DailyOutcome = 'off' | 'not-yet' | 'done' | 'started' | 'no-photos' | 'failed';

let running: Promise<DailyOutcome> | undefined;

/**
 * Starts today's automatic task if it's on, the reminder time has passed and it hasn't run yet.
 * Only the phone can read the photos, so this runs from the background task, the reminder
 * notification and app foreground. Concurrent calls share one run.
 */
export function runDailyTaskIfDue(): Promise<DailyOutcome> {
  running ??= run().finally(() => {
    running = undefined;
  });
  return running;
}

async function run(): Promise<DailyOutcome> {
  await loadSession();
  if (getSession().status !== 'signedIn') return 'off';
  const { dailyTask, reminder, onboarded } = getSettings();
  if (!onboarded || !dailyTask?.enabled) return 'off';

  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < reminder.hour * 60 + reminder.minute)
    return 'not-yet';

  const today = toDay(now);
  try {
    // At most one automatic task a day (the server also rejects a second with 409).
    const jobs = await loadJobs();
    if (jobs.some((j) => j.request.auto && j.request.from === today)) return 'done';

    const { enabled: _enabled, ...config } = dailyTask;
    await uploadJob({ ...config, from: today, to: today, auto: true }, () => {});
    return 'started';
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return 'done';
    if (e instanceof NoPhotosError) return 'no-photos';
    return 'failed';
  }
}

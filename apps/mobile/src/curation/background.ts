import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { BACKGROUND_TASK, checkServerInBackground } from '@/lib/server-watch';

import { runDailyTaskIfDue } from './daily';

// Must run at module load (global scope) so iOS can wake the app straight into the task.
// Registered on sign-in (startServerWatch); iOS decides when it actually runs.
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    if (await checkServerInBackground()) await runDailyTaskIfDue();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

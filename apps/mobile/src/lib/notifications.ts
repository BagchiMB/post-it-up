import * as Notifications from 'expo-notifications';
import { IosAuthorizationStatus } from 'expo-notifications';
import { useEffect } from 'react';

const DAILY_REMINDER = 'daily-reminder';

export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function requestNotificationPermission() {
  const p = await Notifications.requestPermissionsAsync();
  return p.granted || p.ios?.status === IosAuthorizationStatus.PROVISIONAL;
}

/**
 * Daily nudge at the chosen time. ("Post ready" alerts come from the server via ntfy.)
 * With the daily task on, tapping it opens the app, which starts today's task.
 */
export async function scheduleDailyReminder(
  { hour, minute }: { hour: number; minute: number },
  { dailyTask = false }: { dailyTask?: boolean } = {},
) {
  await cancelDailyReminder();
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER,
    content: dailyTask
      ? {
          title: 'Today’s posts',
          body: 'Tap to make today’s posts.',
          data: { kind: DAILY_REMINDER },
        }
      : {
          title: 'Time to post',
          body: 'Make a post from today’s photos.',
          data: { kind: DAILY_REMINDER },
        },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
  });
}

/** Calls `onTap` when the daily reminder was tapped (also when the tap launched the app). */
export function useDailyReminderTap(onTap: () => void) {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (response?.notification.request.content.data?.kind !== DAILY_REMINDER) return;
    void Notifications.clearLastNotificationResponseAsync();
    onTap();
  }, [response, onTap]);
}

export async function cancelDailyReminder() {
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER);
}

/** Shown by the background check when the laptop server can't be reached. */
export async function notifyServerDown() {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Post It Up server isn’t running',
      body: 'Start it on your laptop so your posts can be made.',
    },
    trigger: null,
  });
}

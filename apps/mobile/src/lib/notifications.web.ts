// Local notifications are iOS-only; the web preview pretends they're granted.

export function configureNotifications() {}

export async function requestNotificationPermission() {
  return true;
}

export async function scheduleDailyReminder(
  _time: { hour: number; minute: number },
  _options?: { dailyTask?: boolean },
) {}

export function useDailyReminderTap(_onTap: () => void) {}

export async function cancelDailyReminder() {}

export async function notifyServerDown() {}

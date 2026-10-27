import { scheduleDailyReminder } from '@/lib/notifications';
import { formatTime, getSettings, updateSettings, useSettings } from '@/state/settings';
import { Stepper } from '@/ui';

const STEP_MINUTES = 30;

/** Big time display with − / + buttons, in 30-minute steps. */
export function ReminderPicker() {
  const { reminder } = useSettings();

  function shift(delta: number) {
    const total = (reminder.hour * 60 + reminder.minute + delta + 24 * 60) % (24 * 60);
    const next = { hour: Math.floor(total / 60), minute: total % 60 };
    updateSettings({ reminder: next });
    void scheduleDailyReminder(next, { dailyTask: !!getSettings().dailyTask?.enabled });
  }

  return (
    <Stepper
      value={formatTime(reminder)}
      onDecrease={() => shift(-STEP_MINUTES)}
      onIncrease={() => shift(STEP_MINUTES)}
    />
  );
}

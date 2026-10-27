import { router } from 'expo-router';
import { useState } from 'react';

import { ReminderPicker } from '@/features/reminder-picker';
import { requestNotificationPermission, scheduleDailyReminder } from '@/lib/notifications';
import { getSettings } from '@/state/settings';
import { Button, Caption, Screen, StepHeader } from '@/ui';

export default function ReminderStep() {
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  async function next() {
    setBusy(true);
    const granted = await requestNotificationPermission();
    if (granted) await scheduleDailyReminder(getSettings().reminder);
    setBusy(false);
    if (!granted) setDenied(true);
    router.push('/onboarding/notify');
  }

  return (
    <Screen footer={<Button title="Allow notifications" onPress={next} loading={busy} />}>
      <StepHeader
        step={2}
        total={5}
        title="When should it arrive?"
        description="You’ll get one notification a day when your post is ready to review."
      />
      <ReminderPicker />
      {denied ? (
        <Caption muted>Notifications are off. You can turn them on in iOS Settings later.</Caption>
      ) : null}
    </Screen>
  );
}

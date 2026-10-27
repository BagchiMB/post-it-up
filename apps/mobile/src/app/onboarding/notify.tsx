import { router } from 'expo-router';

import { NtfySetup } from '@/features/ntfy-setup';
import { Button, Screen, StepHeader } from '@/ui';

export default function NotifyStep() {
  return (
    <Screen footer={<Button title="Continue" onPress={() => router.push('/onboarding/spotify')} />}>
      <StepHeader
        step={3}
        total={5}
        title="Get notified"
        description="Posts are made on your laptop, so it tells you when one is ready through ntfy, a free notification app."
      />
      <NtfySetup />
    </Screen>
  );
}

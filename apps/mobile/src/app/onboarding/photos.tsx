import { router } from 'expo-router';
import { useState } from 'react';

import { openAppSettings, type PhotoAccess, requestPhotoAccess } from '@/lib/photos';
import { Body, Button, Screen, Status, StepHeader } from '@/ui';

export default function PhotosStep() {
  const [access, setAccess] = useState<PhotoAccess>('undetermined');
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    const result = await requestPhotoAccess();
    setBusy(false);
    setAccess(result);
    if (result === 'full') router.push('/onboarding/reminder');
  }

  const blocked = access === 'limited' || access === 'denied';

  return (
    <Screen
      footer={
        blocked ? (
          <>
            <Button title="Open iOS Settings" onPress={openAppSettings} />
            <Button title="I’ve changed it" variant="ghost" onPress={allow} />
          </>
        ) : (
          <Button title="Allow photo access" onPress={allow} loading={busy} />
        )
      }>
      <StepHeader
        step={1}
        total={5}
        title="Your photos"
        description="Each night it looks at the photos you took that day. Only small previews are sent to your Post It Up server, which picks the best."
      />
      {access === 'limited' ? (
        <>
          <Status ok={false} text="Limited access" />
          <Body muted>
            With limited access the app can’t see new photos. In Settings, set Photos to “Full
            Access”.
          </Body>
        </>
      ) : access === 'denied' ? (
        <>
          <Status ok={false} text="Access denied" />
          <Body muted>Turn on photo access for Post It Up in iOS Settings to continue.</Body>
        </>
      ) : null}
    </Screen>
  );
}

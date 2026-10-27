import { AccountsList } from '@/features/accounts-list';
import { updateSettings, useSettings } from '@/state/settings';
import { Button, Screen, StepHeader } from '@/ui';

export default function AccountsStep() {
  const { accounts } = useSettings();
  return (
    <Screen
      footer={
        <Button
          title="Finish"
          disabled={accounts.length === 0}
          onPress={() => updateSettings({ onboarded: true })}
        />
      }>
      <StepHeader
        step={5}
        total={5}
        title="Your Instagram accounts"
        description="Add each account you post from. The preview uses its name and photo, and captions follow its style."
      />
      <AccountsList />
    </Screen>
  );
}

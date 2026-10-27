import { NtfySetup } from '@/features/ntfy-setup';
import { Body, Screen } from '@/ui';

export default function NotificationSettings() {
  return (
    <Screen topInset={false}>
      <Body muted>
        Your laptop tells you when a post is ready through ntfy, a free notification app.
      </Body>
      <NtfySetup />
    </Screen>
  );
}

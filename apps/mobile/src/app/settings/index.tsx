import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AccountsList } from '@/features/accounts-list';
import { ReminderPicker } from '@/features/reminder-picker';
import { SpotifyConnect } from '@/features/spotify-connect';
import { describePosts } from '@/features/task-config-editor';
import { signOut, useMe } from '@/state/session';
import { useSettings } from '@/state/settings';
import { Avatar, Caption, Group, Row, Screen, space } from '@/ui';

export default function Settings() {
  const me = useMe();
  const { dailyTask } = useSettings();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Screen topInset={false}>
      <Section title="Daily reminder">
        <ReminderPicker />
      </Section>

      <Group>
        <Row
          title="Daily task"
          detail={
            dailyTask?.enabled
              ? `On · ${describePosts(dailyTask.posts)} from each day’s photos`
              : 'Off'
          }
          onPress={() => router.push('/settings/daily-task')}
        />
      </Group>

      <Group title="Notifications">
        <Row
          title="Get notified"
          detail="Post-ready alerts via the ntfy app"
          onPress={() => router.push('/settings/notifications')}
        />
      </Group>

      <Section title="Spotify">
        <SpotifyConnect />
      </Section>

      <Section title="Instagram accounts">
        <AccountsList />
      </Section>

      <Group title="Account">
        <Row
          leading={<Avatar uri={me.picture} label={me.name ?? me.email} />}
          title={me.name ?? me.email}
          detail={me.name ? me.email : undefined}
        />
        <Row
          title={signingOut ? 'Signing out…' : 'Sign out'}
          destructive
          trailing={<View />}
          onPress={
            signingOut
              ? undefined
              : () => {
                  setSigningOut(true);
                  void signOut();
                }
          }
        />
      </Group>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm, marginBottom: space.md }}>
      <Caption muted style={{ paddingHorizontal: space.lg, letterSpacing: 0.6 }}>
        {title.toUpperCase()}
      </Caption>
      {children}
    </View>
  );
}

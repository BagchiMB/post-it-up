import type { InstagramProfile } from '@postitup/shared';
import { router } from 'expo-router';
import { View } from 'react-native';

import { useSettings } from '@/state/settings';
import { Avatar, Button, Caption, Group, Row, space } from '@/ui';

const TONE_LABEL: Record<InstagramProfile['tone'], string> = {
  casual: 'Casual',
  witty: 'Witty',
  poetic: 'Poetic',
  minimal: 'Minimal',
};

export function describeDays(days: number[]) {
  if (days.length === 7) return 'Every day';
  if (days.length === 0) return 'Paused';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return [...days]
    .sort()
    .map((d) => names[d])
    .join(', ');
}

export function AccountsList() {
  const { accounts } = useSettings();

  return (
    <View style={{ gap: space.md }}>
      {accounts.length > 0 ? (
        <Group>
          {accounts.map((a) => (
            <Row
              key={a.id}
              leading={<Avatar uri={a.avatarUri} label={a.handle} />}
              title={`@${a.handle}`}
              detail={`${TONE_LABEL[a.tone]} · ${describeDays(a.activeDays)}`}
              onPress={() => router.push({ pathname: '/account/[id]', params: { id: a.id } })}
            />
          ))}
        </Group>
      ) : (
        <Caption muted>No accounts yet.</Caption>
      )}
      <Button
        title="Add Instagram account"
        variant="secondary"
        onPress={() => router.push({ pathname: '/account/[id]', params: { id: 'new' } })}
      />
    </View>
  );
}

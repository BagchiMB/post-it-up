import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useMe } from '@/state/session';
import { Body, Button, Caption, radius, space, useColors } from '@/ui';

const NTFY_APP_STORE = 'https://apps.apple.com/app/ntfy/id1625396347';

const STEPS = [
  'Install the free ntfy app.',
  'Tap +, paste your topic and subscribe.',
  'Allow notifications when ntfy asks.',
];

/** How to get "your post is ready" alerts: the server posts to the user's private ntfy topic. */
export function NtfySetup() {
  const c = useColors();
  const { ntfyTopic } = useMe();
  const [copied, setCopied] = useState(false);

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.step}>
            <Caption muted style={styles.num}>
              {i + 1}
            </Caption>
            <Body style={{ flex: 1 }}>{s}</Body>
          </View>
        ))}
      </View>

      <View style={[styles.topic, { backgroundColor: c.surface }]}>
        <Caption muted>Your private topic</Caption>
        <Text selectable style={[styles.mono, { color: c.text }]}>
          {ntfyTopic}
        </Text>
      </View>

      <Button
        title={copied ? 'Topic copied' : 'Copy topic'}
        variant="secondary"
        onPress={async () => {
          await Clipboard.setStringAsync(ntfyTopic);
          setCopied(true);
        }}
      />
      <Button title="Get ntfy" variant="ghost" onPress={() => Linking.openURL(NTFY_APP_STORE)} />
      <Caption muted>
        Keep the topic to yourself — anyone who has it can see when your posts are ready.
      </Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  num: { width: 16, fontVariant: ['tabular-nums'] },
  topic: { borderRadius: radius.md, padding: space.lg, gap: space.xs },
  mono: {
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontWeight: '500',
  },
});

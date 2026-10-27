import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Body, Button, Caption, radius, Screen, space, Title, useColors } from '@/ui';

const STEPS = [
  'Picks your best photo of the day',
  'Writes a caption in your style',
  'Finds a song from your Spotify taste',
  'You approve, it opens Instagram',
];

export default function Welcome() {
  const c = useColors();
  return (
    <Screen
      footer={<Button title="Get started" onPress={() => router.push('/onboarding/photos')} />}>
      <View style={styles.hero}>
        <View style={[styles.mark, { backgroundColor: c.text }]} />
        <Title style={{ fontSize: 40, lineHeight: 46 }}>Post It Up</Title>
        <Body muted>One great post a day, without the effort.</Body>
      </View>
      <View style={{ gap: space.md }}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.step}>
            <Caption muted style={styles.num}>
              {i + 1}
            </Caption>
            <Body>{s}</Body>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md, marginTop: space.huge, marginBottom: space.xxl },
  mark: { width: 44, height: 44, borderRadius: radius.md, marginBottom: space.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  num: { width: 16, fontVariant: ['tabular-nums'] },
});

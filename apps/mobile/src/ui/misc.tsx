import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Caption, Title } from './text';
import { radius, space, useColors } from './theme';

export function Avatar({ uri, label, size = 40 }: { uri?: string; label: string; size?: number }) {
  const c = useColors();
  const box = { width: size, height: size, borderRadius: size / 2, backgroundColor: c.border };
  if (uri) return <Image source={{ uri }} style={box} contentFit="cover" />;
  return (
    <View style={[box, styles.center]}>
      <Text style={{ color: c.textMuted, fontSize: size * 0.4, fontWeight: '600' }}>
        {label.replace('@', '').slice(0, 1).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

/** Progress dots + title + description at the top of each onboarding step. */
export function StepHeader({
  step,
  total,
  title,
  description,
}: {
  step: number;
  total: number;
  title: string;
  description: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: space.lg, marginBottom: space.lg }}>
      <View style={styles.dots}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i < step ? c.text : c.border, width: i === step - 1 ? 20 : 6 },
            ]}
          />
        ))}
      </View>
      <Title>{title}</Title>
      <Body muted>{description}</Body>
    </View>
  );
}

/** Small status line, e.g. "Connected as Mihir". */
export function Status({ ok, text }: { ok: boolean; text: string }) {
  const c = useColors();
  return (
    <View style={styles.status}>
      <View style={[styles.statusDot, { backgroundColor: ok ? c.success : c.textMuted }]} />
      <Caption muted>{text}</Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 6, borderRadius: radius.pill },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
});

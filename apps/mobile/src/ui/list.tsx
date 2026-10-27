import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Caption } from './text';
import { radius, space, type, useColors } from './theme';

/** A rounded surface that stacks rows with hairline dividers. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  const c = useColors();
  const rows = Children.toArray(children);
  return (
    <View style={{ gap: space.sm }}>
      {title ? (
        <Caption muted style={styles.groupTitle}>
          {title.toUpperCase()}
        </Caption>
      ) : null}
      <View style={[styles.group, { backgroundColor: c.surface }]}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: c.border }]} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

type RowProps = {
  title: string;
  detail?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  destructive?: boolean;
};

export function Row({
  title,
  detail,
  leading,
  trailing,
  onPress,
  selected,
  destructive,
}: RowProps) {
  const c = useColors();
  const body = (
    <View style={styles.row}>
      {leading}
      <View style={styles.rowText}>
        <Text style={[type.label, { color: destructive ? c.danger : c.text }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Caption muted numberOfLines={2}>
            {detail}
          </Caption>
        ) : null}
      </View>
      {trailing ??
        (selected ? (
          <Text style={[type.label, { color: c.text }]}>✓</Text>
        ) : onPress ? (
          <Text style={[type.heading, { color: c.textMuted, fontWeight: '400' }]}>›</Text>
        ) : null)}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupTitle: { paddingHorizontal: space.lg, letterSpacing: 0.6 },
  group: { borderRadius: radius.md, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowText: { flex: 1, gap: 2 },
});

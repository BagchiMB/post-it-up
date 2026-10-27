import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { radius, space, type, useColors } from './theme';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled }: Props) {
  const c = useColors();
  const inactive = disabled || loading;
  const bg =
    variant === 'primary' ? c.primary : variant === 'secondary' ? c.surface : 'transparent';
  const fg = variant === 'primary' ? c.onPrimary : c.text;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: inactive ? 0.4 : pressed ? 0.75 : 1 },
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[type.label, { color: fg, fontWeight: '600' }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
});

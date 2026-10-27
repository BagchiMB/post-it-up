import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, useColors } from './theme';

/** A row of pill buttons; `round` makes them small circles (e.g. weekdays). */
export function Chips({
  options,
  isOn,
  onToggle,
  round,
  isDisabled,
}: {
  options: { key: string; label: string }[];
  isOn: (key: string) => boolean;
  onToggle: (key: string) => void;
  round?: boolean;
  isDisabled?: (key: string) => boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = isOn(o.key);
        const disabled = isDisabled?.(o.key) ?? false;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => onToggle(o.key)}
            style={[
              styles.chip,
              round && styles.roundChip,
              { backgroundColor: on ? c.primary : c.surface, opacity: disabled ? 0.4 : 1 },
            ]}>
            <Text style={{ color: on ? c.onPrimary : c.text, fontWeight: '500' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A value with − / + buttons on either side. */
export function Stepper({
  value,
  onDecrease,
  onIncrease,
  size = 'large',
  canDecrease = true,
  canIncrease = true,
}: {
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  size?: 'large' | 'small';
  canDecrease?: boolean;
  canIncrease?: boolean;
}) {
  const c = useColors();
  const large = size === 'large';
  return (
    <View
      style={[
        styles.stepper,
        { backgroundColor: c.surface, padding: large ? space.lg : space.sm },
      ]}>
      <StepButton label="−" onPress={onDecrease} disabled={!canDecrease} />
      <Text
        style={{
          color: c.text,
          fontSize: large ? 36 : 17,
          fontWeight: large ? '600' : '500',
          letterSpacing: large ? -1 : 0,
          fontVariant: ['tabular-nums'],
        }}>
        {value}
      </Text>
      <StepButton label="+" onPress={onIncrease} disabled={!canIncrease} />
    </View>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase' : 'Decrease'}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: c.background, opacity: disabled ? 0.3 : pressed ? 0.6 : 1 },
      ]}>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: space.lg,
    height: 40,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  roundChip: { width: 40, paddingHorizontal: 0, alignItems: 'center' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
  },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

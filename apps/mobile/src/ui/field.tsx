import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { Caption } from './text';
import { radius, space, type, useColors } from './theme';

type Props = TextInputProps & { label?: string; hint?: string; error?: string };

export function Field({ label, hint, error, style, ...rest }: Props) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Caption muted>{label}</Caption> : null}
      <TextInput
        placeholderTextColor={c.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        style={[
          styles.input,
          type.body,
          {
            backgroundColor: c.surface,
            color: c.text,
            borderColor: error ? c.danger : 'transparent',
          },
          style,
        ]}
      />
      {error ? (
        <Caption style={{ color: c.danger }}>{error}</Caption>
      ) : hint ? (
        <Caption muted>{hint}</Caption>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
});

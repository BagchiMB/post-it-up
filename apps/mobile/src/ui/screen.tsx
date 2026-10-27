import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { maxContentWidth, space, useColors } from './theme';

type Props = {
  children: ReactNode;
  /** Pinned to the bottom, outside the scroll area (primary actions). */
  footer?: ReactNode;
  /** Set false when a native header already handles the top inset. */
  topInset?: boolean;
};

export function Screen({ children, footer, topInset = true }: Props) {
  const c = useColors();
  return (
    <SafeAreaView
      edges={topInset ? ['top', 'bottom'] : ['bottom']}
      style={[styles.fill, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic">
          <View style={styles.column}>{children}</View>
        </ScrollView>
        {footer ? <View style={[styles.column, styles.footer]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, padding: space.xl },
  column: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', gap: space.lg },
  footer: {
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
});

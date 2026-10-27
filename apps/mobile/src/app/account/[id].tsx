import type { CaptionTone, InstagramProfile } from '@postitup/shared';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { getSettings, newProfile, removeProfile, saveProfile } from '@/state/settings';
import { Avatar, Button, Caption, Chips, Field, Group, Label, Row, Screen, space } from '@/ui';

const TONES: CaptionTone[] = ['casual', 'witty', 'poetic', 'minimal'];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function AccountEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = getSettings().accounts.find((a) => a.id === id);
  const [p, setP] = useState<InstagramProfile>(existing ?? newProfile());
  const set = (patch: Partial<InstagramProfile>) => setP((prev) => ({ ...prev, ...patch }));

  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset?.base64)
      set({ avatarUri: `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}` });
  }

  function save() {
    saveProfile({ ...p, handle: p.handle.trim().replace(/^@/, '') });
    router.back();
  }

  return (
    <Screen
      topInset={false}
      footer={<Button title="Save" onPress={save} disabled={!p.handle.trim().replace(/^@/, '')} />}>
      <Stack.Screen options={{ title: existing ? `@${existing.handle}` : 'New account' }} />

      <View style={styles.avatarRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose profile photo"
          onPress={pickAvatar}>
          <Avatar uri={p.avatarUri} label={p.handle} size={72} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Field
            placeholder="@username"
            value={p.handle}
            onChangeText={(handle) => set({ handle })}
            autoFocus={!existing}
          />
        </View>
      </View>
      <Caption muted>
        Tap the circle to pick a profile photo — it’s only used in the preview.
      </Caption>

      <Label style={styles.section}>Caption tone</Label>
      <Chips
        options={TONES.map((t) => ({ key: t, label: t[0].toUpperCase() + t.slice(1) }))}
        isOn={(k) => p.tone === k}
        onToggle={(k) => set({ tone: k as CaptionTone })}
      />

      <Group>
        <Row
          title="Use emojis"
          trailing={<Switch value={p.emojis} onValueChange={(emojis) => set({ emojis })} />}
        />
      </Group>

      <Field
        label="Hashtags to always add"
        placeholder="#travel #weekend"
        value={p.hashtags}
        onChangeText={(hashtags) => set({ hashtags })}
      />

      <Label style={styles.section}>Suggest posts on</Label>
      <Chips
        options={DAYS.map((d, i) => ({ key: String(i), label: d }))}
        isOn={(k) => p.activeDays.includes(Number(k))}
        onToggle={(k) => {
          const d = Number(k);
          set({
            activeDays: p.activeDays.includes(d)
              ? p.activeDays.filter((x) => x !== d)
              : [...p.activeDays, d],
          });
        }}
        round
      />

      {existing ? (
        <Group>
          <Row
            title="Remove account"
            destructive
            trailing={<View />}
            onPress={() => {
              removeProfile(existing.id);
              router.back();
            }}
          />
        </Group>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  section: { marginTop: space.sm },
});

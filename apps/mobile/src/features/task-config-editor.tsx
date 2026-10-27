import {
  type InstagramProfile,
  MAX_CAROUSEL_PHOTOS,
  MAX_POSTS,
  type PostSpec,
  type TaskConfig,
} from '@postitup/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Chips, Label, radius, space, Stepper, type, useColors } from '@/ui';

import { musicChoice, type MusicDraft, musicDraftFrom, MusicPicker } from './music-picker';

const DEFAULT_CAROUSEL = 6;

/** Everything the editor holds; `taskConfig()` turns it into what the server takes. */
export type TaskDraft = { accountId: string; posts: PostSpec[]; music: MusicDraft };

export const DEFAULT_POSTS: PostSpec[] = [
  { kind: 'people', format: 'single', maxPhotos: 1 },
  { kind: 'scenery', format: 'single', maxPhotos: 1 },
];

const KINDS: { key: PostSpec['kind']; label: string }[] = [
  { key: 'people', label: 'People' },
  { key: 'scenery', label: 'Scenery' },
  { key: 'mix', label: 'Mix' },
];

export function taskDraftFrom(
  saved: Partial<TaskConfig> | undefined,
  accounts: InstagramProfile[],
  spotifyConnected: boolean,
): TaskDraft {
  const accountId = accounts.some((a) => a.id === saved?.accountId)
    ? saved!.accountId!
    : (accounts[0]?.id ?? '');
  return {
    accountId,
    posts: saved?.posts?.length ? saved.posts : DEFAULT_POSTS,
    music: musicDraftFrom(saved?.music, spotifyConnected),
  };
}

/** The config to send, or undefined while something is missing (account, music details). */
export function taskConfig(d: TaskDraft): TaskConfig | undefined {
  const music = musicChoice(d.music);
  if (!music || !d.accountId || d.posts.length === 0) return undefined;
  return { accountId: d.accountId, posts: d.posts, music };
}

/** Account, posts and music: shared by the Create screen and the daily task settings. */
export function TaskConfigEditor({
  value,
  onChange,
  accounts,
  spotifyConnected,
}: {
  value: TaskDraft;
  onChange: (next: TaskDraft) => void;
  accounts: InstagramProfile[];
  spotifyConnected: boolean;
}) {
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });

  return (
    <>
      {accounts.length > 1 ? (
        <Section title="For">
          <Chips
            options={accounts.map((a) => ({ key: a.id, label: `@${a.handle}` }))}
            isOn={(k) => k === value.accountId}
            onToggle={(accountId) => set({ accountId })}
          />
        </Section>
      ) : null}

      <Section title="Posts">
        <PostsEditor posts={value.posts} onChange={(posts) => set({ posts })} />
      </Section>

      <Section title="Music">
        <MusicPicker
          value={value.music}
          onChange={(music) => set({ music })}
          spotifyConnected={spotifyConnected}
        />
      </Section>
    </>
  );
}

function PostsEditor({
  posts,
  onChange,
}: {
  posts: PostSpec[];
  onChange: (next: PostSpec[]) => void;
}) {
  const update = (i: number, spec: PostSpec) => onChange(posts.map((p, j) => (j === i ? spec : p)));

  return (
    <View style={{ gap: space.md }}>
      {posts.map((p, i) => (
        <PostRow
          key={i}
          index={i}
          spec={p}
          onChange={(spec) => update(i, spec)}
          onRemove={posts.length > 1 ? () => onChange(posts.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      {posts.length < MAX_POSTS ? (
        <Button
          title="Add post"
          variant="secondary"
          onPress={() => onChange([...posts, { kind: 'people', format: 'single', maxPhotos: 1 }])}
        />
      ) : null}
    </View>
  );
}

function PostRow({
  index,
  spec,
  onChange,
  onRemove,
}: {
  index: number;
  spec: PostSpec;
  onChange: (spec: PostSpec) => void;
  onRemove?: () => void;
}) {
  const c = useColors();
  const carousel = (maxPhotos: number): PostSpec => ({ ...spec, format: 'carousel', maxPhotos });

  return (
    <View style={[styles.card, { backgroundColor: c.surface }]}>
      <View style={styles.cardHeader}>
        <Text style={[type.label, { color: c.text, fontWeight: '600' }]}>Post {index + 1}</Text>
        {onRemove ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onRemove}>
            <Text style={[type.caption, { color: c.textMuted }]}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      <Chips
        options={KINDS}
        isOn={(k) => k === spec.kind}
        onToggle={(k) => {
          const kind = k as PostSpec['kind'];
          // A mix of people and scenery only makes sense as a carousel.
          if (kind === 'mix' && spec.format === 'single')
            onChange({ kind, format: 'carousel', maxPhotos: DEFAULT_CAROUSEL });
          else onChange({ ...spec, kind });
        }}
      />
      <Chips
        options={[
          { key: 'single', label: 'Single' },
          { key: 'carousel', label: 'Carousel' },
        ]}
        isOn={(k) => k === spec.format}
        isDisabled={(k) => k === 'single' && spec.kind === 'mix'}
        onToggle={(k) =>
          onChange(
            k === 'single'
              ? { ...spec, format: 'single', maxPhotos: 1 }
              : carousel(Math.max(2, spec.maxPhotos === 1 ? DEFAULT_CAROUSEL : spec.maxPhotos)),
          )
        }
      />
      {spec.format === 'carousel' ? (
        <Stepper
          size="small"
          value={`Up to ${spec.maxPhotos} photos`}
          onDecrease={() => onChange(carousel(spec.maxPhotos - 1))}
          onIncrease={() => onChange(carousel(spec.maxPhotos + 1))}
          canDecrease={spec.maxPhotos > 2}
          canIncrease={spec.maxPhotos < MAX_CAROUSEL_PHOTOS}
        />
      ) : null}
    </View>
  );
}

export function describePosts(posts: PostSpec[]) {
  return `${posts.length} post${posts.length === 1 ? '' : 's'}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <Label>{title}</Label>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

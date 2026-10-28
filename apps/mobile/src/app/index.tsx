import type { Job } from '@postitup/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDisplayUris } from '@/curation/use-display-uris';
import { formatRange, isActive, useJobs } from '@/state/jobs';
import { useServerStatus } from '@/state/server';
import { formatTime, useSettings } from '@/state/settings';
import {
  Body,
  Button,
  Caption,
  Group,
  Heading,
  radius,
  Row,
  Screen,
  space,
  Title,
  useColors,
} from '@/ui';

export default function Today() {
  const c = useColors();
  const settings = useSettings();
  const jobs = useJobs();
  const server = useServerStatus();
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Screen footer={<Button title="Create a post" onPress={() => router.push('/create')} />}>
      <View style={styles.header}>
        <View style={{ gap: 2 }}>
          <Caption muted>{date}</Caption>
          <Title>Today</Title>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 },
          ]}>
          <Text style={{ color: c.text, fontSize: 18 }}>⚙︎</Text>
        </Pressable>
      </View>

      {server === 'down' ? <ServerBanner /> : null}

      {jobs.length === 0 ? (
        <View style={[styles.placeholder, { backgroundColor: c.surface }]}>
          <Heading>Nothing yet</Heading>
          <Body muted style={{ textAlign: 'center' }}>
            Make a post from today or any range of days. Your daily suggestion arrives at{' '}
            {formatTime(settings.reminder)}.
          </Body>
        </View>
      ) : (
        <Group title="Your posts">
          {jobs.map((j) => (
            <Row
              key={j.id}
              leading={<Thumb job={j} />}
              title={formatRange(j.request)}
              detail={describe(j)}
              onPress={() => router.push({ pathname: '/draft/[id]', params: { id: j.id } })}
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}

function ServerBanner() {
  const c = useColors();
  return (
    <View style={[styles.banner, { backgroundColor: c.surface }]}>
      <View style={[styles.bannerDot, { backgroundColor: c.danger }]} />
      <Caption style={{ flex: 1 }}>Server isn’t running — start it on your laptop.</Caption>
    </View>
  );
}

function describe(j: Job) {
  if (j.status === 'queued') return `${j.progress ?? 'Waiting to start'}…`;
  if (j.status === 'running') return `${j.progress ?? 'Working'}…`;
  if (j.status === 'failed' || !j.result) return j.error ?? 'Failed';
  const { posts } = j.result;
  const posted = posts.filter((p) => p.postedAt).length;
  const progress =
    posted === posts.length
      ? `✓ ${posted} of ${posts.length} posted`
      : `${posted} of ${posts.length} posted`;
  const songs = posts.map((p) => p.song.title).join(', ');
  return `${j.request.auto ? 'Daily · ' : ''}${progress} · ♪ ${songs}`;
}

function Thumb({ job }: { job: Job }) {
  const c = useColors();
  const [uri] = useDisplayUris(job.result?.posts[0]?.assetIds.slice(0, 1));
  const box = [styles.thumb, { backgroundColor: c.border }];
  if (isActive(job)) {
    return (
      <View style={[box, styles.center]}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (!uri) return <View style={box} />;
  return <Image source={{ uri }} style={box} contentFit="cover" />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4 },
  placeholder: {
    aspectRatio: 4 / 5,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xxl,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  center: { alignItems: 'center', justifyContent: 'center' },
});

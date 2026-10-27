import type { Job } from '@postitup/shared';
import { router, Stack, useCanGoBack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PostCard } from '@/features/post-card';
import { errorMessage } from '@/lib/api';
import { deleteJob, formatRange, refreshJob, retryJob, useJob } from '@/state/jobs';
import { useSettings } from '@/state/settings';
import { Body, Button, Caption, Heading, Screen, space, type, useColors } from '@/ui';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useJob(id);
  const [lookup, setLookup] = useState<'loading' | 'missing' | 'done'>('loading');
  // Opened straight from a notification there's nothing to go back to.
  const canGoBack = useCanGoBack();

  // Opened from a notification the post may not be in the list yet; fetch it directly.
  useEffect(() => {
    refreshJob(id)
      .then((j) => setLookup(j ? 'done' : 'missing'))
      .catch(() => setLookup('done'));
  }, [id]);

  return (
    <>
      <Stack.Screen
        options={{
          title: job ? formatRange(job.request) : 'Posts',
          headerLeft: canGoBack ? undefined : () => <HomeButton />,
        }}
      />
      {!job ? (
        <Screen topInset={false}>
          {lookup === 'loading' ? (
            <ActivityIndicator style={{ marginTop: space.huge }} />
          ) : (
            <Body muted>
              {lookup === 'missing' ? 'These posts no longer exist.' : 'Couldn’t load these posts.'}
            </Body>
          )}
        </Screen>
      ) : job.status === 'queued' || job.status === 'running' ? (
        <Running job={job} />
      ) : job.status === 'failed' || !job.result ? (
        <Failed job={job} onDeleted={() => router.dismissTo('/')} />
      ) : (
        <Ready job={job} result={job.result} />
      )}
    </>
  );
}

function HomeButton() {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.replace('/')} hitSlop={12}>
      <Text style={[type.label, { color: c.text }]}>Today</Text>
    </Pressable>
  );
}

function Running({ job }: { job: Job }) {
  return (
    <Screen topInset={false}>
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Heading>
          {job.progress ?? (job.status === 'queued' ? 'Waiting to start' : 'Working')}…
        </Heading>
        <Caption muted style={{ textAlign: 'center' }}>
          Your laptop is making these posts. You can lock your phone — ntfy will tell you when
          they’re ready.
        </Caption>
      </View>
    </Screen>
  );
}

function Failed({ job, onDeleted }: { job: Job; onDeleted: () => void }) {
  const [busy, setBusy] = useState<'retry' | 'delete'>();
  const [error, setError] = useState<string>();

  async function run(kind: 'retry' | 'delete') {
    setBusy(kind);
    setError(undefined);
    try {
      if (kind === 'retry') {
        await retryJob(job.id);
      } else {
        await deleteJob(job.id);
        onDeleted();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Screen
      topInset={false}
      footer={
        <>
          {error ? (
            <Caption muted style={{ textAlign: 'center' }}>
              {error}
            </Caption>
          ) : null}
          <Button
            title="Try again"
            onPress={() => run('retry')}
            loading={busy === 'retry'}
            disabled={!!busy}
          />
          <Button
            title="Delete"
            variant="ghost"
            onPress={() => run('delete')}
            loading={busy === 'delete'}
            disabled={!!busy}
          />
        </>
      }>
      <View style={styles.centered}>
        <Heading>Couldn’t make these posts</Heading>
        <Body muted style={{ textAlign: 'center' }}>
          {job.error}
        </Body>
      </View>
    </Screen>
  );
}

function Ready({ job, result }: { job: Job; result: NonNullable<Job['result']> }) {
  const c = useColors();
  const { accounts } = useSettings();
  const account = accounts.find((a) => a.id === job.request.accountId);

  return (
    <Screen topInset={false}>
      {result.posts.map((post, i) => (
        <View key={i} style={i > 0 ? [styles.divider, { borderTopColor: c.border }] : undefined}>
          <PostCard jobId={job.id} index={i} post={post} account={account} />
        </View>
      ))}
      {result.skipped?.map((s) => {
        const spec = job.request.posts?.[s.index];
        return (
          <Caption key={s.index} muted>
            Skipped post {s.index + 1}
            {spec ? ` (${spec.kind})` : ''}: {s.reason}
          </Caption>
        );
      })}
      <Caption muted style={{ textAlign: 'center' }}>
        Chosen by {result.modelName}
      </Caption>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingTop: space.huge,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.xl, marginTop: space.md },
});

import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { uploadJob, type UploadStep } from '@/curation/upload';
import { taskConfig, TaskConfigEditor, taskDraftFrom } from '@/features/task-config-editor';
import { errorMessage, ServerUnreachableError } from '@/lib/api';
import { addDays, formatRange, fromDay, toDay } from '@/state/jobs';
import { checkServer, reportServerDown, useServerStatus } from '@/state/server';
import { useMe } from '@/state/session';
import { getSettings, updateSettings, useSettings } from '@/state/settings';
import { Button, Caption, Chips, Label, Screen, space, Stepper, useColors } from '@/ui';

const PRESETS = [
  { key: 'today', label: 'Today', days: 1, endOffset: 0 },
  { key: 'yesterday', label: 'Yesterday', days: 1, endOffset: -1 },
  { key: 'week', label: 'Last 7 days', days: 7, endOffset: 0 },
  { key: 'month', label: 'Last 30 days', days: 30, endOffset: 0 },
];

const SERVER_DOWN = 'Server isn’t running — start it on your laptop.';
const STEP_LABEL: Record<UploadStep, string> = {
  preparing: 'Preparing photos…',
  uploading: 'Uploading…',
};

export default function CreatePost() {
  const c = useColors();
  const { accounts } = useSettings();
  const { spotify } = useMe();
  const [task, setTask] = useState(() => {
    const s = getSettings();
    return taskDraftFrom({ posts: s.lastPosts, music: s.lastMusic }, s.accounts, !!spotify);
  });
  const config = taskConfig(task);
  const server = useServerStatus();
  const [step, setStep] = useState<UploadStep>();
  const [error, setError] = useState<string>();
  const today = toDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const preset = PRESETS.find(
    (p) => to === addDays(today, p.endOffset) && from === addDays(to, -(p.days - 1)),
  )?.key;

  const blocker = server === 'down' ? SERVER_DOWN : undefined;

  async function start() {
    if (!config) return;
    setError(undefined);
    setStep('preparing');
    try {
      // Don't spend time on thumbnails if they can't be uploaded.
      if (!(await checkServer())) throw new ServerUnreachableError();
      const id = await uploadJob({ ...config, from, to }, setStep);
      updateSettings({ lastMusic: config.music, lastPosts: config.posts });
      router.replace({ pathname: '/draft/[id]', params: { id } });
    } catch (e) {
      if (e instanceof ServerUnreachableError) reportServerDown();
      setError(e instanceof ServerUnreachableError ? SERVER_DOWN : errorMessage(e));
      setStep(undefined);
    }
  }

  const footer = (
    <>
      {step ? (
        <Caption muted style={{ textAlign: 'center' }}>
          {STEP_LABEL[step]}
        </Caption>
      ) : null}
      {!step && (error || blocker) ? (
        <Caption style={{ textAlign: 'center', color: error ? c.danger : c.textMuted }}>
          {error ?? blocker}
        </Caption>
      ) : null}
      <Button title="Start" onPress={start} loading={!!step} disabled={!!blocker || !config} />
    </>
  );

  return (
    <Screen topInset={false} footer={footer}>
      <Section title="Photos from">
        <Chips
          options={PRESETS}
          isOn={(k) => k === preset}
          onToggle={(k) => {
            const p = PRESETS.find((x) => x.key === k)!;
            const end = addDays(today, p.endOffset);
            setTo(end);
            setFrom(addDays(end, -(p.days - 1)));
          }}
        />
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <Caption muted>From</Caption>
          <Stepper
            size="small"
            value={formatDay(from)}
            onDecrease={() => setFrom(addDays(from, -1))}
            onIncrease={() => setFrom(addDays(from, 1))}
            canIncrease={from < to}
          />
          <Caption muted>To</Caption>
          <Stepper
            size="small"
            value={formatDay(to)}
            onDecrease={() => setTo(addDays(to, -1))}
            onIncrease={() => setTo(addDays(to, 1))}
            canDecrease={to > from}
            canIncrease={to < today}
          />
        </View>
      </Section>

      <TaskConfigEditor
        value={task}
        onChange={setTask}
        accounts={accounts}
        spotifyConnected={!!spotify}
      />

      <Caption muted>
        {formatRange({ from, to })} · Keep the app open while the photos upload. After that your
        laptop does the work, and ntfy tells you when the posts are ready.
      </Caption>
    </Screen>
  );
}

function formatDay(day: string) {
  return fromDay(day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <Label>{title}</Label>
      {children}
    </View>
  );
}

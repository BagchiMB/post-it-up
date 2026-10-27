import { useState } from 'react';
import { Switch } from 'react-native';

import {
  taskConfig,
  TaskConfigEditor,
  type TaskDraft,
  taskDraftFrom,
} from '@/features/task-config-editor';
import { scheduleDailyReminder } from '@/lib/notifications';
import { useMe } from '@/state/session';
import { formatTime, getSettings, updateSettings, useSettings } from '@/state/settings';
import { Body, Caption, Group, Row, Screen } from '@/ui';

export default function DailyTaskSettings() {
  const { accounts, reminder, dailyTask } = useSettings();
  const { spotify } = useMe();
  const [task, setTask] = useState(() =>
    taskDraftFrom(getSettings().dailyTask, accounts, !!spotify),
  );
  const enabled = !!dailyTask?.enabled;
  const config = taskConfig(task);

  // Saved whenever the setup is complete; an incomplete one (e.g. no artists yet) waits.
  function save(next: TaskDraft, on: boolean) {
    const c = taskConfig(next);
    if (!c) return;
    updateSettings({ dailyTask: { ...c, enabled: on } });
    if (on !== enabled)
      void scheduleDailyReminder(getSettings().reminder, { dailyTask: on }).catch(() => {});
  }

  return (
    <Screen topInset={false}>
      <Body muted>
        Each day around {formatTime(reminder)} the app makes posts from that day’s photos. You’ll
        get a notification when they’re ready.
      </Body>
      <Group>
        <Row
          title="Make posts every day"
          trailing={
            <Switch value={enabled} disabled={!config} onValueChange={(on) => save(task, on)} />
          }
        />
      </Group>
      {!config ? <Caption muted>Finish the music choice below to turn this on.</Caption> : null}

      <TaskConfigEditor
        value={task}
        onChange={(next) => {
          setTask(next);
          save(next, enabled);
        }}
        accounts={accounts}
        spotifyConnected={!!spotify}
      />
      <Caption muted>
        iOS decides exactly when background work runs. If it hasn’t by then, tapping the reminder or
        opening the app starts it.
      </Caption>
    </Screen>
  );
}

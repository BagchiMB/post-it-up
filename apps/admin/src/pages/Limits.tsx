import type { AdminSettings, AdminSettingsPatch } from '@postitup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api, errorMessage } from '../api/client';
import { qk, useSettings } from '../api/queries';
import { ErrorBox, Msg, PageHead, SkeletonLines } from '../components/ui';
import { useMsg } from '../lib/hooks';

type FieldDef = {
  key: keyof AdminSettingsPatch & keyof AdminSettings;
  label: string;
  min: number;
  max: number;
  step?: number;
};

const FIELDS: FieldDef[] = [
  { key: 'dailyJobLimit', label: 'Tasks per user per day', min: 1, max: 500 },
  { key: 'dailyMusicChangeLimit', label: 'Music changes per user per day', min: 0, max: 500 },
  { key: 'logRetentionDays', label: 'Keep integration logs (days)', min: 1, max: 365 },
  { key: 'spotifyUserCap', label: 'Spotify connections (users)', min: 0, max: 25 },
  { key: 'lowFitThreshold', label: 'Low song-fit threshold (0–100)', min: 0, max: 100 },
  { key: 'lowBalanceUsd', label: 'Low-balance warning (USD)', min: 0, max: 1000, step: 0.01 },
];

function LimitsForm({ settings }: { settings: AdminSettings }) {
  const qc = useQueryClient();
  // lowBalanceUsd is only offered once the server sends it.
  const fields = FIELDS.filter((f) => settings[f.key] !== undefined);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(settings[f.key] as number)])),
  );
  const [msg, say] = useMsg();
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    say('Saving…');
    setBusy(true);
    try {
      const patch = Object.fromEntries(fields.map((f) => [f.key, Number(values[f.key])]));
      const next = await api.put<AdminSettings>('/settings', patch);
      qc.setQueryData(qk.settings, next);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.session }),
        qc.invalidateQueries({ queryKey: qk.integrations }),
        qc.invalidateQueries({ queryKey: qk.overview }),
      ]);
      say('Saved.', 'good');
    } catch (err) {
      say(errorMessage(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <div className="row">
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`f-${f.key}`}>{f.label}</label>
            <input
              id={`f-${f.key}`}
              type="number"
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              required
              value={values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          </div>
        ))}
        <button type="submit" disabled={busy}>
          Save
        </button>
      </div>
      <Msg msg={msg} />
    </form>
  );
}

export function LimitsPage() {
  const settings = useSettings();
  return (
    <>
      <PageHead
        title="Limits & quality"
        description="Per-user daily limits, song quality, log retention and the Spotify connection cap."
      />
      {settings.error ? <ErrorBox error={settings.error} /> : null}
      <section>
        {settings.data ? <LimitsForm settings={settings.data} /> : <SkeletonLines lines={3} />}
        <p className="muted">
          Days are UTC. Tasks count POST /jobs and retries; 0 music changes turns &quot;Change the
          music&quot; off. Spotify dev-mode apps allow only a few users; connected users keep their
          connection if you lower the cap. When a song from the user&apos;s history, playlists or
          artists fits the photos below the low-fit threshold, the post also offers a better-fitting
          song from any artist. The low-balance warning shows a banner on every admin page when the
          OpenRouter account balance drops below it.
        </p>
      </section>
    </>
  );
}

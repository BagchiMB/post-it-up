import type { AdminStatus, CheckResult } from '@postitup/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { api, errorMessage } from '../api/client';
import { qk } from '../api/queries';
import { type Column, DataTable } from '../components/DataTable';
import { ErrorBox, PageHead, SkeletonCards, SkeletonLines, StatCard } from '../components/ui';
import { mb, uptime, when } from '../lib/format';

type Row = { id: string; label: string };
type Live = Record<
  string,
  { running: true } | { running: false; result?: CheckResult; error?: string }
>;

export function StatusPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.status, queryFn: () => api.get<AdminStatus>('/status') });
  const [live, setLive] = useState<Live>({});
  const [lastAt, setLastAt] = useState<number | null>(null);
  const d = q.data;

  const results = useMemo(() => {
    const m = new Map<string, CheckResult>((d?.lastRun?.results ?? []).map((r) => [r.id, r]));
    return m;
  }, [d]);

  const run = async (ids: string[]) => {
    setLive((l) => ({ ...l, ...Object.fromEntries(ids.map((id) => [id, { running: true }])) }));
    try {
      const all = ids.length === d?.checks.length;
      const r = await api.post<CheckResult[]>('/checks/run', all ? {} : { checks: ids });
      setLive((l) => ({
        ...l,
        ...Object.fromEntries(r.map((x) => [x.id, { running: false, result: x }])),
      }));
      setLastAt(Date.now());
      void qc.invalidateQueries({ queryKey: qk.overview });
    } catch (e) {
      const error = errorMessage(e);
      setLive((l) => ({
        ...l,
        ...Object.fromEntries(ids.map((id) => [id, { running: false, error }])),
      }));
    }
  };

  const cols: Column<Row>[] = [
    { id: 'check', header: 'Check', cell: (c) => c.label },
    {
      id: 'result',
      header: 'Result',
      wrap: true,
      cell: (c) => {
        const l = live[c.id];
        if (l?.running) return <span className="muted">Running…</span>;
        if (l?.error) return <span className="msg bad">{l.error}</span>;
        const r = l?.result ?? results.get(c.id);
        if (!r) return <span className="muted">Not run</span>;
        return (
          <>
            <span className={`dot ${r.ok ? 'ok' : 'bad'}`} />
            {r.ok ? (r.detail ?? 'OK') : (r.error ?? 'Failed')}
          </>
        );
      },
    },
    {
      id: 'ms',
      header: 'ms',
      num: true,
      cell: (c) => {
        const l = live[c.id];
        const r = (l && !l.running ? l.result : undefined) ?? results.get(c.id);
        return r && !l?.running ? r.durationMs : '';
      },
    },
    {
      id: 'run',
      header: '',
      cell: (c) => (
        <div className="actions">
          <button
            className="ghost small"
            type="button"
            disabled={!!live[c.id]?.running}
            onClick={() => void run([c.id])}>
            Run
          </button>
        </div>
      ),
    },
  ];

  const last = lastAt ?? d?.lastRun?.at ?? null;
  const anyRunning = Object.values(live).some((l) => l.running);
  return (
    <>
      <PageHead title="Status" description="Run live checks against each integration." />
      {q.error ? <ErrorBox error={q.error} /> : null}
      <section>
        <h2>Server</h2>
        {d ? (
          <p>
            Version <strong>{d.server.version}</strong> · up {uptime(d.server.uptimeSec)} · Node{' '}
            {d.server.node}
          </p>
        ) : (
          <SkeletonLines lines={1} />
        )}
      </section>
      <section>
        <h2>Database</h2>
        {d ? (
          <>
            <div className="cards" style={{ margin: 0 }}>
              <StatCard
                label="Schema version"
                value={`v${d.database.schemaVersion}`}
                sub={
                  d.database.schemaVersion === d.database.expectedVersion
                    ? 'Up to date'
                    : `Code expects v${d.database.expectedVersion}`
                }
              />
              <StatCard label="Database size" value={mb(d.database.fileSize)} sub="app.db + WAL" />
              <StatCard
                label="Backups"
                value={String(d.database.backups)}
                sub={d.database.lastBackupAt ? `Last ${when(d.database.lastBackupAt)}` : 'None yet'}
              />
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              Backups go to <span className="mono">{d.database.backupsDir}</span> before every
              migration (newest 10 kept). Make one now with{' '}
              <span className="mono">npm run db:backup -w apps/server</span>. Browse the data in{' '}
              <Link to="/db">Database</Link>.
            </p>
          </>
        ) : (
          <SkeletonCards count={3} />
        )}
      </section>
      <section>
        <h2>Checks</h2>
        <div
          className="row"
          style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="muted">{last ? `Last run ${when(last)}` : 'Not run yet.'}</span>
          <button
            type="button"
            disabled={!d || anyRunning}
            onClick={() => d && void run(d.checks.map((c) => c.id))}>
            Run all checks
          </button>
        </div>
        {d ? (
          <DataTable columns={cols} data={d.checks} getRowId={(c) => c.id} label="Checks" />
        ) : (
          <SkeletonLines />
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Checks are logged as <span className="mono">check:*</span> operations in{' '}
          <Link to="/logs?operation=check%3A">Logs</Link>. The ntfy check publishes to a throwaway
          topic.
        </p>
      </section>
    </>
  );
}

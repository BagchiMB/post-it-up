import type { LogPage, LogRow } from '@postitup/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { api } from '../api/client';
import { qk } from '../api/queries';
import { type Column, DataTable } from '../components/DataTable';
import { ErrorBox, PageHead, Pill, SkeletonLines } from '../components/ui';
import { usd, when } from '../lib/format';

const INTEGRATIONS = ['openrouter', 'spotify', 'lrclib', 'ntfy', 'google'];
const dateVal = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

/** Filter form; its state starts from the URL and is written back to it on submit. */
function Filters({ params }: { params: URLSearchParams }) {
  const [, setParams] = useSearchParams();
  const [ints, setInts] = useState(
    () => new Set(params.getAll('integration').flatMap((v) => v.split(','))),
  );
  const [user, setUser] = useState(params.get('user') ?? '');
  const [operation, setOperation] = useState(params.get('operation') ?? '');
  const [job, setJob] = useState(params.get('job') ?? '');
  const [ok, setOk] = useState(params.get('ok') ?? '');
  const [from, setFrom] = useState(dateVal(params.get('from')));
  const [to, setTo] = useState(dateVal(params.get('to')));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const i of INTEGRATIONS) if (ints.has(i)) next.append('integration', i);
    const set = (k: string, v: string) => v.trim() && next.set(k, v.trim());
    set('user', user);
    set('operation', operation);
    set('job', job);
    set('ok', ok);
    // Keep a precise timestamp from a link (e.g. Overview's "last 24 h") unless the date changed.
    set('from', from && from === dateVal(params.get('from')) ? (params.get('from') ?? from) : from);
    set('to', to && to === dateVal(params.get('to')) ? (params.get('to') ?? to) : to);
    setParams(next);
  };

  return (
    <section>
      <form onSubmit={submit}>
        <div className="row">
          <div className="field">
            <span
              className="label-text"
              style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}
              id="int-label">
              Integration
            </span>
            <div className="chips" role="group" aria-labelledby="int-label">
              {INTEGRATIONS.map((i) => (
                <label className="chip" key={i}>
                  <input
                    type="checkbox"
                    checked={ints.has(i)}
                    onChange={(e) => {
                      const n = new Set(ints);
                      if (e.target.checked) n.add(i);
                      else n.delete(i);
                      setInts(n);
                    }}
                  />
                  {i}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="f-user">User email</label>
            <input id="f-user" value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-op">Operation</label>
            <input id="f-op" value={operation} onChange={(e) => setOperation(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-job">Task id</label>
            <input
              id="f-job"
              className="mono"
              value={job}
              onChange={(e) => setJob(e.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="f-ok">Result</label>
            <select id="f-ok" value={ok} onChange={(e) => setOk(e.target.value)}>
              <option value="">All</option>
              <option value="ok">OK</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="submit">Filter</button>
          <Link className="button ghost" to="/logs">
            Clear
          </Link>
        </div>
      </form>
    </section>
  );
}

export function LogsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qs = params.toString();
  const q = useQuery({
    queryKey: qk.logs(qs),
    queryFn: () => api.get<LogPage>(`/logs${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const [detail, setDetail] = useState<LogRow | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const show = (r: LogRow) => {
    setDetail(r);
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
  };

  const cols = useMemo<Column<LogRow>[]>(
    () => [
      {
        id: 'time',
        header: 'Time',
        cell: (r) => (
          <button type="button" className="link" onClick={() => show(r)}>
            {when(r.at).slice(5, 16)}
          </button>
        ),
      },
      { id: 'integration', header: 'Integration', cell: (r) => r.integration },
      {
        id: 'operation',
        header: 'Operation',
        cell: (r) => (
          <>
            <span className="mono">{r.operation}</span>
            {r.model ? <div className="muted">{r.model}</div> : null}
          </>
        ),
      },
      { id: 'user', header: 'User', cell: (r) => r.userEmail ?? '—' },
      {
        id: 'task',
        header: 'Task',
        cell: (r) =>
          r.jobId ? (
            <Link className="mono" to={`/logs?job=${encodeURIComponent(r.jobId)}`}>
              {r.jobId.slice(0, 8)}
            </Link>
          ) : (
            '—'
          ),
      },
      {
        id: 'status',
        header: 'Status',
        num: true,
        cell: (r) => (r.statusCode === null ? '—' : r.statusCode),
      },
      {
        id: 'result',
        header: 'Result',
        cell: (r) => (r.ok ? <Pill kind="ok">OK</Pill> : <Pill kind="bad">Failed</Pill>),
      },
      { id: 'ms', header: 'ms', num: true, cell: (r) => r.durationMs },
      {
        id: 'cost',
        header: 'Cost',
        num: true,
        cell: (r) => (r.costUsd === null ? '' : usd(r.costUsd, 4)),
      },
    ],
    [],
  );

  const olderUrl = (() => {
    if (!q.data?.nextCursor) return null;
    const p = new URLSearchParams(params);
    p.set('cursor', q.data.nextCursor);
    return `/logs?${p.toString()}`;
  })();

  return (
    <>
      <PageHead
        title="Integration logs"
        description="Every call to OpenRouter, Spotify, LRCLIB, ntfy and Google. No secrets or content are stored."
      />
      <Filters key={qs.replace(/(^|&)cursor=[^&]*/, '')} params={params} />
      <section>
        {q.error ? <ErrorBox error={q.error} /> : null}
        {q.data ? (
          <div style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <DataTable
              columns={cols}
              data={q.data.rows}
              getRowId={(r) => r.id}
              onRowClick={show}
              rowClassName={(r) => (r.id === detail?.id ? 'highlight' : undefined)}
              empty="No calls match these filters."
              label="Integration calls"
            />
          </div>
        ) : (
          <SkeletonLines lines={8} />
        )}
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button
            className="ghost"
            type="button"
            disabled={!params.has('cursor')}
            onClick={() => void navigate(-1)}>
            ← Newer
          </button>
          {olderUrl ? (
            <Link className="button ghost" to={olderUrl}>
              Older →
            </Link>
          ) : q.data ? (
            <span className="muted">End of results</span>
          ) : null}
        </div>
        <div ref={detailRef} hidden={!detail}>
          {detail ? (
            <>
              <div
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
                <h2 style={{ fontSize: 13 }}>Call detail</h2>
                <button className="ghost small" type="button" onClick={() => setDetail(null)}>
                  Close
                </button>
              </div>
              <pre className="diff">
                {JSON.stringify({ ...detail, at: new Date(detail.at).toISOString() }, null, 2)}
              </pre>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}

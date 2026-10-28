import type { AdminPromptDetail, AdminPromptVersionRow } from '@postitup/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import { api, ApiError, errorMessage } from '../api/client';
import { qk } from '../api/queries';
import { type Column, DataTable } from '../components/DataTable';
import { ErrorBox, Msg, PageHead, SkeletonLines } from '../components/ui';
import { lineDiff } from '../lib/diff';
import { when } from '../lib/format';
import { useMsg } from '../lib/hooks';
import { toast } from '../lib/toast';

function Editor({
  prompt,
  versions,
}: {
  prompt: AdminPromptDetail;
  versions: AdminPromptVersionRow[];
}) {
  const qc = useQueryClient();
  const active = versions.find((v) => v.active);
  const [body, setBody] = useState(active?.body ?? '');
  const [note, setNote] = useState('');
  const [msg, say] = useMsg();
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const known = useMemo(() => new Set(prompt.placeholders.map((p) => p.name)), [prompt]);
  const unknown = [
    ...new Set(
      [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).filter((n) => !known.has(n)),
    ),
  ];

  const insert = (name: string) => {
    const el = ta.current;
    if (!el) return;
    el.setRangeText(`{{${name}}}`, el.selectionStart, el.selectionEnd, 'end');
    setBody(el.value);
    el.focus();
  };

  const save = async () => {
    if (active && body === active.body) {
      say('No changes to save.', 'bad');
      return;
    }
    say('Saving…');
    setBusy(true);
    try {
      const r = await api.post<{ version: number }>(`/prompts/${encodeURIComponent(prompt.key)}`, {
        body,
        note,
      });
      setNote('');
      await qc.invalidateQueries({ queryKey: qk.prompts });
      say(`Saved as v${r.version} (now live).`, 'good');
    } catch (e) {
      say(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Edit (saving creates a new version and makes it live)</h2>
      <label>Placeholders (click to insert)</label>
      <div className="chips">
        {prompt.placeholders.map((p) => (
          <button
            key={p.name}
            type="button"
            className="chip"
            title={p.description}
            onClick={() => insert(p.name)}>
            {`{{${p.name}}}`}
          </button>
        ))}
      </div>
      <label htmlFor="body" className="sr-only">
        Prompt body
      </label>
      <textarea
        id="body"
        ref={ta}
        rows={22}
        spellCheck={false}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="msg bad" role="status">
        {unknown.length
          ? `Unknown placeholder${unknown.length > 1 ? 's' : ''} (left as typed): ${unknown.map((n) => `{{${n}}}`).join(', ')}`
          : ''}
      </div>
      <div className="row">
        <div className="grow">
          <label htmlFor="note">Note for this version</label>
          <input
            id="note"
            maxLength={300}
            placeholder="What changed and why"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button type="button" onClick={save} disabled={busy}>
          Save as new version
        </button>
      </div>
      <Msg msg={msg} />
    </section>
  );
}

export function PromptPage() {
  const { key = '' } = useParams();
  const qc = useQueryClient();
  const prompt = useQuery({
    queryKey: ['prompts', key, 'detail'],
    queryFn: () => api.get<AdminPromptDetail>(`/prompts/${encodeURIComponent(key)}`),
  });
  const versions = useQuery({
    queryKey: qk.versions(key),
    queryFn: () => api.get<AdminPromptVersionRow[]>(`/prompts/${encodeURIComponent(key)}/versions`),
    enabled: !!prompt.data,
  });
  const [view, setView] = useState<number | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const list = versions.data;
  const active = list?.find((v) => v.active);

  const activate = async (version: number) => {
    try {
      await api.post(`/prompts/${encodeURIComponent(key)}/activate`, { version });
      await qc.invalidateQueries({ queryKey: qk.prompts });
      toast(`v${version} is live again.`, 'good');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const cols = useMemo<Column<AdminPromptVersionRow>[]>(
    () => [
      {
        id: 'version',
        header: 'Version',
        cell: (v) => (
          <>
            v{v.version} {v.active ? <span className="badge">Active</span> : null}
          </>
        ),
      },
      { id: 'date', header: 'Date', cell: (v) => when(v.createdAt) },
      {
        id: 'note',
        header: 'Note',
        wrap: true,
        cell: (v) => <span className="muted">{v.note || '—'}</span>,
      },
      { id: 'tasks', header: 'Tasks', num: true, cell: (v) => v.jobs },
      { id: 'failed', header: 'Failed', num: true, cell: (v) => v.failed },
      { id: 'posted', header: 'Posted', num: true, cell: (v) => v.posted },
      {
        id: 'actions',
        header: '',
        cell: (v) => (
          <div className="actions">
            <button
              className="ghost small"
              type="button"
              onClick={() => {
                setView(v.version);
                requestAnimationFrame(() =>
                  viewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
                );
              }}>
              View
            </button>
            {v.active ? null : (
              <button
                className="small secondary"
                type="button"
                onClick={() => void activate(v.version)}>
                Make active
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `activate` only depends on `key`
    [key],
  );

  if (prompt.error instanceof ApiError && prompt.error.status === 404) {
    return (
      <>
        <PageHead title="Prompt not found" />
        <p>
          No such prompt. <Link to="/prompts">All prompts</Link>
        </p>
      </>
    );
  }

  const p = prompt.data;
  const shown = list?.find((v) => v.version === view);
  const rows = shown
    ? active && !shown.active
      ? lineDiff(active.body, shown.body)
      : shown.body.split('\n').map((l) => ['same', l] as const)
    : [];

  return (
    <>
      <PageHead title={p?.title ?? 'Prompt'} />
      {prompt.error ? <ErrorBox error={prompt.error} /> : null}
      <p>
        <Link to="/prompts">← All prompts</Link> · <span className="muted mono">{key}</span>
      </p>
      {p ? (
        <>
          <p className="muted">{p.description}</p>
          <p>
            Model: <strong>{p.model.name}</strong>
            {p.model.isDefault ? <span className="muted"> (default)</span> : null} ·{' '}
            <Link to={`/ai#step-${encodeURIComponent(p.key)}`}>Change</Link>
          </p>
        </>
      ) : null}
      {p && list ? (
        <Editor key={active ? `${active.version}` : 'none'} prompt={p} versions={list} />
      ) : (
        <section>
          <SkeletonLines lines={8} />
        </section>
      )}
      <section>
        <h2>History</h2>
        {versions.error ? <ErrorBox error={versions.error} /> : null}
        {list ? (
          <DataTable
            columns={cols}
            data={list}
            getRowId={(v) => String(v.version)}
            label="Versions"
          />
        ) : (
          <SkeletonLines />
        )}
        <div ref={viewRef} hidden={!shown}>
          {shown ? (
            <>
              <div
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <strong>
                  v{shown.version}
                  {shown.active ? ' (active)' : ` compared with active v${active?.version ?? '?'}`}
                </strong>
                <button className="ghost small" type="button" onClick={() => setView(null)}>
                  Close
                </button>
              </div>
              <p className="muted">
                + lines are only in this version, − lines only in the active one.
              </p>
              <pre className="diff">
                {rows.map(([kind, text], i) => (
                  <span key={i} className={kind}>
                    {(kind === 'add' ? '+ ' : kind === 'del' ? '− ' : '  ') + text}
                  </span>
                ))}
              </pre>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}

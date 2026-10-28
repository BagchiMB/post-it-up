import type { DbQueryResponse } from '@postitup/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { api, errorMessage, requestBlob } from '../../api/client';
import type { QueryHistoryItem, Snippet } from '../../api/types';
import { type Column, DataTable } from '../../components/DataTable';
import { ConfirmDialog, Modal } from '../../components/Overlay';
import { ErrorBox, Msg, PageHead, SkeletonLines } from '../../components/ui';
import { num, when } from '../../lib/format';
import { useMsg } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { cellText, dbKeys, download, MASK, useWriteMode } from './dbApi';
import { WriteModeBanner } from './WriteMode';

type ReadResult = Extract<DbQueryResponse, { kind: 'read' }>;
type Preview = Extract<DbQueryResponse, { kind: 'preview' }>;

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);

function ResultTable({ result }: { result: ReadResult }) {
  const cols = useMemo<Column<unknown[]>[]>(
    () =>
      result.columns.map((c, i) => ({
        id: `${i}`,
        header: c,
        cell: (r: unknown[]) => {
          const v = r[i];
          if (v === null || v === undefined) return <span className="cell-null">NULL</span>;
          if (v === MASK) return <span className="masked">{MASK}</span>;
          const t = cellText(v);
          return (
            <span className="cell" title={t.length > 40 ? t : undefined}>
              {t}
            </span>
          );
        },
      })),
    [result.columns],
  );
  return <DataTable columns={cols} data={result.rows} empty="No rows." label="Query results" />;
}

function AffectConfirm({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: Preview['preview'];
  busy: boolean;
  onConfirm: (affectAll: boolean) => void;
  onCancel: () => void;
}) {
  const [all, setAll] = useState(false);
  const n = preview.affected ?? 0;
  return (
    <Modal
      title={
        preview.action === 'insert'
          ? 'Insert a row?'
          : `${num(n)} row${n === 1 ? '' : 's'} will change`
      }
      onClose={onCancel}
      initialFocus={preview.needsAffectAll ? 'input' : 'button.confirm'}>
      <p className="muted">
        {preview.action === 'insert'
          ? `This inserts into ${preview.table}.`
          : `${preview.action === 'delete' ? 'DELETE' : 'UPDATE'} on ${preview.table}: ${num(n)} row(s) match.`}{' '}
        A backup is taken before the first change of this write session, and every row is recorded
        in the audit log.
      </p>
      {preview.needsAffectAll ? (
        <>
          <p className="callout bad">
            There is no WHERE clause: this changes every row in the table.
          </p>
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{' '}
            Affect all rows
          </label>
        </>
      ) : null}
      <div className="actions">
        <button className="ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={`confirm${preview.action === 'delete' ? ' danger' : ''}`}
          type="button"
          disabled={busy || (preview.needsAffectAll && !all)}
          onClick={() => onConfirm(all)}>
          {busy ? 'Working…' : 'Run it'}
        </button>
      </div>
    </Modal>
  );
}

export function QueryPage() {
  const qc = useQueryClient();
  const wm = useWriteMode();
  const [sql, setSql] = useState('SELECT * FROM users LIMIT 20');
  const [result, setResult] = useState<ReadResult | null>(null);
  const [lastSql, setLastSql] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [msg, say] = useMsg();
  const ta = useRef<HTMLTextAreaElement>(null);
  const history = useQuery({
    queryKey: dbKeys.history,
    queryFn: () => api.get<QueryHistoryItem[]>('/db/history'),
  });
  const snippets = useQuery({
    queryKey: dbKeys.snippets,
    queryFn: () => api.get<Snippet[]>('/db/snippets'),
  });

  const after = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: dbKeys.history }),
      qc.invalidateQueries({ queryKey: ['db', 'rows'] }),
      qc.invalidateQueries({ queryKey: ['db', 'audit'] }),
      qc.invalidateQueries({ queryKey: dbKeys.writeMode }),
    ]);

  const run = async () => {
    if (!sql.trim() || busy) return;
    setBusy(true);
    setError(null);
    say('Running…');
    try {
      const r = await api.post<DbQueryResponse>('/db/query', { sql });
      if (r.kind === 'read') {
        setResult(r);
        setLastSql(sql);
        say(
          `${num(r.rowCount)} row${r.rowCount === 1 ? '' : 's'} · ${r.durationMs} ms${r.truncated ? ` · truncated to the first ${num(r.limits.maxRows)}` : ''}`,
        );
      } else if (r.kind === 'preview') {
        setPreview(r);
        say('');
      } else {
        say(`${num(r.changes)} row(s) changed · ${r.durationMs} ms`, 'good');
      }
    } catch (e) {
      setError(e);
      say('');
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: dbKeys.history });
    }
  };

  const confirmWrite = async (affectAll: boolean) => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api.post<DbQueryResponse>('/db/query', {
        sql,
        confirmToken: preview.confirmToken,
        ...(affectAll ? { affectAll: true } : {}),
      });
      setPreview(null);
      if (r.kind === 'write') say(`${num(r.changes)} row(s) changed · ${r.durationMs} ms`, 'good');
      await after();
    } catch (e) {
      setPreview(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      download(await requestBlob('/admin/api/db/query/csv', { sql: lastSql }), 'query.csv');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const saveSnippet = async (name: string) => {
    if (!name.trim()) return;
    try {
      await api.post('/db/snippets', { name: name.trim(), sql });
      await qc.invalidateQueries({ queryKey: dbKeys.snippets });
      toast(`Saved snippet “${name.trim()}”.`, 'good');
      setSaving(false);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const deleteSnippet = async (s: Snippet) => {
    try {
      await api.delete(`/db/snippets/${s.id}`, {});
      await qc.invalidateQueries({ queryKey: dbKeys.snippets });
      toast(`Deleted snippet “${s.name}”.`, 'good');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const load = (text: string) => {
    setSql(text);
    ta.current?.focus();
  };

  return (
    <>
      <PageHead
        title="SQL console"
        description="One statement at a time, read-only unless write mode is on. 5 s limit, 1000 rows max; secrets stay masked."
      />
      <WriteModeBanner />
      <div className="grid-2">
        <div style={{ minWidth: 0 }}>
          <section>
            <label htmlFor="sql">SQL</label>
            <textarea
              id="sql"
              ref={ta}
              className="sql-editor"
              rows={8}
              spellCheck={false}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void run();
                }
              }}
            />
            <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
              <button type="button" onClick={() => void run()} disabled={busy || !sql.trim()}>
                Run{' '}
                <span className="muted" style={{ color: 'inherit', opacity: 0.75 }}>
                  {isMac ? '⌘↵' : 'Ctrl+↵'}
                </span>
              </button>
              <button
                className="secondary"
                type="button"
                disabled={!sql.trim()}
                onClick={() => setSaving(true)}>
                Save as snippet
              </button>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {wm.data?.on
                  ? 'Write mode: INSERT / UPDATE / DELETE allowed (with confirmation).'
                  : 'Read-only: SELECT / WITH / VALUES / EXPLAIN.'}
              </span>
            </div>
            <Msg msg={msg} />
            {error ? <ErrorBox error={error} /> : null}
          </section>
          {result ? (
            <section>
              <div
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>
                  Results · {num(result.rowCount)} row{result.rowCount === 1 ? '' : 's'} ·{' '}
                  {result.durationMs} ms
                </h2>
                <button className="ghost small" type="button" onClick={() => void exportCsv()}>
                  Export CSV
                </button>
              </div>
              {result.truncated ? (
                <p className="callout">
                  Only the first {num(result.limits.maxRows)} rows are shown. Add a LIMIT or a WHERE
                  to narrow it down.
                </p>
              ) : null}
              <ResultTable result={result} />
            </section>
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <section>
            <h2>Snippets</h2>
            {snippets.data ? (
              snippets.data.length ? (
                <ul className="side-list">
                  {snippets.data.map((s) => (
                    <li key={s.id}>
                      <div
                        className="row"
                        style={{
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'nowrap',
                        }}>
                        <button
                          type="button"
                          className="link"
                          style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          onClick={() => load(s.sql)}>
                          {s.name}
                        </button>
                        <button
                          className="ghost small"
                          type="button"
                          aria-label={`Delete snippet ${s.name}`}
                          onClick={() => void deleteSnippet(s)}>
                          Delete
                        </button>
                      </div>
                      <span className="sql muted">{s.sql}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">No snippets yet. Save a query to reuse it.</p>
              )
            ) : (
              <SkeletonLines lines={3} />
            )}
          </section>
          <section>
            <h2>History (last 50)</h2>
            {history.data ? (
              history.data.length ? (
                <ul className="side-list">
                  {history.data.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="link sql"
                        title={h.sql}
                        onClick={() => load(h.sql)}>
                        {h.sql}
                      </button>
                      <span className="muted" style={{ fontSize: 12 }}>
                        <span className={`dot ${h.ok ? 'ok' : 'bad'}`} />
                        {when(h.at)} ·{' '}
                        {h.ok ? `${h.rowCount ?? 0} rows · ${h.durationMs} ms` : 'failed'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">Nothing run yet.</p>
              )
            ) : (
              <SkeletonLines lines={4} />
            )}
          </section>
        </div>
      </div>
      {preview ? (
        <AffectConfirm
          preview={preview.preview}
          busy={busy}
          onConfirm={(a) => void confirmWrite(a)}
          onCancel={() => setPreview(null)}
        />
      ) : null}
      {saving ? (
        <ConfirmDialog
          title="Save as snippet"
          input={{ label: 'Name', maxLength: 100 }}
          confirmLabel="Save"
          onConfirm={(name) => void saveSnippet(name)}
          onCancel={() => setSaving(false)}
        />
      ) : null}
    </>
  );
}

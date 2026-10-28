import type { DbAuditEntry, DbTables } from '@postitup/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../../api/client';
import { type Column, DataTable } from '../../components/DataTable';
import { Drawer } from '../../components/Overlay';
import { ErrorBox, PageHead, Pill, SkeletonLines } from '../../components/ui';
import { lineDiff } from '../../lib/diff';
import { when } from '../../lib/format';
import { cellText, dbKeys, tablePath } from './dbApi';
import { WriteModeBanner } from './WriteMode';

const PAGE_SIZE = 50;
const rowidOf = (k: unknown) =>
  k && typeof k === 'object' && 'rowid' in k ? cellText(k.rowid) : cellText(k);
const pretty = (v: unknown) => (v === null ? '' : JSON.stringify(v, null, 2));

function AuditDrawer({ entry, onClose }: { entry: DbAuditEntry; onClose: () => void }) {
  const rows = lineDiff(pretty(entry.before), pretty(entry.after));
  return (
    <Drawer
      wide
      kicker={`${entry.action} · ${when(entry.at)} · ${entry.admin}`}
      title={`${entry.table} · row ${rowidOf(entry.rowKey)}`}
      onClose={onClose}>
      <div className="drawer-body">
        <h3 className="section-title">SQL</h3>
        <pre className="diff" style={{ marginTop: 0 }}>
          {entry.sql}
        </pre>
        <h3 className="section-title" style={{ marginTop: 16 }}>
          Before → after
        </h3>
        <p className="muted">− lines were only in the row before the change, + lines only after.</p>
        <pre className="diff">
          {rows.map(([kind, text], i) => (
            <span key={i} className={kind}>
              {(kind === 'add' ? '+ ' : kind === 'del' ? '− ' : '  ') + text}
            </span>
          ))}
        </pre>
        {entry.action !== 'delete' ? (
          <p style={{ marginTop: 12 }}>
            <Link to={tablePath(entry.table, { row: rowidOf(entry.rowKey) })}>Open the row</Link>
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const qs = params.toString();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const q = useQuery({
    queryKey: dbKeys.audit(qs),
    queryFn: () => api.get<DbAuditEntry[]>(`/db/audit${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const tables = useQuery({
    queryKey: dbKeys.tables,
    queryFn: () => api.get<DbTables>('/db/tables'),
  });
  const [open, setOpen] = useState<DbAuditEntry | null>(null);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    setParams(p);
  };

  const cols = useMemo<Column<DbAuditEntry>[]>(
    () => [
      { id: 'at', header: 'When', cell: (e) => when(e.at) },
      { id: 'admin', header: 'Admin', cell: (e) => e.admin },
      {
        id: 'table',
        header: 'Table',
        cell: (e) => (
          <Link className="mono" to={tablePath(e.table)}>
            {e.table}
          </Link>
        ),
      },
      { id: 'row', header: 'Row', num: true, cell: (e) => rowidOf(e.rowKey) },
      {
        id: 'action',
        header: 'Action',
        cell: (e) => (
          <Pill kind={e.action === 'delete' ? 'bad' : e.action === 'insert' ? 'ok' : 'pending'}>
            {e.action}
          </Pill>
        ),
      },
      {
        id: 'sql',
        header: 'SQL',
        cell: (e) => (
          <span className="mono cell" title={e.sql}>
            {e.sql}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHead
        title="Audit log"
        description="Every change made from the database browser: who, when, and the row before and after."
      />
      <WriteModeBanner />
      <section>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="field">
            <label htmlFor="a-table">Table</label>
            <select
              id="a-table"
              value={params.get('table') ?? ''}
              onChange={(e) => set('table', e.target.value)}>
              <option value="">All tables</option>
              {(tables.data?.tables ?? []).map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-action">Action</label>
            <select
              id="a-action"
              value={params.get('action') ?? ''}
              onChange={(e) => set('action', e.target.value)}>
              <option value="">All actions</option>
              <option value="insert">insert</option>
              <option value="update">update</option>
              <option value="delete">delete</option>
            </select>
          </div>
        </div>
        {q.error ? <ErrorBox error={q.error} /> : null}
        {q.data ? (
          <div style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <DataTable
              columns={cols}
              data={q.data}
              getRowId={(e) => String(e.id)}
              onRowClick={setOpen}
              empty="No changes recorded yet."
              label="Audit log"
            />
          </div>
        ) : (
          <SkeletonLines lines={8} />
        )}
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button
            className="ghost"
            type="button"
            disabled={page <= 1}
            onClick={() => set('page', page > 2 ? String(page - 1) : '')}>
            ← Newer
          </button>
          <button
            className="ghost"
            type="button"
            disabled={(q.data?.length ?? 0) < PAGE_SIZE}
            onClick={() => set('page', String(page + 1))}>
            Older →
          </button>
        </div>
      </section>
      {open ? <AuditDrawer entry={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

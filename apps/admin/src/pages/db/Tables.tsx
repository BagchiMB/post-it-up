import type { DbTables } from '@postitup/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../../api/client';
import { type Column, DataTable } from '../../components/DataTable';
import { ErrorBox, PageHead, SkeletonCards, SkeletonLines, StatCard } from '../../components/ui';
import { bytes, mb, num, when } from '../../lib/format';
import { dbKeys, tablePath } from './dbApi';
import { WriteModeBanner } from './WriteMode';

type T = DbTables['tables'][number];

const cols: Column<T>[] = [
  {
    id: 'name',
    header: 'Table',
    cell: (t) => (
      <Link className="mono" to={tablePath(t.name)}>
        {t.name}
      </Link>
    ),
  },
  { id: 'rows', header: 'Rows', num: true, cell: (t) => num(t.rows) },
  { id: 'size', header: 'Approx. size', num: true, cell: (t) => bytes(t.size) },
  {
    id: 'links',
    header: '',
    cell: (t) => (
      <div className="actions">
        <Link className="button ghost small" to={tablePath(t.name, { tab: 'structure' })}>
          Structure
        </Link>
        <Link className="button ghost small" to={tablePath(t.name, { tab: 'relations' })}>
          Relations
        </Link>
      </div>
    ),
  },
];

export function TablesPage() {
  const q = useQuery({ queryKey: dbKeys.tables, queryFn: () => api.get<DbTables>('/db/tables') });
  const d = q.data;
  return (
    <>
      <PageHead
        title="Database"
        description="Browse the SQLite tables. Read-only unless you turn on write mode."
      />
      <WriteModeBanner />
      {q.error ? <ErrorBox error={q.error} /> : null}
      {d ? (
        <div className="cards">
          <StatCard
            label="Schema version"
            value={`v${d.schemaVersion}`}
            sub={
              d.schemaVersion === d.expectedVersion
                ? 'Up to date'
                : `Code expects v${d.expectedVersion}`
            }
          />
          <StatCard label="Database size" value={mb(d.fileSize)} sub="app.db + WAL" />
          <StatCard
            label="Backups"
            value={String(d.backups)}
            sub={d.lastBackupAt ? `Last ${when(d.lastBackupAt)}` : 'None yet'}
          />
          <StatCard
            label="Tables"
            value={String(d.tables.length)}
            sub={`${num(d.tables.reduce((n, t) => n + t.rows, 0))} rows`}
          />
        </div>
      ) : (
        <SkeletonCards />
      )}
      <section>
        <h2>Tables</h2>
        {d ? (
          <DataTable columns={cols} data={d.tables} getRowId={(t) => t.name} label="Tables" />
        ) : (
          <SkeletonLines lines={8} />
        )}
      </section>
    </>
  );
}

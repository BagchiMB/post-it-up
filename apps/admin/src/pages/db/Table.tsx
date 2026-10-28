import type { DbRows, DbStructure } from '@postitup/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { api, ApiError } from '../../api/client';
import type { DbRelations } from '../../api/types';
import { type Column, DataTable } from '../../components/DataTable';
import { ErrorBox, PageHead, Pill, SkeletonLines } from '../../components/ui';
import { num } from '../../lib/format';
import { cellText, dbKeys, MASK, prettyJson, tablePath, useWriteMode } from './dbApi';
import { RelationsDiagram } from './RelationsDiagram';
import { RowDrawer } from './RowDrawer';
import { WriteModeBanner } from './WriteMode';

type Row = Record<string, unknown>;
type Op = 'contains' | 'eq' | 'empty' | 'notempty' | 'gt' | 'lt';
const OPS: { op: Op; label: string; value: boolean }[] = [
  { op: 'contains', label: 'contains', value: true },
  { op: 'eq', label: 'equals', value: true },
  { op: 'empty', label: 'is empty', value: false },
  { op: 'notempty', label: 'is not empty', value: false },
  { op: 'gt', label: '>', value: true },
  { op: 'lt', label: '<', value: true },
];
const opLabel = (op: string) => OPS.find((o) => o.op === op)?.label ?? op;

function Cell({ value, masked, json }: { value: unknown; masked: boolean; json: boolean }) {
  if (value === null || value === undefined) return <span className="cell-null">NULL</span>;
  if (masked || value === MASK) return <span className="masked">{MASK}</span>;
  const pretty = json ? prettyJson(value) : null;
  if (pretty) {
    return (
      <details className="json">
        <summary>{cellText(value).slice(0, 60)}</summary>
        <pre className="diff">{pretty}</pre>
      </details>
    );
  }
  const text = cellText(value);
  return (
    <span className="cell" title={text.length > 40 ? text : undefined}>
      {text}
    </span>
  );
}

/** Filters live in the URL as f.<column>=<op>:<value>. */
function FilterBar({ columns }: { columns: DbRows['columns'] }) {
  const [params, setParams] = useSearchParams();
  const active = [...params.entries()].filter(([k]) => k.startsWith('f.'));
  const [column, setColumn] = useState(columns[0]?.name ?? '');
  const [op, setOp] = useState<Op>('contains');
  const [value, setValue] = useState('');
  const masked = columns.find((c) => c.name === column)?.masked ?? false;
  const ops = masked ? OPS.filter((o) => !o.value) : OPS;
  const needsValue = OPS.find((o) => o.op === op)?.value ?? true;

  const update = (fn: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params);
    fn(p);
    p.delete('page');
    setParams(p);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <form
        className="filter-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!column) return;
          update((p) => p.set(`f.${column}`, needsValue ? `${op}:${value}` : op));
          setValue('');
        }}>
        <div>
          <label htmlFor="flt-col">Column</label>
          <select
            id="flt-col"
            value={column}
            onChange={(e) => {
              setColumn(e.target.value);
              if (columns.find((c) => c.name === e.target.value)?.masked) setOp('notempty');
            }}>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
                {c.masked ? ' (masked)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="flt-op">Condition</label>
          <select
            id="flt-op"
            value={ops.some((o) => o.op === op) ? op : ops[0].op}
            onChange={(e) => setOp(e.target.value as Op)}>
            {ops.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="flt-val">Value</label>
          <input
            id="flt-val"
            value={value}
            disabled={!needsValue}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <button className="secondary" type="submit">
          Add filter
        </button>
      </form>
      {active.length ? (
        <div className="chips" aria-label="Active filters">
          {active.map(([k, v]) => {
            const i = v.indexOf(':');
            const o = i < 0 ? v : v.slice(0, i);
            const val = i < 0 ? '' : v.slice(i + 1);
            return (
              <button
                key={k}
                type="button"
                className="chip"
                aria-label={`Remove filter ${k.slice(2)} ${opLabel(o)} ${val}`}
                onClick={() => update((p) => p.delete(k))}>
                {k.slice(2)} {opLabel(o)} {val ? `“${val}”` : ''} ×
              </button>
            );
          })}
          <button
            type="button"
            className="chip"
            onClick={() =>
              update((p) =>
                [...p.keys()].filter((x) => x.startsWith('f.')).forEach((x) => p.delete(x)),
              )
            }>
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DataTab({ name, structure }: { name: string; structure: DbStructure | undefined }) {
  const [params, setParams] = useSearchParams();
  const wm = useWriteMode();
  const apiParams = new URLSearchParams(params);
  apiParams.delete('tab');
  apiParams.delete('row');
  const qs = apiParams.toString();
  const q = useQuery({
    queryKey: dbKeys.rows(name, qs),
    queryFn: () =>
      api.get<DbRows>(`/db/tables/${encodeURIComponent(name)}/rows${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const rowParam = params.get('row');
  const openRow = rowParam === 'new' ? null : rowParam !== null ? Number(rowParam) : undefined;
  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const d = q.data;

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k);
    else p.set(k, v);
    setParams(p);
  };

  const onSort = (id: string) => {
    const p = new URLSearchParams(params);
    if (sort !== id) {
      p.set('sort', id);
      p.set('dir', 'asc');
    } else if (dir === 'asc') p.set('dir', 'desc');
    else {
      p.delete('sort');
      p.delete('dir');
    }
    p.delete('page');
    setParams(p);
  };

  const cols = useMemo<Column<Row>[]>(
    () =>
      (d?.columns ?? []).map((c) => ({
        id: c.name,
        header: c.name,
        sortable: !c.masked,
        title: c.masked ? 'Secret column: masked, not sortable' : undefined,
        cell: (r: Row) => <Cell value={r[c.name]} masked={c.masked} json={c.json} />,
      })),
    [d?.columns],
  );

  const page = d?.page ?? 1;
  return (
    <section>
      {d ? <FilterBar key={name} columns={d.columns} /> : null}
      <div
        className="row"
        style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="muted">
          {d
            ? `${num(d.total)} row${d.total === 1 ? '' : 's'} · page ${d.page} of ${d.pages}`
            : 'Loading…'}
        </span>
        {wm.data?.on && name !== 'db_audit' ? (
          <button className="small" type="button" onClick={() => setParam('row', 'new')}>
            Add row
          </button>
        ) : null}
      </div>
      {q.error ? <ErrorBox error={q.error} /> : null}
      {d ? (
        <div style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
          <DataTable
            columns={cols}
            data={d.rows}
            getRowId={(r) => String(r.__rowid)}
            onRowClick={(r) => setParam('row', String(r.__rowid))}
            rowClassName={(r) => (String(r.__rowid) === rowParam ? 'highlight' : undefined)}
            sort={sort ? { id: sort, dir } : null}
            onSort={onSort}
            empty={
              params.toString().includes('f.')
                ? 'No rows match these filters.'
                : 'This table is empty.'
            }
            label={`Rows of ${name}`}
          />
        </div>
      ) : (
        <SkeletonLines lines={10} />
      )}
      {d && d.pages > 1 ? (
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button
            className="ghost"
            type="button"
            disabled={page <= 1}
            onClick={() => setParam('page', page - 1 > 1 ? String(page - 1) : null)}>
            ← Previous
          </button>
          <button
            className="ghost"
            type="button"
            disabled={page >= d.pages}
            onClick={() => setParam('page', String(page + 1))}>
            Next →
          </button>
        </div>
      ) : null}
      {openRow !== undefined && (openRow === null || Number.isInteger(openRow)) ? (
        <RowDrawer
          key={rowParam}
          table={name}
          rowid={openRow}
          structure={structure}
          onClose={() => setParam('row', null)}
        />
      ) : null}
    </section>
  );
}

function StructureTab({ structure }: { structure: DbStructure | undefined }) {
  if (!structure)
    return (
      <section>
        <SkeletonLines lines={8} />
      </section>
    );
  type C = DbStructure['columns'][number];
  type I = DbStructure['indexes'][number];
  const cols: Column<C>[] = [
    { id: 'name', header: 'Column', cell: (c) => <strong className="mono">{c.name}</strong> },
    { id: 'type', header: 'Type', cell: (c) => <span className="mono">{c.type || '—'}</span> },
    { id: 'null', header: 'Nullable', cell: (c) => (c.notNull ? 'NOT NULL' : 'yes') },
    {
      id: 'default',
      header: 'Default',
      cell: (c) => <span className="mono">{c.default ?? '—'}</span>,
    },
    {
      id: 'flags',
      header: '',
      cell: (c) => (
        <span className="row" style={{ gap: 4 }}>
          {c.primaryKey ? <Pill kind="pending">PK</Pill> : null}
          {c.json ? <Pill kind="neutral">JSON</Pill> : null}
          {c.masked ? <Pill kind="warn">masked</Pill> : null}
        </span>
      ),
    },
  ];
  const idx: Column<I>[] = [
    { id: 'name', header: 'Index', cell: (i) => <span className="mono">{i.name}</span> },
    {
      id: 'cols',
      header: 'Columns',
      cell: (i) => <span className="mono">{i.columns.join(', ')}</span>,
    },
    { id: 'unique', header: 'Unique', cell: (i) => (i.unique ? 'yes' : 'no') },
    {
      id: 'origin',
      header: 'Origin',
      cell: (i) =>
        ({ c: 'CREATE INDEX', u: 'UNIQUE constraint', pk: 'PRIMARY KEY' })[i.origin] ?? i.origin,
    },
  ];
  return (
    <>
      <section>
        <h2>Columns ({structure.columns.length})</h2>
        <DataTable
          columns={cols}
          data={structure.columns}
          getRowId={(c) => c.name}
          label="Columns"
        />
      </section>
      <section>
        <h2>Indexes ({structure.indexes.length})</h2>
        <DataTable
          columns={idx}
          data={structure.indexes}
          getRowId={(i) => i.name}
          empty="No indexes."
          label="Indexes"
        />
      </section>
    </>
  );
}

function RelationsTab({ name }: { name: string }) {
  const q = useQuery({
    queryKey: dbKeys.relations,
    queryFn: () => api.get<DbRelations>('/db/relations'),
  });
  const d = q.data;
  const mine = (d?.relations ?? []).filter((r) => r.from === name || r.to === name);
  return (
    <section>
      {q.error ? <ErrorBox error={q.error} /> : null}
      {d ? (
        <>
          <RelationsDiagram tables={d.tables} relations={d.relations} current={name} />
          <p className="muted">
            Solid lines are declared foreign keys; dashed lines are inferred from{' '}
            <span className="mono">&lt;x&gt;_id → &lt;x&gt;s.id</span> names. Click a table to open
            it.
          </p>
          <h2 className="section-title" style={{ marginTop: 16 }}>
            Relations of {name} ({mine.length})
          </h2>
          {mine.length ? (
            <ul className="side-list">
              {mine.map((r, i) => (
                <li key={i}>
                  <Link to={tablePath(r.from, { tab: 'relations' })} className="mono">
                    {r.from}
                  </Link>
                  <span className="mono">.{r.fromColumn}</span> →{' '}
                  <Link to={tablePath(r.to, { tab: 'relations' })} className="mono">
                    {r.to}
                  </Link>
                  <span className="mono">.{r.toColumn}</span>{' '}
                  {r.inferred ? (
                    <Pill kind="neutral">inferred</Pill>
                  ) : (
                    <Pill kind="ok">foreign key</Pill>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No relations to or from this table.</p>
          )}
        </>
      ) : (
        <SkeletonLines lines={8} />
      )}
    </section>
  );
}

export function TablePage() {
  const { name = '' } = useParams();
  const [params] = useSearchParams();
  const tab = params.get('tab') ?? 'data';
  const structure = useQuery({
    queryKey: dbKeys.structure(name),
    queryFn: () => api.get<DbStructure>(`/db/tables/${encodeURIComponent(name)}/structure`),
  });
  const notFound = structure.error instanceof ApiError && structure.error.status === 404;
  const tabs = [
    { id: 'data', label: 'Data' },
    { id: 'structure', label: 'Structure' },
    { id: 'relations', label: 'Relations' },
  ];
  return (
    <>
      <PageHead title={name} description={<Link to="/db">← All tables</Link>} />
      <WriteModeBanner />
      {notFound ? (
        <ErrorBox error={structure.error} />
      ) : (
        <>
          <nav className="tabs" aria-label="Table views">
            {tabs.map((t) => (
              <Link
                key={t.id}
                to={tablePath(name, t.id === 'data' ? {} : { tab: t.id })}
                aria-current={tab === t.id ? 'page' : undefined}>
                {t.label}
              </Link>
            ))}
          </nav>
          {tab === 'structure' ? (
            <StructureTab structure={structure.data} />
          ) : tab === 'relations' ? (
            <RelationsTab name={name} />
          ) : (
            <DataTab key={name} name={name} structure={structure.data} />
          )}
        </>
      )}
    </>
  );
}

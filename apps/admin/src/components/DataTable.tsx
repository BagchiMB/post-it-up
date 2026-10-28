import { createColumnHelper, type RowData, tableFeatures, useTable } from '@tanstack/react-table';
import { type ReactNode, useMemo } from 'react';

import { Empty } from './ui';

/**
 * Data tables (users, logs, DB rows, …) on TanStack Table v9. The table owns the row/column
 * models; sorting and paging stay server-side (URL-driven), so headers only report clicks.
 */

type ColMeta = { num?: boolean; wrap?: boolean; sortable?: boolean; title?: string };
const columnMeta: ColMeta = {};
const features = tableFeatures({ columnMeta });

export type Column<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-aligned, tabular numbers. */
  num?: boolean;
  /** Allow wrapping (long text). */
  wrap?: boolean;
  /** Header becomes a sort button (calls `onSort`). */
  sortable?: boolean;
  /** Tooltip on the header. */
  title?: string;
};

export type SortState = { id: string; dir: 'asc' | 'desc' } | null;

export function DataTable<T extends RowData>({
  columns,
  data,
  empty = 'Nothing yet.',
  getRowId,
  onRowClick,
  rowClassName,
  sort,
  onSort,
  label,
}: {
  columns: Column<T>[];
  data: T[];
  empty?: ReactNode;
  getRowId?: (row: T, index: number) => string;
  /** Row click (also Enter on the focused row). */
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  sort?: SortState;
  onSort?: (id: string) => void;
  /** Accessible table name. */
  label?: string;
}) {
  const defs = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return columns.map((c) =>
      helper.display({
        id: c.id,
        header: () => c.header,
        cell: ({ row }) => c.cell(row.original),
        meta: { num: c.num, wrap: c.wrap, sortable: c.sortable, title: c.title },
      }),
    );
  }, [columns]);

  const table = useTable({
    features,
    columns: defs,
    data,
    ...(getRowId ? { getRowId } : {}),
  });

  if (!data.length) return <Empty>{empty}</Empty>;

  return (
    <div className="table-wrap">
      <table aria-label={label}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const sorted = sort?.id === header.column.id ? sort.dir : null;
                return (
                  <th
                    key={header.id}
                    className={meta?.num ? 'num' : undefined}
                    title={meta?.title}
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }>
                    {meta?.sortable && onSort ? (
                      <button
                        type="button"
                        className="sort"
                        onClick={() => onSort(header.column.id)}>
                        <table.FlexRender header={header} />
                        <span aria-hidden="true">
                          {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}
                        </span>
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={
                [onRowClick ? 'clickable' : '', rowClassName?.(row.original) ?? '']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              {...(onRowClick
                ? {
                    tabIndex: 0,
                    onClick: (e) => {
                      // Links and buttons inside the row keep their own behaviour.
                      if ((e.target as HTMLElement).closest('a, button, input, details')) return;
                      onRowClick(row.original);
                    },
                    onKeyDown: (e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget)
                        onRowClick(row.original);
                    },
                  }
                : {})}>
              {row.getAllCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <td key={cell.id} className={meta?.num ? 'num' : meta?.wrap ? 'wrap' : undefined}>
                    <table.FlexRender cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

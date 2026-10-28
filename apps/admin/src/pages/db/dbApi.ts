import type { DbWriteMode } from '@postitup/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';

export const dbKeys = {
  writeMode: ['db', 'write-mode'] as const,
  tables: ['db', 'tables'] as const,
  relations: ['db', 'relations'] as const,
  structure: (t: string) => ['db', 'structure', t] as const,
  rows: (t: string, qs: string) => ['db', 'rows', t, qs] as const,
  row: (t: string, rowid: number) => ['db', 'row', t, rowid] as const,
  history: ['db', 'history'] as const,
  snippets: ['db', 'snippets'] as const,
  audit: (qs: string) => ['db', 'audit', qs] as const,
};

export const useWriteMode = () =>
  useQuery({
    queryKey: dbKeys.writeMode,
    queryFn: () => api.get<DbWriteMode>('/db/write-mode'),
    staleTime: 30_000,
  });

export const tablePath = (name: string, params?: Record<string, string>) =>
  `/db/tables/${encodeURIComponent(name)}${params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : ''}`;

export const MASK = '••••';

/** Display text for a cell value. */
export const cellText = (v: unknown): string =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'string'
      ? v
      : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint'
        ? String(v)
        : JSON.stringify(v);

/** Pretty JSON when the text parses, else null. */
export function prettyJson(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return null;
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return null;
  }
}

/** Triggers a browser download for a Blob. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import type { AdminPrompt } from '@postitup/shared';
import { Link } from 'react-router';

import { usePrompts } from '../api/queries';
import { type Column, DataTable } from '../components/DataTable';
import { ErrorBox, PageHead, SkeletonLines } from '../components/ui';

const cols: Column<AdminPrompt>[] = [
  {
    id: 'prompt',
    header: 'Prompt',
    wrap: true,
    cell: (p) => (
      <>
        <Link to={`/prompts/${encodeURIComponent(p.key)}`}>
          <strong>{p.title}</strong>
        </Link>
        <div className="muted mono">{p.key}</div>
      </>
    ),
  },
  {
    id: 'for',
    header: 'Used for',
    wrap: true,
    cell: (p) => <span className="muted">{p.description}</span>,
  },
  {
    id: 'active',
    header: 'Active',
    num: true,
    cell: (p) => (p.active ? `v${p.active.version}` : '—'),
  },
  { id: 'versions', header: 'Versions', num: true, cell: (p) => p.versionCount },
];

export function PromptsPage() {
  const prompts = usePrompts();
  return (
    <>
      <PageHead
        title="Prompts"
        description="The instructions sent to the model. Every save is a new version you can roll back."
      />
      {prompts.error ? <ErrorBox error={prompts.error} /> : null}
      <section>
        {prompts.data ? (
          <DataTable columns={cols} data={prompts.data} getRowId={(p) => p.key} label="Prompts" />
        ) : (
          <SkeletonLines lines={6} />
        )}
      </section>
    </>
  );
}

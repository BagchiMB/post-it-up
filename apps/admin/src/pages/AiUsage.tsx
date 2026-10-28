import type { AdminUsage, Credits } from '@postitup/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { modelsQuery, useSettings, useUsage } from '../api/queries';
import { BarChart } from '../components/BarChart';
import { type Column, DataTable } from '../components/DataTable';
import { ErrorBox, PageHead, SkeletonCards, SkeletonLines, StatCard } from '../components/ui';
import { usd } from '../lib/format';
import { FreeTierWarning } from './shared';

function CreditsCards({ credits }: { credits: Credits | null }) {
  if (!credits)
    return (
      <StatCard
        label="Account balance"
        value="—"
        sub="Unavailable (no key, or OpenRouter didn’t answer)"
      />
    );
  const k = credits.key;
  return (
    <>
      {credits.source === 'credits' ? (
        <StatCard
          label="Account balance"
          value={usd(credits.balance)}
          sub={`loaded ${usd(credits.total)} · used ${usd(credits.used)}`}
        />
      ) : (
        <StatCard
          label="Account balance"
          value="—"
          sub="OpenRouter didn’t return account credits (GET /credits failed)"
        />
      )}
      {k ? (
        <StatCard
          label="This key’s spending limit"
          value={k.limit === null ? 'No limit' : usd(k.limitRemaining)}
          sub={
            k.limit === null
              ? 'The key can spend the whole balance'
              : `left of ${usd(k.limit)} · not money in the account`
          }
        />
      ) : null}
      {k ? (
        <StatCard
          label="Key usage today"
          value={usd(k.usageDaily)}
          sub={`week ${usd(k.usageWeekly)} · month ${usd(k.usageMonthly)}`}
        />
      ) : null}
    </>
  );
}

type UserRow = AdminUsage['byUser'][number];
type StepRow = AdminUsage['byStep'][number];
type ModelRow = AdminUsage['byModel'][number];

const userCols: Column<UserRow>[] = [
  { id: 'user', header: 'User', cell: (r) => r.email },
  { id: 'tasks', header: 'Tasks', num: true, cell: (r) => r.posts },
  { id: 'spend', header: 'Spend', num: true, cell: (r) => usd(r.cost, 4) },
];
const stepCols: Column<StepRow>[] = [
  {
    id: 'step',
    header: 'Step (prompt)',
    cell: (r) => <Link to={`/prompts/${encodeURIComponent(r.key)}`}>{r.key}</Link>,
  },
  { id: 'calls', header: 'Calls', num: true, cell: (r) => r.calls },
  { id: 'spend', header: 'Spend', num: true, cell: (r) => usd(r.cost, 4) },
];

export function AiUsagePage() {
  const usage = useUsage(30);
  const settings = useSettings();
  const models = useQuery(modelsQuery);
  const names = useMemo(
    () => new Map((models.data ?? []).map((m) => [m.id, m.name])),
    [models.data],
  );
  const modelCols = useMemo<Column<ModelRow>[]>(
    () => [
      {
        id: 'model',
        header: 'Model',
        cell: (r) => (
          <span className="mono">
            {names.get(r.model) ?? r.model}
            {r.routedModel ? ` → ${r.routedModel}` : ''}
          </span>
        ),
      },
      { id: 'calls', header: 'Calls', num: true, cell: (r) => r.calls },
      { id: 'spend', header: 'Spend', num: true, cell: (r) => usd(r.cost, 4) },
      {
        id: 'posted',
        header: 'Posted rate',
        num: true,
        cell: (r) =>
          r.postedRate === null ? (
            <span className="muted">—</span>
          ) : (
            <>
              {Math.round(r.postedRate * 100)}%{' '}
              <span className="muted">
                ({r.posted} of {r.posts})
              </span>
            </>
          ),
      },
    ],
    [names],
  );

  const u = usage.data;
  const total = u ? u.byDay.reduce((n, d) => n + d.cost, 0) : 0;
  return (
    <>
      <PageHead
        title="AI usage"
        description="OpenRouter credits and what each user, step and model has cost."
      />
      {usage.error ? <ErrorBox error={usage.error} /> : null}
      <section>
        <h2>OpenRouter</h2>
        {u ? (
          <>
            <FreeTierWarning
              credits={u.credits}
              modelName={settings.data?.model.name ?? 'paid models'}
            />
            <div
              className="cards"
              style={u.credits?.key?.isFreeTier ? { marginTop: 14 } : undefined}>
              <CreditsCards credits={u.credits} />
            </div>
          </>
        ) : (
          <SkeletonCards count={3} />
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Account balance from GET /api/v1/credits; the key’s limit and usage from GET /api/v1/key.
          Cached for about a minute.
        </p>
      </section>
      <section>
        <h2>Our spend, last 30 days{u ? ` · ${usd(total)}` : ''}</h2>
        {u ? <BarChart byDay={u.byDay} /> : <SkeletonLines lines={5} />}
      </section>
      <section>
        <h2>By user</h2>
        {u ? (
          <DataTable columns={userCols} data={u.byUser} label="Spend by user" />
        ) : (
          <SkeletonLines />
        )}
      </section>
      <section>
        <h2>By AI step</h2>
        {u ? (
          <DataTable columns={stepCols} data={u.byStep} label="Spend by AI step" />
        ) : (
          <SkeletonLines />
        )}
      </section>
      <section>
        <h2>By model</h2>
        <p className="muted">
          Posted rate: posts the user marked as posted ÷ posts made with that model (final post
          step).
        </p>
        {u ? (
          <DataTable columns={modelCols} data={u.byModel} label="Spend by model" />
        ) : (
          <SkeletonLines />
        )}
      </section>
    </>
  );
}

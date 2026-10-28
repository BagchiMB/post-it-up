import type { AdminOverview, AdminSession } from '@postitup/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router';

import { api } from '../api/client';
import { qk } from '../api/queries';
import { ErrorBox, PageHead, Pill, SkeletonCards, SkeletonLines, StatCard } from '../components/ui';
import { usd, when } from '../lib/format';
import { FreeTierWarning } from './shared';

export function OverviewPage() {
  const q = useQuery({ queryKey: qk.overview, queryFn: () => api.get<AdminOverview>('/overview') });
  const d = q.data;
  const qc = useQueryClient();
  // /overview waits for a fresh credits lookup, so its balance is newer than the session's on a
  // first visit: share it so the global banner (Shell) shows here too.
  const balance = d?.balance;
  useEffect(() => {
    if (!balance) return;
    qc.setQueryData<AdminSession>(qk.session, (s) =>
      s ? { ...s, openrouter: { ...s.openrouter, balance } } : s,
    );
  }, [balance, qc]);
  return (
    <>
      <PageHead
        title="Overview"
        description="Credits, today’s activity and the health of every integration at a glance."
      />
      {q.error ? <ErrorBox error={q.error} /> : null}
      {!d ? (
        q.isPending ? (
          <>
            <SkeletonCards />
            <section>
              <SkeletonLines />
            </section>
          </>
        ) : null
      ) : (
        <>
          <FreeTierWarning credits={d.credits} modelName={d.model.name} />
          {d.aiOutOfCredits ? (
            <p className="callout bad" role="alert">
              AI calls failing: out of credits (last failure {when(d.aiOutOfCredits.lastFailureAt)}
              ). <Link to="/integrations">Integrations</Link>
            </p>
          ) : null}
          <div className="cards">
            {d.credits?.source === 'credits' ? (
              <StatCard
                label="Account balance"
                value={usd(d.credits.balance)}
                sub={<Link to="/ai-usage">AI usage</Link>}
              />
            ) : (
              <StatCard
                label="Account balance"
                value="—"
                sub={
                  <>
                    {d.creditsError ?? 'Not available'} · <Link to="/ai-usage">AI usage</Link>
                  </>
                }
              />
            )}
            <StatCard
              label="Spend today"
              value={usd(d.spendToday.costUsd)}
              sub={`${d.spendToday.calls} AI calls`}
            />
            <StatCard label="Tasks today" value={String(d.tasksToday)} />
            <StatCard
              label="Failed calls (24 h)"
              value={String(d.failedCalls24h.count)}
              sub={
                <Link
                  to={`/logs?ok=failed&from=${encodeURIComponent(new Date(d.failedCalls24h.since).toISOString())}`}>
                  View in logs
                </Link>
              }
            />
          </div>
          <section>
            <h2>Status</h2>
            <p className="row" style={{ alignItems: 'center' }}>
              <Pill kind={d.status.openRouterKey ? 'ok' : 'bad'}>
                OpenRouter key{d.status.openRouterKey ? '' : ': not set'}
              </Pill>
              <Pill kind={d.status.spotifyApp ? 'ok' : 'bad'}>
                Spotify app credentials{d.status.spotifyApp ? '' : ': not set'}
              </Pill>
            </p>
            <p>
              Model: <strong>{d.model.name}</strong>{' '}
              <span className="muted mono">{d.model.id}</span>
            </p>
            <p>
              Spotify:{' '}
              <strong>
                {d.spotify.connected} of {d.spotify.cap}
              </strong>{' '}
              connected · {d.spotify.slotsUsed} of {d.spotify.cap} slots used
              {d.spotify.pendingRequests ? (
                <>
                  {' · '}
                  <Link to="/spotify-access">{d.spotify.pendingRequests} pending request(s)</Link>
                </>
              ) : null}
            </p>
            {d.lastChecks ? (
              <p className="muted">
                Last checks {when(d.lastChecks.at)}:{' '}
                {d.lastChecks.results.filter((r) => r.ok).length} of {d.lastChecks.results.length}{' '}
                OK. <Link to="/status">Status</Link>
              </p>
            ) : (
              <p className="muted">
                No checks run yet. <Link to="/status">Run checks</Link>
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}

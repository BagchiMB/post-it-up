import type { AdminIntegrations, BalanceStatus, CheckResult } from '@postitup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api, errorMessage } from '../api/client';
import { qk, useIntegrations, useSettings } from '../api/queries';
import { ErrorBox, Msg, PageHead, SkeletonLines, StatCard } from '../components/ui';
import { usd, when } from '../lib/format';
import { useMsg } from '../lib/hooks';

const CREDITS_URL = 'https://openrouter.ai/settings/credits';

async function runTest(ids: string[], say: ReturnType<typeof useMsg>[1]) {
  say('Testing…');
  try {
    const r = await api.post<CheckResult[]>('/checks/run', { checks: ids });
    const bad = r.filter((x) => !x.ok);
    say(
      bad.length
        ? bad.map((x) => `${x.label}: ${x.error ?? 'Failed'}`).join(' · ')
        : r.map((x) => x.detail ?? 'OK').join(' · '),
      bad.length ? 'bad' : 'good',
    );
  } catch (e) {
    say(errorMessage(e), 'bad');
  }
}

function BalanceCallout({ b, lowBalanceUsd }: { b: BalanceStatus; lowBalanceUsd?: number }) {
  if (b.status === 'empty') {
    return (
      <p className="callout bad" role="alert">
        Balance {usd(b.balanceUsd ?? 0)} — AI features will fail until you add credits.{' '}
        <a href={CREDITS_URL} target="_blank" rel="noopener noreferrer">
          Add credits on OpenRouter ↗
        </a>
        {b.isFreeTier ? ' (free models still work)' : ''}
      </p>
    );
  }
  if (b.status === 'low') {
    return (
      <p className="callout" role="note">
        Balance below {usd(lowBalanceUsd ?? 0)} ({usd(b.balanceUsd)} left).{' '}
        <a href={CREDITS_URL} target="_blank" rel="noopener noreferrer">
          Add credits on OpenRouter ↗
        </a>
      </p>
    );
  }
  return null;
}

function OpenRouterCard({ data }: { data: AdminIntegrations['openrouter'] }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const [key, setKey] = useState('');
  const [msg, say] = useMsg();
  const b: BalanceStatus | undefined = data.balance;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    if (!k) {
      say('Paste a key first.', 'bad');
      return;
    }
    say('Checking with OpenRouter…');
    try {
      const r = await api.put<AdminIntegrations>('/integrations/openrouter', { key: k });
      qc.setQueryData(qk.integrations, r);
      setKey('');
      await Promise.all(
        [qk.settings, qk.session, qk.overview].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      say('Key saved.', 'good');
    } catch (err) {
      say(errorMessage(err), 'bad');
    }
  };

  return (
    <section>
      <h2>OpenRouter</h2>
      {b ? <BalanceCallout b={b} lowBalanceUsd={settings.data?.lowBalanceUsd} /> : null}
      {b ? (
        <div className="cards" style={{ marginBottom: 14 }}>
          <StatCard
            label="Account balance"
            value={typeof b.balanceUsd === 'number' ? usd(b.balanceUsd) : '—'}
            sub={
              b.status === 'unknown'
                ? 'Not known yet (OpenRouter didn’t return account credits)'
                : `Checked ${when(b.checkedAt)}`
            }
          />
          <StatCard
            label="This key’s spending limit"
            value={
              b.keyLimitUsd === undefined
                ? '—'
                : b.keyLimitUsd === null
                  ? 'No limit'
                  : usd(b.keyLimitUsd)
            }
            sub="A cap on this key, not money in the account"
          />
        </div>
      ) : null}
      <label htmlFor="or-key">API key</label>
      <p className="mono">{data.set ? data.hint : 'Not set'}</p>
      <form className="row" onSubmit={save}>
        <div className="grow">
          <input
            id="or-key"
            type="password"
            placeholder="sk-or-…"
            autoComplete="off"
            aria-label="New OpenRouter API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <button type="submit">Replace</button>
        <button
          className="secondary"
          type="button"
          onClick={() => void runTest(['openrouter_key'], say)}>
          Test
        </button>
      </form>
      <Msg msg={msg} />
    </section>
  );
}

function SpotifyCard({ data }: { data: AdminIntegrations['spotify'] }) {
  const qc = useQueryClient();
  const [id, setId] = useState(data.clientId ?? '');
  const [secret, setSecret] = useState('');
  const [msg, say] = useMsg();
  const bundleId = data.appBundleId;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: { clientId?: string; clientSecret?: string } = {};
    if (id.trim()) body.clientId = id.trim();
    if (secret.trim()) body.clientSecret = secret.trim();
    say('Checking with Spotify…');
    try {
      const r = await api.put<AdminIntegrations>('/integrations/spotify', body);
      qc.setQueryData(qk.integrations, r);
      setSecret('');
      await Promise.all(
        [qk.settings, qk.overview].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      say('Saved. Spotify accepted the credentials.', 'good');
    } catch (err) {
      say(errorMessage(err), 'bad');
    }
  };

  return (
    <section>
      <h2>Spotify</h2>
      <form onSubmit={save}>
        <div className="row">
          <div className="grow">
            <label htmlFor="sp-id">Client ID</label>
            <input
              id="sp-id"
              className="mono"
              autoComplete="off"
              spellCheck={false}
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>
        </div>
        <label htmlFor="sp-secret" style={{ marginTop: 12 }}>
          Client secret
        </label>
        <p className="mono">{data.secretSet ? data.secretHint : 'Not set'}</p>
        <div className="row">
          <div className="grow">
            <input
              id="sp-secret"
              type="password"
              placeholder="New client secret (leave empty to keep)"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <button type="submit">Replace</button>
          <button
            className="secondary"
            type="button"
            onClick={() => void runTest(['spotify_app', 'spotify_search'], say)}>
            Test
          </button>
        </div>
      </form>
      <Msg msg={msg} />
      <p className="muted">
        If you ever switch to a different Spotify app, it needs the same redirect address
        (postitup://spotify-callback) and bundle ID ({bundleId ?? 'your app’s bundle ID'}) in
        Spotify&apos;s dashboard, and signed-in users need to reconnect Spotify.
      </p>
    </section>
  );
}

export function IntegrationsPage() {
  const q = useIntegrations();
  return (
    <>
      <PageHead
        title="Integrations"
        description="Credentials for OpenRouter and Spotify, stored encrypted."
      />
      {q.error ? <ErrorBox error={q.error} /> : null}
      {q.data ? (
        <>
          <OpenRouterCard data={q.data.openrouter} />
          <SpotifyCard key={q.data.spotify.clientId ?? ''} data={q.data.spotify} />
        </>
      ) : (
        <>
          <section>
            <SkeletonLines />
          </section>
          <section>
            <SkeletonLines />
          </section>
        </>
      )}
    </>
  );
}

import type { AdminSpotifyAccessItem } from '@postitup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { api, errorMessage } from '../api/client';
import { qk, useIntegrations, useSettings, useSpotifyAccess } from '../api/queries';
import { type Column, DataTable } from '../components/DataTable';
import { ConfirmDialog } from '../components/Overlay';
import { ErrorBox, PageHead, Pill, SkeletonLines } from '../components/ui';
import { when } from '../lib/format';
import { toast } from '../lib/toast';

type Item = AdminSpotifyAccessItem;
const at = (i: Item) => ('at' in i.access ? i.access.at : 0);

function Who({ i }: { i: Item }) {
  return (
    <>
      {i.name ? (
        <>
          {i.name}
          <br />
        </>
      ) : null}
      <span className="muted">{i.email}</span>
    </>
  );
}

function SpotifyEmail({ i }: { i: Item }) {
  const [copied, setCopied] = useState(false);
  const email = 'spotifyEmail' in i.access ? i.access.spotifyEmail : '';
  if (!email) return <>—</>;
  return (
    <>
      <span className="mono">{email}</span>{' '}
      <button
        className="ghost small"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(email);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast('Copy failed; select the email and copy it by hand.', 'bad');
          }
        }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </>
  );
}

type Pending = { kind: 'decline' | 'revoke'; item: Item } | null;

export function SpotifyAccessPage() {
  const qc = useQueryClient();
  const access = useSpotifyAccess();
  const settings = useSettings();
  const integrations = useIntegrations();
  const [dialog, setDialog] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const owner = settings.data?.spotifyOwnerUserId ?? null;
  const clientId = integrations.data?.spotify.clientId;

  const act = async (item: Item, path: 'approve' | 'decline' | 'revoke', body: object = {}) => {
    setBusy(true);
    try {
      await api.post(`/spotify-access/${encodeURIComponent(item.userId)}/${path}`, body);
      await Promise.all(
        [qk.spotifyAccess, qk.users, qk.overview].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      toast(
        path === 'approve'
          ? `Marked ${item.email} as added. They get a push.`
          : path === 'decline'
            ? `Declined ${item.email}.`
            : `Revoked Spotify access for ${item.email}.`,
        'good',
      );
      setDialog(null);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const items = access.data?.items ?? [];
  const isOwner = (i: Item) => owner === i.userId;
  const pending = items.filter(
    (i) => i.access.status === 'requested' && !i.connected && !isOwner(i),
  );
  const approved = items.filter((i) => i.access.status === 'approved' || i.connected || isOwner(i));
  const declined = items.filter((i) => i.access.status === 'declined');

  const pendingCols: Column<Item>[] = [
    { id: 'who', header: 'App user', cell: (i) => <Who i={i} /> },
    { id: 'email', header: 'Spotify email', cell: (i) => <SpotifyEmail i={i} /> },
    {
      id: 'at',
      header: 'Requested',
      cell: (i) => (
        <>
          <Pill kind="pending">Waiting</Pill> <span className="muted">{when(at(i))}</span>
        </>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (i) => (
        <div className="actions">
          <button
            className="small"
            type="button"
            disabled={busy}
            onClick={() => void act(i, 'approve')}>
            Mark as added
          </button>
          <button
            className="ghost small"
            type="button"
            onClick={() => setDialog({ kind: 'decline', item: i })}>
            Decline
          </button>
        </div>
      ),
    },
  ];
  const approvedCols: Column<Item>[] = [
    {
      id: 'who',
      header: 'App user',
      cell: (i) => (
        <>
          <Who i={i} />
          {isOwner(i) ? (
            <>
              {' '}
              <span className="badge">Owner</span>
            </>
          ) : null}
        </>
      ),
    },
    { id: 'email', header: 'Spotify email', cell: (i) => <SpotifyEmail i={i} /> },
    { id: 'since', header: 'Since', cell: (i) => when(at(i)) },
    {
      id: 'connected',
      header: 'Connected',
      cell: (i) =>
        i.connected ? <Pill kind="ok">Connected</Pill> : <Pill kind="pending">Not yet</Pill>,
    },
    {
      id: 'actions',
      header: '',
      cell: (i) => (
        <div className="actions">
          <button
            className="danger small"
            type="button"
            onClick={() => setDialog({ kind: 'revoke', item: i })}>
            Revoke
          </button>
        </div>
      ),
    },
  ];
  const declinedCols: Column<Item>[] = [
    { id: 'who', header: 'App user', cell: (i) => <Who i={i} /> },
    { id: 'when', header: 'When', cell: (i) => when(at(i)) },
    {
      id: 'note',
      header: 'Note',
      wrap: true,
      cell: (i) => (i.access.status === 'declined' ? (i.access.note ?? '—') : '—'),
    },
  ];

  return (
    <>
      <PageHead
        title="Spotify access"
        description="Requests to use Spotify. Add the email in Spotify’s dashboard, then mark it as added."
      />
      {access.error ? <ErrorBox error={access.error} /> : null}
      <p className="callout" role="note">
        This page counts <strong>Post It Up users</strong> (people who signed in to the app) who are
        connected to Spotify, approved or waiting. Spotify&apos;s own allow-list (User Management in
        its developer dashboard) is a separate list that this server can&apos;t read — someone can
        be on Spotify&apos;s list and still not appear here until they sign in to the app and
        connect Spotify.
      </p>
      <p>
        <strong>{access.data ? `${access.data.used} of ${access.data.cap}` : '…'}</strong> slots
        used (connected, approved or waiting).{' '}
        {clientId ? (
          <a
            href={`https://developer.spotify.com/dashboard/${encodeURIComponent(clientId)}/users`}
            target="_blank"
            rel="noopener noreferrer">
            Open User Management in Spotify&apos;s dashboard ↗
          </a>
        ) : integrations.data ? (
          <span className="muted">
            Set the Spotify client ID on <Link to="/integrations">Integrations</Link> to get the
            dashboard link.
          </span>
        ) : null}
      </p>
      <p className="muted">
        To approve: copy the Spotify email, add it in Spotify&apos;s dashboard (User Management),
        then press Mark as added. The user gets a push.
      </p>
      <section>
        <h2>Waiting ({pending.length})</h2>
        {access.data ? (
          <DataTable
            columns={pendingCols}
            data={pending}
            getRowId={(i) => i.userId}
            empty="No requests waiting."
          />
        ) : (
          <SkeletonLines />
        )}
      </section>
      <section>
        <h2>Approved ({approved.length})</h2>
        {access.data ? (
          <DataTable
            columns={approvedCols}
            data={approved}
            getRowId={(i) => i.userId}
            empty="Nobody yet."
          />
        ) : (
          <SkeletonLines />
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Revoking disconnects their Spotify here. Also remove them in Spotify&apos;s dashboard.
        </p>
      </section>
      {declined.length ? (
        <section>
          <h2>Declined ({declined.length})</h2>
          <DataTable columns={declinedCols} data={declined} getRowId={(i) => i.userId} />
        </section>
      ) : null}
      {dialog?.kind === 'decline' ? (
        <ConfirmDialog
          title="Decline request?"
          message={`Decline the Spotify request from ${dialog.item.email}? They get a push and can request again.`}
          confirmLabel="Decline"
          input={{ label: 'Optional note for the user (why it was declined)', maxLength: 300 }}
          busy={busy}
          onConfirm={(note) =>
            void act(dialog.item, 'decline', note.trim() ? { note: note.trim() } : {})
          }
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <ConfirmDialog
          title="Revoke Spotify access?"
          message={`Revoke Spotify access for ${dialog.item.email}? This disconnects their Spotify here; also remove them in Spotify's dashboard.`}
          confirmLabel="Revoke"
          danger
          busy={busy}
          onConfirm={() => void act(dialog.item, 'revoke')}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

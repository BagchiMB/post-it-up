import type { AdminUser } from '@postitup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { api, errorMessage } from '../api/client';
import { qk, useSettings, useUsers } from '../api/queries';
import { type Column, DataTable } from '../components/DataTable';
import { ConfirmDialog } from '../components/Overlay';
import { ErrorBox, PageHead, Pill, SkeletonLines } from '../components/ui';
import { usd, when } from '../lib/format';
import { toast } from '../lib/toast';

export function UsersPage() {
  const qc = useQueryClient();
  const users = useUsers();
  const settings = useSettings();
  const owner = settings.data?.spotifyOwnerUserId ?? null;
  const [disconnect, setDisconnect] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    Promise.all(
      [qk.users, qk.settings, qk.spotifyAccess, qk.overview].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );

  const setOwner = async (id: string | null) => {
    try {
      await api.put('/settings', { spotifyOwnerUserId: id });
      await refresh();
      toast(id ? 'Spotify owner set.' : 'Spotify owner cleared.', 'good');
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const doDisconnect = async () => {
    if (!disconnect) return;
    setBusy(true);
    try {
      await api.post(`/users/${encodeURIComponent(disconnect.id)}/spotify/disconnect`, {});
      await refresh();
      toast(`Disconnected Spotify for ${disconnect.email}.`, 'good');
      setDisconnect(null);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const cols = useMemo<Column<AdminUser>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        cell: (u) => (
          <>
            {u.name ? `${u.name} · ` : ''}
            {u.email}
          </>
        ),
      },
      { id: 'joined', header: 'Joined', cell: (u) => when(u.createdAt).slice(0, 10) },
      {
        id: 'spotify',
        header: 'Spotify',
        cell: (u) =>
          u.spotify ? (
            <span className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
              <Pill kind="ok">Connected</Pill>
              <button className="danger small" type="button" onClick={() => setDisconnect(u)}>
                Disconnect
              </button>
            </span>
          ) : (
            '—'
          ),
      },
      { id: 'today', header: 'Tasks today', num: true, cell: (u) => u.postsToday },
      { id: 'total', header: 'Tasks total', num: true, cell: (u) => u.postsTotal },
      { id: 'posted', header: 'Posted', num: true, cell: (u) => u.posted },
      { id: 'spend', header: 'AI spend', num: true, cell: (u) => usd(u.spendUsd, 4) },
      {
        id: 'owner',
        header: 'Spotify owner',
        cell: (u) =>
          owner === u.id ? (
            <>
              <span className="badge">Owner</span>{' '}
              <button className="ghost small" type="button" onClick={() => void setOwner(null)}>
                Clear
              </button>
            </>
          ) : (
            <button className="ghost small" type="button" onClick={() => void setOwner(u.id)}>
              Make owner
            </button>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers only use stable refs
    [owner],
  );

  const connected = (users.data ?? []).filter((u) => u.spotify).length;
  return (
    <>
      <PageHead
        title="Users"
        description="Everyone who has signed in, with their activity and AI spend."
      />
      {users.error ? <ErrorBox error={users.error} /> : null}
      <section>
        {users.data ? (
          <DataTable
            columns={cols}
            data={users.data}
            getRowId={(u) => u.id}
            empty="No users yet."
            label="Users"
          />
        ) : (
          <SkeletonLines lines={6} />
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Spotify: {connected} of {settings.data?.spotifyUserCap ?? '…'} connected (cap set on{' '}
          <Link to="/limits">Limits</Link>). The Spotify owner is the account that owns the Spotify
          app and can connect without a request.
        </p>
      </section>
      {disconnect ? (
        <ConfirmDialog
          title="Disconnect Spotify?"
          message={`Disconnect Spotify for ${disconnect.email}? They can connect again if a slot is free.`}
          confirmLabel="Disconnect"
          danger
          busy={busy}
          onConfirm={() => void doDisconnect()}
          onCancel={() => setDisconnect(null)}
        />
      ) : null}
    </>
  );
}

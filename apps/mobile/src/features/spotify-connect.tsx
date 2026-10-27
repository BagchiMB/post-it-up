import type { SpotifyAccess, SpotifyProfile } from '@postitup/shared';
import { exchangeCodeAsync, useAuthRequest } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { api, errorMessage } from '@/lib/api';
import {
  SPOTIFY_SCOPES,
  spotifyDiscovery,
  spotifyRedirectUri,
  tokensForServer,
} from '@/lib/spotify';
import {
  loadAppConfig,
  SPOTIFY_FULL,
  useSpotifyClientId,
  useSpotifyConnectAvailable,
} from '@/state/app-config';
import { patchMe, useMe } from '@/state/session';
import { Avatar, Button, Caption, Field, Group, Row, space, useColors } from '@/ui';

WebBrowser.maybeCompleteAuthSession();

/**
 * Settings → Spotify and the onboarding step. Not connected yet: ask for access (the owner adds
 * the Spotify email in Spotify's dashboard), wait for approval, then connect.
 */
export function SpotifyConnect() {
  const { spotify, spotifyAccess } = useMe();
  const available = useSpotifyConnectAvailable();
  const { clientId, loading } = useSpotifyClientId();

  // Connected and approved users (and older servers without access requests) go straight to connecting.
  if (!spotify && spotifyAccess && spotifyAccess.status !== 'approved') {
    if (spotifyAccess.status === 'requested') return <AccessPending access={spotifyAccess} />;
    if (!available) return <Caption muted>{SPOTIFY_FULL}</Caption>;
    return (
      <AccessRequest declined={spotifyAccess.status === 'declined' ? spotifyAccess : undefined} />
    );
  }
  // useAuthRequest reads the client ID when it's created, so start over when it arrives.
  return <SpotifyConnectWith key={clientId} clientId={clientId} loading={loading} />;
}

function AccessRequest({
  declined,
}: {
  declined?: Extract<SpotifyAccess, { status: 'declined' }>;
}) {
  const c = useColors();
  const me = useMe();
  const [email, setEmail] = useState(me.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function request() {
    setBusy(true);
    setError(undefined);
    try {
      const access = await api<SpotifyAccess>('POST', '/me/spotify-access', {
        body: { spotifyEmail: email.trim(), ...(me.name && { name: me.name }) },
      });
      patchMe({ spotifyAccess: access });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void loadAppConfig();
    }
  }

  return (
    <View style={{ gap: space.md }}>
      {declined ? (
        <Caption muted>
          Your last request wasn’t approved{declined.note ? `: ${declined.note}` : '.'}
        </Caption>
      ) : null}
      <Field
        label="Spotify account email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        hint="Spotify only lets in accounts the app owner adds. We’ll notify you when you can connect."
      />
      <Button
        title={declined ? 'Request again' : 'Request Spotify access'}
        onPress={request}
        loading={busy}
        disabled={!email.includes('@')}
      />
      {error ? <Caption style={{ color: c.danger }}>{error}</Caption> : null}
    </View>
  );
}

function AccessPending({ access }: { access: Extract<SpotifyAccess, { status: 'requested' }> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function withdraw() {
    setBusy(true);
    setError(undefined);
    try {
      await api('DELETE', '/me/spotify-access');
      patchMe({ spotifyAccess: { status: 'none' } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void loadAppConfig();
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <Group>
        <Row title="Waiting for approval" detail={access.spotifyEmail} trailing={<View />} />
      </Group>
      <Button title="Withdraw" variant="ghost" onPress={withdraw} loading={busy} />
      {error ? <Caption muted>{error}</Caption> : null}
    </View>
  );
}

function SpotifyConnectWith({ clientId, loading }: { clientId: string; loading: boolean }) {
  const { spotify, spotifyAccess } = useMe();
  // Approved users already hold a slot, so the cap only matters for everyone else.
  const available = useSpotifyConnectAvailable() || spotifyAccess?.status === 'approved';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const [request, , promptAsync] = useAuthRequest(
    { clientId, scopes: SPOTIFY_SCOPES, redirectUri: spotifyRedirectUri, usePKCE: true },
    spotifyDiscovery,
  );

  async function connect() {
    setError(undefined);
    const result = await promptAsync();
    if (result.type === 'error') setError(result.error?.message ?? 'Spotify login failed.');
    if (result.type !== 'success' || !request?.codeVerifier) return;

    setBusy(true);
    try {
      const tokens = await exchangeCodeAsync(
        {
          clientId,
          code: result.params.code,
          redirectUri: spotifyRedirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        spotifyDiscovery,
      );
      // The server keeps the tokens (it reads your taste while making posts) and returns your profile.
      const profile = await api<SpotifyProfile>('PUT', '/me/spotify', {
        body: tokensForServer(tokens),
      });
      patchMe({ spotify: profile });
    } catch (e) {
      // e.g. 409 "Spotify sign-in is full." or 403 "Ask the app owner to add your Spotify email…"
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void loadAppConfig();
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(undefined);
    try {
      await api('DELETE', '/me/spotify');
      patchMe({ spotify: null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      void loadAppConfig();
    }
  }

  if (spotify) {
    return (
      <View style={{ gap: space.md }}>
        <Group>
          <Row
            leading={<Avatar uri={spotify.imageUrl} label={spotify.displayName} />}
            title={spotify.displayName}
            detail="Connected to Spotify"
            trailing={<View />}
          />
        </Group>
        <Button title="Disconnect" variant="ghost" onPress={disconnect} loading={busy} />
        {error ? <Caption muted>{error}</Caption> : null}
      </View>
    );
  }

  if (!clientId && !loading)
    return <Caption muted>Spotify isn’t set up on the server yet.</Caption>;
  if (!available) return <Caption muted>{error ?? SPOTIFY_FULL}</Caption>;

  return (
    <View style={{ gap: space.md }}>
      <Button
        title="Connect Spotify"
        onPress={connect}
        loading={busy}
        disabled={!clientId || !request}
      />
      {Platform.OS === 'web' ? (
        <Caption muted>
          In the web preview this only works from http://127.0.0.1:8081 with that address registered
          in Spotify. On the phone it uses {spotifyRedirectUri}.
        </Caption>
      ) : null}
      {error ? <Caption muted>{error}</Caption> : null}
    </View>
  );
}

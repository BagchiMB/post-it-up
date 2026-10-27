import type { MusicChoice } from '@postitup/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, View } from 'react-native';

import { api, errorMessage } from '@/lib/api';
import { SPOTIFY_FULL, useSpotifyClientId, useSpotifyConnectAvailable } from '@/state/app-config';
import {
  Avatar,
  Body,
  Button,
  Caption,
  Chips,
  Field,
  Group,
  Heading,
  Row,
  Screen,
  space,
  useColors,
} from '@/ui';

const MAX_PLAYLISTS = 5;
const MAX_ARTISTS = 10;
const SEARCH_DELAY = 350;

type Source = MusicChoice['source'];
type Playlist = { id: string; name: string; trackCount?: number };
type Artist = { name: string; id?: string };
type ArtistResult = { id: string; name: string; imageUrl?: string };
type MyPlaylist = { id: string; name: string; trackCount: number; imageUrl?: string };

/** Everything typed for every source, so switching chips doesn't lose input. */
export type MusicDraft = {
  source: Source;
  playlists: Playlist[];
  artists: Artist[];
  artistHint: string;
  genreHint: string;
};

const SOURCES: { key: Source; label: string }[] = [
  { key: 'history', label: 'My listening' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'artists', label: 'Artists' },
  { key: 'ai', label: 'AI pick' },
];

const needsSpotify = (source: Source) => source === 'history' || source === 'playlists';

export function musicDraftFrom(
  last: MusicChoice | undefined,
  spotifyConnected: boolean,
): MusicDraft {
  const draft: MusicDraft = {
    source: 'ai',
    playlists: [],
    artists: [],
    artistHint: '',
    genreHint: '',
  };
  // Your listening and playlists are read with your own Spotify login.
  if (!last || (needsSpotify(last.source) && !spotifyConnected)) return draft;
  if (last.source === 'playlists')
    return { ...draft, source: 'playlists', playlists: last.playlists };
  if (last.source === 'artists') return { ...draft, source: 'artists', artists: last.artists };
  if (last.source === 'ai') {
    return { ...draft, artistHint: last.artistHint ?? '', genreHint: last.genreHint ?? '' };
  }
  return { ...draft, source: last.source };
}

/** The choice to send, or undefined while the chosen source is incomplete. */
export function musicChoice(d: MusicDraft): MusicChoice | undefined {
  switch (d.source) {
    case 'history':
      return { source: 'history' };
    case 'playlists':
      return d.playlists.length
        ? { source: 'playlists', playlists: d.playlists.map(({ id, name }) => ({ id, name })) }
        : undefined;
    case 'artists':
      return d.artists.length ? { source: 'artists', artists: d.artists } : undefined;
    case 'ai':
      return {
        source: 'ai',
        ...(d.artistHint.trim() && { artistHint: d.artistHint.trim() }),
        ...(d.genreHint.trim() && { genreHint: d.genreHint.trim() }),
      };
  }
}

export function MusicPicker({
  value,
  onChange,
  spotifyConnected,
}: {
  value: MusicDraft;
  onChange: (next: MusicDraft) => void;
  spotifyConnected: boolean;
}) {
  const set = (patch: Partial<MusicDraft>) => onChange({ ...value, ...patch });
  const { clientId: spotifyClientId, loading: loadingConfig } = useSpotifyClientId();
  // Spotify's user cap is reached and this user isn't connected: "My listening" can't work.
  const connectAvailable = useSpotifyConnectAvailable();
  const full = !spotifyConnected && !connectAvailable;

  return (
    <View style={{ gap: space.md }}>
      <Chips
        options={spotifyConnected ? SOURCES : SOURCES.filter((s) => !needsSpotify(s.key))}
        isOn={(k) => k === value.source}
        onToggle={(k) => set({ source: k as Source })}
      />
      {!spotifyConnected ? (
        <Caption muted>
          {full
            ? SPOTIFY_FULL
            : spotifyClientId || loadingConfig
              ? 'Connect Spotify in Settings to use your listening and playlists.'
              : 'Spotify isn’t set up on the server yet.'}
        </Caption>
      ) : null}

      {value.source === 'history' ? (
        <Caption muted>Picks from your Spotify top and recently played songs.</Caption>
      ) : value.source === 'playlists' ? (
        <Playlists
          playlists={value.playlists}
          onChange={(playlists) => set({ playlists })}
          spotifyConnected={spotifyConnected}
        />
      ) : value.source === 'artists' ? (
        <Artists artists={value.artists} onChange={(artists) => set({ artists })} />
      ) : (
        <>
          <Field
            placeholder="Artist (optional)"
            value={value.artistHint}
            onChangeText={(artistHint) => set({ artistHint })}
            autoCapitalize="words"
          />
          <Field
            placeholder="Genre (optional)"
            value={value.genreHint}
            onChangeText={(genreHint) => set({ genreHint })}
          />
          <Caption muted>The song will match what’s in your photos.</Caption>
        </>
      )}
    </View>
  );
}

// Playlists

function Playlists({
  playlists,
  onChange,
  spotifyConnected,
}: {
  playlists: Playlist[];
  onChange: (next: Playlist[]) => void;
  spotifyConnected: boolean;
}) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const full = playlists.length >= MAX_PLAYLISTS;

  function add(p: Playlist) {
    if (playlists.some((x) => x.id === p.id) || full) return;
    onChange([...playlists, p]);
  }

  async function addLink() {
    setBusy(true);
    setError(undefined);
    try {
      const p = await api<Playlist>(
        'GET',
        `/spotify/playlist?url=${encodeURIComponent(link.trim())}`,
      );
      add(p);
      setLink('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.md }}>
      {playlists.length ? (
        <Group>
          {playlists.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              detail={p.trackCount != null ? `${p.trackCount} songs` : undefined}
              trailing={<Caption muted>Remove</Caption>}
              onPress={() => onChange(playlists.filter((x) => x.id !== p.id))}
            />
          ))}
        </Group>
      ) : null}
      {full ? (
        <Caption muted>Up to {MAX_PLAYLISTS} playlists.</Caption>
      ) : (
        <>
          <Field
            placeholder="Paste a Spotify playlist link"
            value={link}
            onChangeText={setLink}
            error={error}
            returnKeyType="done"
            onSubmitEditing={() => link.trim() && addLink()}
          />
          <Button
            title="Add playlist"
            variant="secondary"
            onPress={addLink}
            loading={busy}
            disabled={!link.trim()}
          />
          {spotifyConnected ? (
            <Button
              title="Choose from my playlists"
              variant="ghost"
              onPress={() => setChoosing(true)}
            />
          ) : null}
        </>
      )}
      <MyPlaylistsSheet
        visible={choosing}
        selected={playlists.map((p) => p.id)}
        onPick={(p) => add(p)}
        onClose={() => setChoosing(false)}
        full={full}
      />
    </View>
  );
}

function MyPlaylistsSheet({
  visible,
  selected,
  onPick,
  onClose,
  full,
}: {
  visible: boolean;
  selected: string[];
  onPick: (p: Playlist) => void;
  onClose: () => void;
  full: boolean;
}) {
  const c = useColors();
  const [list, setList] = useState<MyPlaylist[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible || list) return;
    api<MyPlaylist[]>('GET', '/spotify/my-playlists').then(setList, (e) =>
      setError(errorMessage(e)),
    );
  }, [visible, list]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Screen footer={<Button title="Done" onPress={onClose} />}>
          <Heading>My playlists</Heading>
          {error ? (
            <Body muted>{error}</Body>
          ) : !list ? (
            <ActivityIndicator />
          ) : list.length === 0 ? (
            <Body muted>No playlists on your Spotify account.</Body>
          ) : (
            <Group>
              {list.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <Row
                    key={p.id}
                    leading={<Avatar uri={p.imageUrl} label={p.name} />}
                    title={p.name}
                    detail={`${p.trackCount} songs`}
                    selected={on}
                    trailing={on ? undefined : <View />}
                    onPress={on || full ? undefined : () => onPick(p)}
                  />
                );
              })}
            </Group>
          )}
        </Screen>
      </View>
    </Modal>
  );
}

// Artists

function Artists({ artists, onChange }: { artists: Artist[]; onChange: (next: Artist[]) => void }) {
  const [query, setQuery] = useState('');
  // Results are tagged with their query so stale ones are never shown.
  const [results, setResults] = useState<{ q: string; items: ArtistResult[]; failed: boolean }>();
  const q = query.trim();
  const full = artists.length >= MAX_ARTISTS;

  useEffect(() => {
    if (!q) return;
    let alive = true;
    const timer = setTimeout(() => {
      api<ArtistResult[]>('GET', `/spotify/artists?q=${encodeURIComponent(q)}`).then(
        (items) => alive && setResults({ q, items: items.slice(0, 10), failed: false }),
        () => alive && setResults({ q, items: [], failed: true }),
      );
    }, SEARCH_DELAY);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  function add(a: Artist) {
    const name = a.name.trim();
    if (!name || full || artists.some((x) => x.name.toLowerCase() === name.toLowerCase())) return;
    onChange([...artists, { ...a, name }]);
    setQuery('');
  }

  const current = results?.q === q ? results : undefined;

  return (
    <View style={{ gap: space.md }}>
      {artists.length ? (
        <Chips
          options={artists.map((a) => ({ key: a.name, label: `${a.name}  ×` }))}
          isOn={() => true}
          onToggle={(k) => onChange(artists.filter((a) => a.name !== k))}
        />
      ) : null}
      {full ? (
        <Caption muted>Up to {MAX_ARTISTS} artists.</Caption>
      ) : (
        <>
          <Field
            placeholder="Search artists"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => current?.failed && add({ name: q })}
          />
          {!q ? null : !current ? (
            <ActivityIndicator />
          ) : (
            <Group>
              {[
                ...current.items.map((a) => (
                  <Row
                    key={a.id}
                    leading={<Avatar uri={a.imageUrl} label={a.name} />}
                    title={a.name}
                    trailing={<View />}
                    onPress={() => add({ name: a.name, id: a.id })}
                  />
                )),
                // Spotify search unavailable or no match: the name alone still guides the AI.
                ...(current.failed || current.items.length === 0
                  ? [
                      <Row
                        key="typed"
                        title={`Add “${q}”`}
                        detail={
                          current.failed
                            ? 'Artist search isn’t available right now'
                            : 'No match on Spotify'
                        }
                        trailing={<View />}
                        onPress={() => add({ name: q })}
                      />,
                    ]
                  : []),
              ]}
            </Group>
          )}
        </>
      )}
    </View>
  );
}

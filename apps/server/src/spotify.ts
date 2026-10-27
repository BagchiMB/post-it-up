import type { SpotifyProfile, SpotifyTokens } from '@postitup/shared';

import { outbound } from './outbound.ts';
import { spotifyClientId, spotifyClientSecret } from './server-settings.ts';
import { getSpotifyTokens, setSpotifyTokens } from './users.ts';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

export type TrackSummary = { id: string; name: string; artist: string; durationMs?: number };

/** A non-2xx answer from Spotify. */
export class SpotifyHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Neither app credentials nor a connected user token are available. */
export class SpotifyUnavailableError extends Error {
  constructor() {
    super(
      'Spotify isn’t available: the server has no Spotify app credentials and your Spotify isn’t connected.',
    );
  }
}

// ---------------------------------------------------------------------------
// User tokens (PKCE login done in the app; refresh needs only the public client ID)

/** Keeps the old refresh token if Spotify doesn't return a new one. */
export async function refreshTokens(t: SpotifyTokens): Promise<SpotifyTokens> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error('The Spotify client ID is not set on the server');
  if (!t.refreshToken) throw new SpotifyHttpError(400, 'No Spotify refresh token');
  const res = await outbound({ integration: 'spotify', operation: 'token_refresh' }, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: t.refreshToken,
      client_id: clientId,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok)
    throw new SpotifyHttpError(res.status, `Spotify token refresh returned ${res.status}`);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || t.refreshToken,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

const isFresh = (t: SpotifyTokens) => Date.now() < t.expiresAt - 60_000;

/** One refresh per user at a time, so two jobs don't race on a rotating refresh token. */
const refreshing = new Map<string, Promise<string>>();

/** A valid access token for this user (refreshed and re-saved if needed); null if not connected. */
async function userToken(userId: string): Promise<string | null> {
  const t = getSpotifyTokens(userId);
  if (!t) return null;
  if (isFresh(t)) return t.accessToken;
  let p = refreshing.get(userId);
  if (!p) {
    p = refreshTokens(t)
      .then((next) => {
        setSpotifyTokens(userId, next);
        return next.accessToken;
      })
      .finally(() => refreshing.delete(userId));
    refreshing.set(userId, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// App token (Client Credentials). The secret is server-only and never logged.

export const appConfigured = () => !!(spotifyClientId() && spotifyClientSecret());

let appCached: { token: string; expiresAt: number } | null = null;
let appInflight: Promise<string> | null = null;

/** Client-credentials token for these credentials (throws SpotifyHttpError if Spotify rejects them). */
export async function requestAppToken(clientId: string, secret: string) {
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await outbound({ integration: 'spotify', operation: 'token' }, TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok)
    throw new SpotifyHttpError(res.status, `Spotify app token request returned ${res.status}`);
  return (await res.json()) as { access_token: string; expires_in?: number };
}

async function fetchAppToken(): Promise<string> {
  const body = await requestAppToken(spotifyClientId() ?? '', spotifyClientSecret() ?? '');
  appCached = {
    token: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  };
  return appCached.token;
}

/** After the admin changes the credentials. */
export function resetAppToken() {
  appCached = null;
}

function appToken(): Promise<string> {
  if (appCached && Date.now() < appCached.expiresAt) return Promise.resolve(appCached.token);
  appInflight ??= fetchAppToken().finally(() => {
    appInflight = null;
  });
  return appInflight;
}

/** For the admin status check: can we get an app token right now? */
export async function checkAppCredentials(): Promise<{ ok: boolean; error?: string }> {
  if (!appConfigured())
    return { ok: false, error: 'The Spotify client ID / secret are not set (Integrations).' };
  try {
    appCached = null;
    await appToken();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof SpotifyHttpError
          ? `Spotify rejected the app credentials (${e.status}).`
          : 'Couldn’t reach Spotify.',
    };
  }
}

// ---------------------------------------------------------------------------
// Requests

/** Short operation names for the integration log. */
function operationFor(pathname: string) {
  const p = pathname.replace(/^\/v1/, '');
  if (p === '/me') return 'me';
  if (p === '/me/top/tracks') return 'top_tracks';
  if (p === '/me/player/recently-played') return 'recently_played';
  if (p === '/me/playlists') return 'my_playlists';
  if (p === '/search') return 'search';
  if (/^\/playlists\/[^/]+\/items$/.test(p)) return 'playlist_items';
  if (/^\/playlists\/[^/]+$/.test(p)) return 'playlist';
  return 'api';
}

async function get<T>(token: string, path: string): Promise<T> {
  const url = path.startsWith('https://') ? path : `${API}${path}`;
  const res = await outbound(
    { integration: 'spotify', operation: operationFor(new URL(url).pathname) },
    url,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new SpotifyHttpError(res.status, `Spotify returned ${res.status}`);
  return res.json() as Promise<T>;
}

/** With the user's own token (history, their playlists). Null when not connected. */
async function userGet<T>(userId: string, path: string): Promise<T> {
  const token = await userToken(userId);
  if (!token) throw new SpotifyUnavailableError();
  return get<T>(token, path);
}

/** Catalog reads: app credentials first, then the user's token if they're connected. */
async function catalogGet<T>(userId: string, path: string): Promise<T> {
  let firstError: unknown;
  if (appConfigured()) {
    try {
      return await get<T>(await appToken(), path);
    } catch (e) {
      if (e instanceof SpotifyHttpError && e.status === 401) appCached = null;
      firstError = e;
    }
  }
  let token: string | null = null;
  try {
    token = await userToken(userId);
  } catch (e) {
    firstError ??= e;
  }
  if (token) return get<T>(token, path);
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- rethrows the first caught error unchanged
  throw firstError ?? new SpotifyUnavailableError();
}

// ---------------------------------------------------------------------------
// Shapes

type Image = { url: string };
type RawArtist = { id: string; name: string; images?: Image[] };
type RawTrack = {
  id: string | null;
  name: string;
  type?: string;
  is_local?: boolean;
  duration_ms?: number;
  artists: { name: string }[];
};
type RawPlaylist = {
  id: string;
  name: string;
  owner?: { display_name?: string | null; id?: string };
  images?: Image[] | null;
  // The Feb 2026 API renamed the playlist's `tracks` field to `items`; read either.
  items?: { total?: number };
  tracks?: { total?: number };
};
type Paging<T> = { items: T[]; total?: number; next?: string | null };

const firstImage = (images?: Image[] | null) => images?.[0]?.url;
/** Track count from playlist metadata, or undefined when the metadata doesn't carry it. */
const metaTrackCount = (p: RawPlaylist): number | undefined => p.items?.total ?? p.tracks?.total;

/** Track count from the items endpoint's `total` (user token), the reliable source. */
async function itemsTotal(userId: string, id: string): Promise<number> {
  const page = await userGet<Paging<unknown>>(userId, `/playlists/${id}/items?limit=1`);
  return page.total ?? page.items.length;
}

/** Thrown when the playlists source is used without the user's own Spotify connection. */
export const PLAYLISTS_NEED_SPOTIFY = 'Connect Spotify to use your playlists.';
const summary = (t: RawTrack): TrackSummary | null =>
  t && t.id && (t.type ?? 'track') === 'track' && !t.is_local
    ? {
        id: t.id,
        name: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        ...(typeof t.duration_ms === 'number' ? { durationMs: t.duration_ms } : {}),
      }
    : null;

// ---------------------------------------------------------------------------
// Profile (PUT /me/spotify)

/** Profile for the tokens the app sent (refreshing first if they're already expired). */
export async function profileFor(
  t: SpotifyTokens,
): Promise<{ tokens: SpotifyTokens; profile: SpotifyProfile }> {
  const tokens = isFresh(t) ? t : await refreshTokens(t);
  const me = await get<{ display_name: string | null; id: string; images?: Image[] }>(
    tokens.accessToken,
    '/me',
  );
  const imageUrl = firstImage(me.images);
  return {
    tokens,
    profile: { displayName: me.display_name ?? me.id, ...(imageUrl ? { imageUrl } : {}) },
  };
}

// ---------------------------------------------------------------------------
// /spotify/* endpoints

/** Spotify dev-mode search returns 5 results per page whatever `limit` says, so page when more are needed. */
const SEARCH_PAGE = 5;

export async function searchArtists(userId: string, q: string) {
  const pages = await Promise.all(
    [0, SEARCH_PAGE].map((offset) =>
      catalogGet<{ artists: Paging<RawArtist> }>(
        userId,
        `/search?type=artist&limit=${SEARCH_PAGE}&offset=${offset}&q=${encodeURIComponent(q)}`,
      ),
    ),
  );
  const seen = new Set<string>();
  const artists = pages
    .flatMap((p) => p.artists.items)
    .filter((a) => a?.id && !seen.has(a.id) && seen.add(a.id));
  return artists.slice(0, 10).map((a) => {
    const imageUrl = firstImage(a.images);
    return { id: a.id, name: a.name, ...(imageUrl ? { imageUrl } : {}) };
  });
}

/** Accepts an open.spotify.com link (with ?si=…), a spotify:playlist: URI or a bare id. */
export function parsePlaylistId(input: string): string | null {
  const s = input.trim();
  const m =
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/]+\/)?playlist\/([A-Za-z0-9]+)/i.exec(s) ??
    /^spotify:(?:user:[^:]+:)?playlist:([A-Za-z0-9]+)$/i.exec(s) ??
    /^([A-Za-z0-9]{10,40})$/.exec(s);
  return m ? m[1] : null;
}

/** Playlist metadata + track count, read with the user's own token (app tokens can't read items). */
export async function getPlaylist(userId: string, id: string) {
  const [p, total] = await Promise.all([
    userGet<RawPlaylist>(userId, `/playlists/${id}`),
    itemsTotal(userId, id),
  ]);
  const imageUrl = firstImage(p.images);
  return {
    id: p.id,
    name: p.name,
    ownerName: p.owner?.display_name ?? p.owner?.id ?? '',
    trackCount: total,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export async function myPlaylists(userId: string) {
  const out: { id: string; name: string; trackCount: number; imageUrl?: string }[] = [];
  let next: string | null | undefined = '/me/playlists?limit=50';
  while (next && out.length < 200) {
    const page: Paging<RawPlaylist | null> = await userGet<Paging<RawPlaylist | null>>(
      userId,
      next,
    );
    for (const p of page.items) {
      if (!p) continue;
      const imageUrl = firstImage(p.images);
      out.push({
        id: p.id,
        name: p.name,
        trackCount: metaTrackCount(p) ?? -1,
        ...(imageUrl ? { imageUrl } : {}),
      });
    }
    next = page.next;
  }
  // Metadata without a count: ask the items endpoint (a few at a time) rather than show 0.
  const missing = out.filter((p) => p.trackCount < 0);
  for (let i = 0; i < missing.length; i += 5) {
    await Promise.all(
      missing.slice(i, i + 5).map(async (p) => {
        p.trackCount = await itemsTotal(userId, p.id).catch(() => 0);
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate tracks for the pipeline

/** Up to `k` items spread evenly across the list, in order. */
export function sampleEvenly<T>(list: T[], k: number): T[] {
  if (list.length <= k) return list;
  return Array.from({ length: k }, (_, i) => list[Math.floor((i * list.length) / k)]);
}

function dedupe(tracks: TrackSummary[]) {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const key = `${t.name.toLowerCase()}|${t.artist.toLowerCase()}`;
    if (seen.has(t.id) || seen.has(key)) return false;
    seen.add(t.id);
    seen.add(key);
    return true;
  });
}

/** Top tracks (medium term) + recently played, deduped. Needs the user's own token. */
export async function historyTracks(userId: string): Promise<TrackSummary[]> {
  const [top, recent] = await Promise.all([
    userGet<Paging<RawTrack>>(userId, '/me/top/tracks?limit=50&time_range=medium_term')
      .then((r) => r.items)
      .catch(() => [] as RawTrack[]),
    userGet<Paging<{ track: RawTrack }>>(userId, '/me/player/recently-played?limit=50')
      .then((r) => r.items.map((i) => i.track))
      .catch(() => [] as RawTrack[]),
  ]);
  return dedupe([...top, ...recent].map(summary).filter((t): t is TrackSummary => !!t));
}

const PAGE = 50;
const MAX_PAGES_PER_PLAYLIST = 8;
export const MAX_CANDIDATES = 200;

type PlaylistItem = { item?: RawTrack | null; track?: RawTrack | null };

/** Tracks of one playlist via /playlists/{id}/items; long playlists are read at evenly spaced pages. */
async function playlistTracks(userId: string, id: string, budget: number): Promise<TrackSummary[]> {
  const url = (offset: number) => `/playlists/${id}/items?limit=${PAGE}&offset=${offset}`;
  // Items need the user's own token: app (client-credentials) tokens get 401 here.
  const first = await userGet<Paging<PlaylistItem>>(userId, url(0));
  const total = first.total ?? first.items.length;
  const pageCount = Math.ceil(total / PAGE);
  const wanted = Math.min(
    pageCount,
    MAX_PAGES_PER_PLAYLIST,
    Math.max(1, Math.ceil(budget / PAGE) + 1),
  );
  const offsets = sampleEvenly(
    Array.from({ length: pageCount }, (_, i) => i * PAGE),
    wanted,
  ).filter((o) => o !== 0);
  const pages = await Promise.all(
    offsets.map((o) => userGet<Paging<PlaylistItem>>(userId, url(o))),
  );
  const raw = [first, ...pages].flatMap((p) => p.items).map((i) => i.item ?? i.track);
  const tracks = raw.map((t) => (t ? summary(t) : null)).filter((t): t is TrackSummary => !!t);
  return sampleEvenly(dedupe(tracks), budget);
}

/** All picked playlists' tracks, at most MAX_CANDIDATES in total, sampled evenly. Unreadable playlists are skipped. */
export async function playlistsTracks(
  userId: string,
  ids: string[],
  onError: (id: string, e: unknown) => void,
): Promise<TrackSummary[]> {
  const budget = Math.ceil(MAX_CANDIDATES / Math.max(1, ids.length));
  const lists = await Promise.all(
    ids.map((id) =>
      playlistTracks(userId, id, budget).catch((e: unknown) => {
        onError(id, e);
        return [] as TrackSummary[];
      }),
    ),
  );
  return sampleEvenly(dedupe(lists.flat()), MAX_CANDIDATES);
}

/**
 * Popular tracks for the picked artists: Spotify's artist top-tracks endpoint is closed to dev-mode
 * apps, but a track search on `artist:"Name"` comes back in popularity order, 5 per page. Pages
 * 0/5/10 per artist; keeps tracks whose primary artist is that artist (by id when known), drops
 * duplicates and alternate versions; ~15 per artist, 60 in total (interleaved so every artist shows).
 */
export async function artistTracks(
  userId: string,
  artists: { name: string; id?: string }[],
): Promise<TrackSummary[]> {
  const PER_ARTIST = 15;
  const TOTAL = 60;
  const perArtist = await Promise.all(
    artists.slice(0, 10).map(async (artist) => {
      const q = encodeURIComponent(`artist:"${artist.name.replace(/"/g, '')}"`);
      const pages = await Promise.all(
        [0, 5, 10].map((offset) =>
          catalogGet<{ tracks: Paging<RawTrack & { artists: { name: string; id?: string }[] }> }>(
            userId,
            `/search?type=track&limit=${SEARCH_PAGE}&offset=${offset}&q=${q}`,
          ).catch(() => null),
        ),
      );
      if (pages.every((p) => p === null))
        throw new Error(`Spotify search failed for ${artist.name}`);
      const want = norm(artist.name);
      const seenIds = new Set<string>();
      const seenTitles = new Set<string>();
      const out: TrackSummary[] = [];
      for (const t of pages.flatMap((p) => p?.tracks.items ?? [])) {
        const primary = t?.artists?.[0];
        if (!t?.id || !primary) continue;
        const isArtist =
          artist.id && primary.id ? primary.id === artist.id : norm(primary.name) === want;
        if (!isArtist) continue;
        // "Song (Live)", "Song - Remastered" are already reduced by norm(); also drop trailing version words.
        const base = norm(t.name);
        const title =
          base.replace(/\s+(live|remix|remaster(ed)?|acoustic|version|edit|mix)\b.*$/, '').trim() ||
          base;
        if (seenIds.has(t.id) || seenTitles.has(title)) continue;
        seenIds.add(t.id);
        seenTitles.add(title);
        const s = summary(t);
        if (s) out.push(s);
        if (out.length >= PER_ARTIST) break;
      }
      return out;
    }),
  );
  const merged: TrackSummary[] = [];
  for (let i = 0; merged.length < TOTAL && perArtist.some((l) => i < l.length); i++) {
    for (const list of perArtist)
      if (i < list.length && merged.length < TOTAL) merged.push(list[i]);
  }
  return dedupe(merged);
}

// ---------------------------------------------------------------------------
// Matching a suggested song

/** Lowercase, drop accents, "(feat. …)" / " - Remastered" suffixes and punctuation. */
const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function matchScore(t: RawTrack, title: string, artist: string) {
  const tt = norm(t.name);
  const want = norm(artist);
  const artists = t.artists.map((a) => norm(a.name));
  let s = 0;
  if (tt === title) s += 4;
  else if (tt && title && (tt.startsWith(title) || title.startsWith(tt))) s += 2;
  if (want && artists.some((a) => a && (a === want || want.includes(a) || a.includes(want))))
    s += 3;
  return s;
}

/** Best catalog match for a suggested title + artist (exact-ish title and artist preferred), or null. */
export async function findTrack(
  userId: string,
  title: string,
  artist: string,
): Promise<TrackSummary | null> {
  if (!title.trim()) return null;
  const q = encodeURIComponent(
    artist.trim() ? `track:${title} artist:${artist}` : `track:${title}`,
  );
  const res = await catalogGet<{ tracks: Paging<RawTrack> }>(
    userId,
    `/search?type=track&limit=5&q=${q}`,
  );
  const items = res.tracks.items.filter((t) => t?.id);
  const wantTitle = norm(title);
  let best: RawTrack | undefined;
  let bestScore = 0;
  for (const t of items) {
    const s = matchScore(t, wantTitle, artist);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  // Need at least the exact title (4), or a close title by the right artist (5); otherwise keep the
  // model's suggestion rather than attach a different song's Spotify id.
  return best && bestScore >= 4 ? summary(best) : null;
}

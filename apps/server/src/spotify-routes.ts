import { type Context, Hono } from 'hono';

import type { AuthEnv } from './auth.ts';
import { ApiError } from './http.ts';
import {
  getPlaylist,
  myPlaylists,
  parsePlaylistId,
  PLAYLISTS_NEED_SPOTIFY,
  searchArtists,
  SpotifyHttpError,
  SpotifyUnavailableError,
} from './spotify.ts';
import { getSpotifyTokens } from './users.ts';

/** Maps Spotify failures to API errors; anything not handled by `special` becomes 502/503. */
function spotifyError(e: unknown, special?: (status: number) => ApiError | null): never {
  if (e instanceof ApiError) throw e;
  if (e instanceof SpotifyUnavailableError) throw new ApiError(503, e.message);
  if (e instanceof SpotifyHttpError) {
    const mapped = special?.(e.status);
    if (mapped) throw mapped;
    if (e.status === 429)
      throw new ApiError(503, 'Spotify is busy right now. Try again in a minute.');
  }
  throw new ApiError(502, 'Couldn’t reach Spotify. Try again.');
}

const query = (c: Context, name: string, max: number) => {
  const v = (c.req.query(name) ?? '').trim();
  if (!v) throw new ApiError(400, `${name} is required.`);
  if (v.length > max) throw new ApiError(400, `${name} is too long.`);
  return v;
};

export const spotifyRoutes = new Hono<AuthEnv>();

spotifyRoutes.get('/artists', async (c) => {
  const q = query(c, 'q', 100);
  try {
    return c.json(await searchArtists(c.get('userId'), q));
  } catch (e) {
    spotifyError(e);
  }
});

spotifyRoutes.get('/playlist', async (c) => {
  if (!getSpotifyTokens(c.get('userId'))) throw new ApiError(409, PLAYLISTS_NEED_SPOTIFY);
  const id = parsePlaylistId(query(c, 'url', 500));
  if (!id) throw new ApiError(400, 'That doesn’t look like a Spotify playlist link.');
  try {
    return c.json(await getPlaylist(c.get('userId'), id));
  } catch (e) {
    spotifyError(e, (status) =>
      status === 403 || status === 404 || status === 400
        ? new ApiError(
            422,
            'Spotify won’t let us read that playlist. It may be private, deleted, or made by Spotify (those can’t be read by apps). Try another one.',
          )
        : null,
    );
  }
});

spotifyRoutes.get('/my-playlists', async (c) => {
  const userId = c.get('userId');
  if (!getSpotifyTokens(userId)) throw new ApiError(409, PLAYLISTS_NEED_SPOTIFY);
  try {
    return c.json(await myPlaylists(userId));
  } catch (e) {
    spotifyError(e, (status) =>
      status === 400 || status === 401 || status === 403
        ? new ApiError(409, 'Reconnect Spotify to let Post It Up read your playlists.')
        : null,
    );
  }
});

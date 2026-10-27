import { Hono } from 'hono';

import type { AuthEnv } from './auth.ts';
import { ApiError, readJson } from './http.ts';
import { log } from './log.ts';
import { serverSettings } from './server-settings.ts';
import { profileFor, SpotifyHttpError } from './spotify.ts';
import {
  clearSpotify,
  getMe,
  getSpotifyAccess,
  getSpotifyTokens,
  parseSettings,
  setSettings,
  setSpotify,
  setSpotifyAccess,
  spotifySlotsUsed,
} from './users.ts';

export const meRoutes = new Hono<AuthEnv>();

meRoutes.get('/', (c) => c.json(getMe(c.get('userId'))));

meRoutes.put('/settings', async (c) => {
  const settings = parseSettings(await readJson(c));
  setSettings(c.get('userId'), settings);
  return c.json(settings);
});

meRoutes.put('/spotify', async (c) => {
  const { accessToken, refreshToken, expiresAt } = await readJson(c);
  if (typeof accessToken !== 'string' || !accessToken || typeof expiresAt !== 'number') {
    throw new ApiError(400, 'accessToken and expiresAt are required.');
  }
  const userId = c.get('userId');
  const connected = !!getSpotifyTokens(userId);
  const approved = getSpotifyAccess(userId).status === 'approved';
  const isOwner = serverSettings().spotifyOwnerUserId === userId;
  if (!connected && !approved && !isOwner) throw new ApiError(409, 'Request Spotify access first.');
  // Approved users already hold a slot; the owner takes one when first connecting.
  if (!connected && !approved && spotifySlotsUsed() >= serverSettings().spotifyUserCap) {
    throw new ApiError(409, 'Spotify sign-in is full.');
  }
  const tokens = {
    accessToken,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
    expiresAt,
  };
  let result;
  try {
    result = await profileFor(tokens);
  } catch (e) {
    // 403 from /v1/me: this Spotify account isn't on the app's dashboard allowlist. Store nothing.
    if (e instanceof SpotifyHttpError && e.status === 403) {
      throw new ApiError(
        403,
        'Ask the app owner to add your Spotify email in the Spotify dashboard.',
      );
    }
    if (e instanceof SpotifyHttpError && e.status >= 400 && e.status < 500)
      throw new ApiError(400, 'Spotify didn’t accept that login. Connect again.');
    throw new ApiError(502, 'Couldn’t reach Spotify. Try again.');
  }
  setSpotify(c.get('userId'), result.tokens, result.profile);
  log(`user ${c.get('userId')} connected Spotify`);
  return c.json(result.profile);
});

meRoutes.delete('/spotify', (c) => {
  clearSpotify(c.get('userId'));
  return c.body(null, 204);
});

// Spotify access requests (the owner adds approved emails in Spotify's dashboard by hand).

meRoutes.post('/spotify-access', async (c) => {
  const userId = c.get('userId');
  const { spotifyEmail, name } = await readJson(c);
  const email = typeof spotifyEmail === 'string' ? spotifyEmail.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError(400, 'Enter the email address of your Spotify account.');
  }
  if (name !== undefined && name !== null && (typeof name !== 'string' || name.length > 100)) {
    throw new ApiError(400, 'name must be text (100 characters max).');
  }
  const current = getSpotifyAccess(userId);
  if (getSpotifyTokens(userId)) throw new ApiError(409, 'Spotify is already connected.');
  if (current.status === 'requested')
    throw new ApiError(409, 'You already asked for Spotify access.');
  if (current.status === 'approved')
    throw new ApiError(409, 'Your Spotify access is already approved.');
  if (spotifySlotsUsed() >= serverSettings().spotifyUserCap)
    throw new ApiError(409, 'Spotify sign-in is full.');
  setSpotifyAccess(userId, {
    status: 'requested',
    spotifyEmail: email,
    at: Date.now(),
    ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
  });
  log(`user ${userId} requested Spotify access`);
  return c.json(getMe(userId).spotifyAccess);
});

meRoutes.delete('/spotify-access', (c) => {
  const userId = c.get('userId');
  if (getSpotifyAccess(userId).status !== 'requested')
    throw new ApiError(409, 'There is no pending request to withdraw.');
  setSpotifyAccess(userId, { status: 'none' });
  return c.body(null, 204);
});

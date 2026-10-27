import { makeRedirectUri, type TokenResponse } from 'expo-auth-session';

// The client ID (not a secret: PKCE needs no secret) comes from the server: see state/app-config.

export const SPOTIFY_SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'playlist-read-private',
];

export const spotifyDiscovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

/** Must match a Redirect URI registered in the Spotify developer dashboard. */
export const spotifyRedirectUri = makeRedirectUri({ scheme: 'postitup', path: 'spotify-callback' });

/** The shape `PUT /me/spotify` takes; the server keeps (and refreshes) the tokens from here on. */
export function tokensForServer(t: TokenResponse) {
  return {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken ?? '',
    expiresAt: (t.issuedAt + (t.expiresIn ?? 3600)) * 1000,
  };
}

export const trackUrl = (id: string) => `https://open.spotify.com/track/${id}`;

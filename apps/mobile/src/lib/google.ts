/** iOS OAuth client ID from Google Cloud (not a secret: PKCE needs no client secret). */
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

/**
 * Google sends iOS clients back to the client ID reversed, e.g.
 * `com.googleusercontent.apps.123-abc:/oauthredirect`. app.config.ts registers that scheme.
 */
const reversed = `com.googleusercontent.apps.${GOOGLE_IOS_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, '')}`;
export const googleRedirectUri = `${reversed}:/oauthredirect`;

export const GOOGLE_SCOPES = ['openid', 'email', 'profile'];

export const googleDiscovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

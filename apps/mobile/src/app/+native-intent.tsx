/**
 * Links that are answers to sign-in flows, not screens: the Spotify app returns playback
 * authorization to postitup://spotify-callback (handled natively by modules/spotify-remote),
 * and Google returns to …:/oauthredirect. Returning null keeps the current screen.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    // Cold start from such a link (rare): just open the app.
    if (/spotify-callback|oauthredirect/.test(path)) return initial ? '/' : null;
  } catch {
    // Never let a malformed link crash the app.
  }
  return path;
}

import type { ConfigContext, ExpoConfig } from 'expo/config';

const FALLBACK_BUNDLE_ID = 'com.example.postitup';

// Extends app.json:
// - the iOS bundle ID / Android package come from APP_BUNDLE_ID (.env.local), so no personal
//   identifier is committed;
// - registers the reversed Google iOS client ID as a URL scheme so Google sign-in can return to
//   the app (see src/lib/google.ts);
// - lets the app ask whether Spotify is installed.
export default ({ config }: ConfigContext): ExpoConfig => {
  const bundleId = process.env.APP_BUNDLE_ID?.trim() || FALLBACK_BUNDLE_ID;
  if (!process.env.APP_BUNDLE_ID?.trim()) {
    console.warn(`APP_BUNDLE_ID is not set (apps/mobile/.env.local); using ${FALLBACK_BUNDLE_ID}.`);
  }
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const google = clientId
    ? `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`
    : undefined;
  return {
    ...config,
    name: config.name ?? 'Post It Up',
    slug: config.slug ?? 'post-it-up',
    scheme: google ? ['postitup', google] : 'postitup',
    ios: {
      ...config.ios,
      bundleIdentifier: bundleId,
      infoPlist: {
        ...config.ios?.infoPlist,
        // Lets the Spotify SDK check the Spotify app is installed (modules/spotify-remote).
        LSApplicationQueriesSchemes: ['spotify'],
      },
    },
    android: {
      ...config.android,
      package: bundleId,
    },
  };
};

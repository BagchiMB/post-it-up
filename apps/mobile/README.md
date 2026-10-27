# Post It Up — app

Picks your best photo of the day, writes a caption and suggests a song from your Spotify taste, then hands the post to Instagram for you to publish.

Expo SDK 58 · React Native · TypeScript. Runs on your own iPhone with a free Apple ID. This is the
`apps/mobile` workspace of the monorepo — install and run from the repo root (see the root README).

## Setup

1. `npm install` at the repo root.
2. `cp apps/mobile/.env.example apps/mobile/.env.local` and fill it in (each variable is explained
   in the file). `APP_BUNDLE_ID` sets the iOS bundle ID / Android package; `app.config.ts` falls back
   to `com.example.postitup` with a warning.
3. **Spotify** — at developer.spotify.com/dashboard create an app, select _iOS_ and _Web API_, add the
   redirect URI `postitup://spotify-callback` and your bundle ID. The client ID normally comes from
   the server (`GET /config`); `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` is only a fallback.
4. `sh apps/mobile/modules/spotify-remote/scripts/fetch-sdk.sh` downloads the Spotify iOS SDK used by
   the local `spotify-remote` module (git-ignored).

## Run

```bash
npm run dev:mobile                # Metro; same as `npx expo start` in apps/mobile
npm run ios                       # build + run in the iOS Simulator (needs Xcode)
cd apps/mobile && npx expo run:ios --device --configuration Release   # your iPhone, works without the Mac
```

With a free Apple ID the app stops opening after 7 days; rerun the last command to renew it.

## Layout

```
src/app/         screens (Expo Router): onboarding/, settings/, account/[id], draft/[id], index (Today)
src/features/    pieces shared by screens (music picker, Spotify, accounts, reminder, post card)
src/curation/    photo picking, thumbnails, upload, daily background task
src/lib/         API client, Spotify, photos, notifications, storage (*.web.ts = browser stand-ins)
src/state/       stores: session, settings, jobs, server status, app config
src/ui/          theme and minimal UI components
modules/         local Expo module (spotify-remote, iOS only)
```

API types (`Me`, `UserSettings`, `Job`, …) come from `@postitup/shared` (`packages/shared`).

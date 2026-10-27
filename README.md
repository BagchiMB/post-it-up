# Post It Up

Picks your best photos of the day, writes captions and suggests songs, then hands the posts to
Instagram for you to publish. An Expo (React Native) iPhone app plus a small Node server that runs
the slow AI work.

## Layout

npm-workspaces monorepo:

```
apps/mobile/       Expo SDK 58 app (Expo Router, TypeScript) + local module modules/spotify-remote
apps/server/       Node + Hono + node:sqlite API server and admin site (tests in test/)
packages/shared/   @postitup/shared — API types and constants used by both apps (TS source, no build)
packages/config/   @postitup/config — shared ESLint base, Prettier config, tsconfig bases
docs/              api-contract.md: the app ⇄ server API (types mirror packages/shared)
```

See [apps/mobile/README.md](apps/mobile/README.md) and [apps/server/README.md](apps/server/README.md)
for app- and server-specific details.

## Requirements

- **Node 24** (pinned in `.nvmrc` — run `nvm use` in the repo root; `nvm install` if you don't have it) and
  npm 10+ (one root `package-lock.json`). The server uses Node's built-in `node:sqlite`.
- Xcode for iOS builds.

## Setup

1. Install everything from the root (this also installs the git hooks):

   ```sh
   npm install
   ```

2. Copy both env templates — the copies are git-ignored; never commit real values:

   ```sh
   cp apps/mobile/.env.example apps/mobile/.env.local
   cp apps/server/.env.example apps/server/.env
   ```

   Where the values come from (each variable has a one-line comment in its template):

   | Variable                                               | Where to get it                                                                                                                                  |
   | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `APP_BUNDLE_ID` (both files)                           | Your own reverse-DNS ID, e.g. `com.yourname.postitup`. Sets the iOS bundle ID / Android package.                                                 |
   | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`                     | Google Cloud → Google Auth Platform → Clients → create an **iOS** client with your bundle ID.                                                    |
   | `GOOGLE_CLIENT_IDS` (server)                           | The same iOS client ID (comma-separate several).                                                                                                 |
   | `EXPO_PUBLIC_API_URL`                                  | `http://localhost:8787` for the Simulator; your Mac's LAN IP for a physical phone.                                                               |
   | `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`                        | Optional fallback; the app normally gets the client ID from the server's `GET /config`.                                                          |
   | `OPENROUTER_API_KEY`                                   | openrouter.ai/keys. Seeded into the DB on first boot, then managed at `/admin/integrations`.                                                     |
   | `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`          | developer.spotify.com/dashboard → your app (redirect URI `postitup://spotify-callback`, iOS bundle ID). Seeded once, then `/admin/integrations`. |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD`                    | Choose them (12+ character password). Seeded once, then `/admin/account`.                                                                        |
   | `MASTER_KEY`                                           | Leave empty to auto-generate `apps/server/data/master.key`, or set 64 hex chars from a secrets store.                                            |
   | `PORT`, `HOST`, `DATA_DIR`, `DEV_LOGIN`, `NTFY_URL`, … | Defaults are fine locally; see [apps/server/README.md](apps/server/README.md#environment).                                                       |

3. Download the Spotify iOS SDK for the local native module (git-ignored):

   ```sh
   sh apps/mobile/modules/spotify-remote/scripts/fetch-sdk.sh
   ```

## Scripts (run from the root)

| Script                                    | What it does                                               |
| ----------------------------------------- | ---------------------------------------------------------- |
| `npm run dev:server`                      | Server with watch mode (`apps/server`, port 8787)          |
| `npm run dev:mobile`                      | Metro / Expo dev server (`apps/mobile`)                    |
| `npm run ios`                             | `expo run:ios` in `apps/mobile` (native build + Simulator) |
| `npm run typecheck`                       | `tsc --noEmit` in every workspace                          |
| `npm run lint` / `npm run lint:fix`       | ESLint in every workspace                                  |
| `npm run format` / `npm run format:check` | Prettier over the whole repo                               |
| `npm test`                                | Server tests (`node:test`)                                 |
| `npm run check`                           | typecheck + lint + format:check + test                     |

Run a script in one workspace with `-w`, e.g. `npm run lint -w apps/server`. Add dependencies to
the app with `npx expo install <pkg>` from `apps/mobile`, and to the server with
`npm install <pkg> -w apps/server`.

## Tooling

- **ESLint 9 flat configs.** `packages/config/eslint/base.js` exports `withBase(...)`: shared
  ignores, `simple-import-sort`, a few core rules, and `eslint-config-prettier` last. The app adds
  `eslint-config-expo`; the server adds typescript-eslint `recommendedTypeChecked` with
  `no-console` (use `src/log.ts`) and `no-floating-promises`.
- **Prettier 3** (`packages/config/prettier`): single quotes, semicolons, trailing commas, width 100,
  JSX `bracketSameLine`. `.editorconfig` matches.
- **Pre-commit hook** (husky + lint-staged): staged files get `eslint --fix` and `prettier --write`,
  using the closest `.lintstagedrc.json` (one per workspace, plus the root for everything else).
- **Metro** needs no monorepo config: Expo SDK 52+ configures workspaces automatically, and
  autolinking finds `apps/mobile/modules/*` and the hoisted root `node_modules`.

# Post It Up server

Small Node service that runs the slow AI work (shortlist → final pick + caption → song) for the
Post It Up app, so it keeps going when the phone is locked. Multi-user: each user signs in with
Google; the server's single OpenRouter key pays for the AI, and each user can optionally connect
their own Spotify. Each post picks its music source: Spotify history, playlists, artists, or free AI choice.

The API is specified in [`docs/api-contract.md`](../../docs/api-contract.md); its types live in
[`@postitup/shared`](../../packages/shared) and are imported by both the server and the app.

Stack: Hono on `@hono/node-server`, Node's built-in `node:sqlite`, `node:crypto`. No ORM, no other runtime deps.

## Run locally

This is the `apps/server` workspace of the monorepo; install from the repo root.

```sh
npm install                                    # at the repo root (installs every workspace)
cp apps/server/.env.example apps/server/.env   # then fill in OPENROUTER_API_KEY, GOOGLE_CLIENT_IDS, Spotify credentials
npm run dev:server     # = npm run dev -w apps/server; restarts on file changes (`npm start -w apps/server` doesn't watch)
npm run typecheck -w apps/server
npm run lint -w apps/server
npm test               # = npm test -w apps/server (throwaway data dir, no network)
```

Check it: `curl http://localhost:8787/health`.

Needs Node 24 (see the root `.nvmrc`); `node:sqlite` is built in, no flags needed.

## Environment

| Variable                                      | Default              | Meaning                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                        | `8787`               | Port to listen on.                                                                                                                                                                                                                                                                                                                                      |
| `HOST`                                        | `0.0.0.0`            | Interface; `0.0.0.0` lets phones on your Wi-Fi connect.                                                                                                                                                                                                                                                                                                 |
| `DATA_DIR`                                    | `./data`             | SQLite DB (`app.db`), `master.key`, job thumbnails (`jobs/<id>/<n>.jpg`). Relative to `apps/server/`.                                                                                                                                                                                                                                                   |
| `MASTER_KEY`                                  | —                    | 32-byte key (64 hex chars or base64) for AES-256-GCM encryption of users' Spotify tokens and the stored OpenRouter key. If unset, `DATA_DIR/master.key` is generated (mode 0600) on first boot.                                                                                                                                                         |
| `GOOGLE_CLIENT_IDS`                           | —                    | Comma-separated Google OAuth client IDs whose ID tokens are accepted (the app's iOS client ID). Empty = Google sign-in always fails.                                                                                                                                                                                                                    |
| `DEV_LOGIN`                                   | off                  | `1` enables `POST /auth/dev` (sign in with just an email) for local testing. Prints a warning at boot. **Never enable it on EC2 or any reachable server.**                                                                                                                                                                                              |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD`           | —                    | **Seed only.** Create the admin account (scrypt hash in the DB) on first boot; afterwards change the password at `/admin/account` and env changes are ignored. If no account exists, admin sign-in is disabled. Warning at boot while the password is under 12 characters. Never logged.                                                                |
| `ADMIN_RESET`                                 | off                  | `1` for ONE boot re-seeds the admin account from `ADMIN_USERNAME`/`ADMIN_PASSWORD` (e.g. forgotten password; logged loudly). Remove it afterwards.                                                                                                                                                                                                      |
| `OPENROUTER_API_KEY`                          | —                    | **Seed only.** Stored (encrypted) at boot if no key is stored yet; afterwards replace it at `/admin/integrations`. One key for every user (you pay); never logged or sent to the app. Without a key, jobs fail with a clear error.                                                                                                                      |
| `OPENROUTER_DEFAULT_MODEL`                    | `openai/gpt-6-astra` | **Seed only** for the model setting (change it at `/admin`). Users never choose a model.                                                                                                                                                                                                                                                                |
| `DAILY_JOB_LIMIT`                             | `20`                 | **Seed only** for the per-user daily limit (`POST /jobs` + retries, UTC day; `429` beyond).                                                                                                                                                                                                                                                             |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | —                    | **Seed only** (each stored at boot if not stored yet; the secret encrypted). Afterwards manage them at `/admin/integrations`. The app gets the client ID from `GET /config`. The secret is server-only and never logged. Without them, catalog calls fall back to the user's own Spotify token, and jobs still finish with the model's song suggestion. |
| `NTFY_URL`                                    | `https://ntfy.sh`    | ntfy server for "post ready" pushes.                                                                                                                                                                                                                                                                                                                    |
| `APP_BUNDLE_ID`                               | —                    | The app's iOS bundle ID; only shown in the admin Integrations note (kept out of the repo).                                                                                                                                                                                                                                                              |
| `TRUST_PROXY`                                 | off                  | `1` behind Caddy/nginx so the client IP for rate limiting comes from `X-Forwarded-For`.                                                                                                                                                                                                                                                                 |

An `apps/server/.env` file is loaded automatically if present.

## Admin site

The admin UI is a React app in `apps/admin`; this server provides its JSON API (`/admin/api/*`,
documented in `docs/api-contract.md` → "Admin API (complete)") and serves the built app.

- **Production / normal use:** `npm run build:admin` (from the repo root) builds `apps/admin/dist`;
  the server then serves it at `http://localhost:8787/admin` (or `https://<your-domain>/admin` on
  EC2). Hashed assets are cached for a year, `index.html` never; every non-API `/admin/*` path gets
  the app (client-side routing). Without a build, `/admin/*` answers `503 Admin UI not built — run
npm run build:admin` (the API still works). `ADMIN_DIST` points elsewhere if needed.
- **Developing the admin:** `npm run dev:admin` runs Vite with live reload on
  `http://localhost:5173/admin/`, proxying `/admin/api`, `/admin/login` and `/admin/logout` to this
  server (keep `npm run dev:server` running).
- **Sign-in:** the admin account is seeded from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (see
  Environment); sign-in is rate-limited per IP. The session cookie is
  `HttpOnly; SameSite=Strict; Path=/admin` (12 h; `Secure` over HTTPS); API writes require JSON.
- Settings, prompts and credentials live in the DB, so changes apply immediately.

## Reaching it from a physical iPhone

The Simulator and web preview use `http://localhost:8787`. A real phone must use your Mac's LAN IP:

1. Phone and Mac on the same Wi-Fi.
2. Find the Mac's IP: `ipconfig getifaddr en0` (e.g. `192.168.1.23`).
3. Start the app with `EXPO_PUBLIC_API_URL=http://192.168.1.23:8787`.
4. If it can't connect, allow incoming connections for `node` in macOS Firewall settings.
   iOS blocks plain `http://` to non-local hosts in production builds (ATS); dev builds allow LAN
   addresses, and the EC2 setup below uses HTTPS anyway.

## Behaviour notes

- Jobs run in-process, two at a time. `queued`/`running` jobs are re-queued on boot, so a restart
  mid-job just runs it again.
- Thumbnails are deleted on `DELETE /jobs/:id`, or by an hourly sweep 7 days after a job finished
  (retry then answers `410`).
- A task makes 1–5 posts (people / scenery / mix) in one final AI call; photos are never reused
  across posts, and a post without enough suitable photos is skipped (`result.skipped`). Each post
  gets its own caption, song and clip. "Change the music" (`POST /jobs/:id/posts/:i/music`) runs in
  the background and never repeats an earlier song.
- One automatic daily task per user per day (`request.auto`); a second one gets `409`.
- ntfy pushes are generic ("Your 3 posts for Oct 21 – Oct 27 are ready"), never the caption; a
  failing ntfy never fails a job.
- Music per post (`request.music.source`): `history` (user's top + recently played tracks),
  `playlists` (tracks via `/v1/playlists/{id}/items`, max 200, sampled evenly), `artists` (model names
  a song by one of them) or `ai` (free choice with optional hints). Suggestions are matched in
  Spotify's catalog for a `spotifyId`. Catalog reads use the app token first, then the user's.
  The song never fails a job.
- Song clip: timed lyrics from LRCLIB (lrclib.net) → a small model call picks the start line and a
  length from the allowed clip lengths (snapped and clamped to the song); without lyrics the model
  estimates the hook (`estimated: true`). Omitted on any failure.
- Every outgoing HTTP call is recorded in `integration_calls` (host + path only — no query strings,
  bodies, keys, tokens, images or prompts; errors redacted), kept for `logRetentionDays`.
- Logs: one line per request (method, path, status, time) and per job state change. Tokens, keys
  and images are never logged.
- `/auth/*` is limited to 20 requests per minute per IP (`429` beyond that).

## Database & migrations

### Where the data lives

All app data lives **only on the machine that runs this server**, in one folder: `DATA_DIR`
(set in `apps/server/.env`; a relative path is resolved from `apps/server/`, so the default `./data`
is `<repo>/apps/server/data/` — on EC2 e.g. `/opt/postitup/apps/server/data/`).
It is git-ignored, so **GitHub never has a copy**, and the iPhone app only keeps small caches of
what the server sends it (plus the sign-in token), which it refetches.

The database is SQLite — a single file inside that folder, opened by the server process (there is
no separate database service):

| File                       | What it is                                                                    |
| -------------------------- | ----------------------------------------------------------------------------- |
| `app.db`                   | The database: users, sessions, tasks/posts, settings, prompts, usage, logs    |
| `app.db-wal`, `app.db-shm` | SQLite's write-ahead log and its index (folded into `app.db` automatically)   |
| `master.key`               | Encrypts the secrets stored in the DB (OpenRouter key, Spotify secret/tokens) |
| `backups/`                 | Automatic pre-migration backups and `db:backup` copies                        |
| `jobs/`                    | Uploaded photo thumbnails, deleted once a task is posted or after 7 days      |

- **Stopping, restarting or crashing the server doesn't lose data.** Every change is written to
  disk as it happens; on the next start the server opens the same file. After a crash or power cut
  SQLite completes or discards the in-flight change, so the file stays consistent.
- **What does lose data:** deleting `DATA_DIR`, losing the disk, or losing `master.key` (the rest
  survives, but stored secrets can't be decrypted — re-enter them on the admin Integrations page).

### Moving the data (new machine, EC2, or a new folder)

`app.db` and `master.key` **always travel together**; `backups/` is worth bringing too. `jobs/` is
optional (only in-progress uploads; tasks that need them can be re-run).

1. **Stop the server** on the old machine (so nothing is mid-write), then copy the whole `DATA_DIR`:

   ```sh
   # from the old machine — e.g. to an EC2 instance
   rsync -a --chmod=D700,F600 "apps/server/data/" ubuntu@<ec2-host>:/opt/postitup/apps/server/data/
   ```

   Copy `apps/server/.env` the same way (it isn't in git either), then adjust it for the new machine
   (`HOST`, `TRUST_PROXY`, no `DEV_LOGIN`, a strong admin password).

2. **Can't stop the server?** Take a consistent snapshot instead and move that as `app.db`:
   `npm run db:backup -w apps/server`, then copy the newest `backups/app-…-manual.db` to the new
   machine's `DATA_DIR/app.db`, plus `master.key`. Changes made after the snapshot aren't included.

3. **Start the server** on the new machine with the same code version or newer. Pending migrations
   run automatically (after taking a backup); an older code version refuses to open a newer database.
   Check the admin **Status** page: schema version, database size and your users should all be there.

4. Point the app at the new server (`EXPO_PUBLIC_API_URL`). Sessions are stored in the database, so
   users stay signed in once the app talks to the new server.

If you set `MASTER_KEY` in `.env` instead of using `master.key`, move that value instead of the file.

### Migrations

The schema lives in `src/migrations.ts` as an **append-only** list of SQL migrations, tracked by
`PRAGMA user_version`. Each runs once, in its own transaction, at boot.

- **Never edit, reorder or delete a shipped migration.** To change the schema, append a new entry
  (and add its SHA-256 to `FINGERPRINTS` in `test/migrations.test.ts`; that test fails if an old
  migration changes). The test also upgrades a database from every earlier version with sample
  data and checks that it survives.
- **Prefer additive changes**: new tables, new nullable columns, new indexes.
- **Renaming or dropping a column safely**: add the new column → copy the data in the same
  migration → change the code to read/write only the new column → drop the old one only in a later
  release, once nothing reads it.
- **JSON columns** (`jobs.request`, `jobs.result`, `users.settings`, …) are upgraded on read
  (e.g. old single-post jobs read back as `posts[0]`), so their shape can change without a migration.
- **Backups**: before migrating an existing database the server copies it with SQLite's
  `VACUUM INTO` (consistent while running) to `DATA_DIR/backups/app-<UTC stamp>-v<from>-to-v<to>.db`
  and keeps the newest 10. If that backup fails, the server refuses to migrate and exits.
  On-demand backup: `npm run db:backup -w apps/server` (`…-manual.db`, safe while the server runs).
- **Downgrade guard**: a database from a newer server version (higher `user_version` than this code
  knows) is refused at boot — deploy the newer code or restore a backup.
- **Restore a backup**: stop the server, copy the backup over `DATA_DIR/app.db` (and delete
  `app.db-wal` / `app.db-shm` if present), start the server. Newer migrations re-run on boot.
- **Permissions**: on boot `DATA_DIR` and `backups/` are set to 0700 and `app.db`, its `-wal`/`-shm`
  files, `master.key` and every backup to 0600 (owner-only); the log says so once if it had to change
  anything. Back up `master.key` together with the database — without it, stored secrets can't be
  decrypted.
- The admin **Status** page shows the schema version, database size and the latest backup.

## Moving to EC2

- Use Node 24 (the version in the root `.nvmrc`; e.g. `nvm install` in the repo root). `node:sqlite` is
  built in, no flags needed.
- Copy the repo (the server imports `packages/shared`), run `npm ci -w apps/server` at the root, create
  `apps/server/.env` (mode 0600) with `HOST=127.0.0.1`, `TRUST_PROXY=1`,
  `GOOGLE_CLIENT_IDS`, the seeds (`OPENROUTER_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
  `ADMIN_USERNAME`, `ADMIN_PASSWORD`), and **no** `DEV_LOGIN`.
- Keep it running with systemd (`ExecStart=/usr/bin/npm start`, `WorkingDirectory=/opt/postitup/apps/server`,
  `Restart=always`) or pm2 (`pm2 start npm --name postitup -- start`).
- Put it behind HTTPS, e.g. Caddy: `api.example.com { reverse_proxy 127.0.0.1:8787 }` (automatic TLS).
  Point the app's `EXPO_PUBLIC_API_URL` at the HTTPS URL.
- Keep `DATA_DIR` on the EBS volume. Back up `app.db` **and** `master.key` together (or set
  `MASTER_KEY` from a secrets store) — without the key, stored Spotify tokens and the stored
  OpenRouter key can't be decrypted.
- Use a long admin password and only open `/admin` over HTTPS. For a consistent copy of a live DB: `sqlite3 app.db ".backup app.bak"`.

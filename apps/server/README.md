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

Open `http://localhost:8787/admin` (or `https://<your-domain>/admin` on EC2) and sign in with the
admin account (seeded from `ADMIN_USERNAME` / `ADMIN_PASSWORD`; sign-in is rate-limited per IP).
Server-rendered pages sharing one layout; to add a section, add an entry to `PAGES` in
`src/admin/pages.ts`.

- **Overview**: credits left, today's spend and tasks, failed integration calls (24 h), Spotify connections, status.
- **AI usage**: OpenRouter credits (account credits need a management key; otherwise this key's usage
  is shown and labelled), spend per day (30 days), per user, per AI step, per model — from `ai_calls`,
  recorded from OpenRouter's `usage` on every call.
- **AI settings**: model (image-capable OpenRouter models with prices), allowed song clip lengths.
- **Prompts**: the five model instructions, versioned (edit → new active version; history with
  posts/failed counts, diff against active, "Make active").
- **Limits**: tasks/day, music changes/day, log retention, Spotify connection cap.
- **Integrations**: OpenRouter key and Spotify client ID/secret (encrypted, masked; Replace validates, Test runs checks).
- **Users** (incl. spend; disconnect someone's Spotify to free a slot), **Logs** (every outgoing call:
  filters in the URL, 50 per page, row detail), **Status** (on-demand checks: OpenRouter key/model,
  Spotify app/search, LRCLIB, ntfy to a throwaway topic, Google keys; version/uptime), **Account**
  (last sign-ins, change password — signs out other admin sessions).

Settings, prompts and credentials live in the DB, so changes apply immediately. The session cookie
is `HttpOnly; SameSite=Strict; Path=/admin` (12 h; `Secure` over HTTPS); API writes require JSON.

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

## Moving to EC2

- Use Node 22.13+ or 24 (there `node:sqlite` needs no flag; the flag in the scripts is still accepted).
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

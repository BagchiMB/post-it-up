# Post It Up — API contract (app ⇄ server)

Single source of truth for both sides. Change it only through the orchestrator.

## Basics

- Base URL: app reads `EXPO_PUBLIC_API_URL`, default `http://localhost:8787` (Simulator and web preview reach the laptop this way; a physical phone uses the laptop's LAN IP).
- JSON in and out. Errors: non-2xx with body `{ "error": "<human-readable message>" }`.
- Auth: `Authorization: Bearer <token>` on every route except `/health` and `/auth/*`. Missing/invalid/expired token → `401`.
- CORS: allow any `http://localhost:*` and `http://127.0.0.1:*` origin (web preview).
- Body limit: 25 MB (thumbnail uploads).

## Types

```ts
type Reminder = { hour: number; minute: number };

type InstagramProfile = {
  id: string;
  handle: string; // without "@"
  avatarUri?: string; // small data: URI
  tone: 'casual' | 'witty' | 'poetic' | 'minimal';
  emojis: boolean;
  hashtags: string; // appended to captions as-is
  activeDays: number[]; // 0 = Sunday … 6 = Saturday
};

type UserSettings = {
  onboarded: boolean;
  lastMusic?: MusicChoice; // pre-fills the Create screen
  lastPosts?: PostSpec[]; // pre-fills the Create screen
  reminder: Reminder;
  dailyTask?: TaskConfig & { enabled: boolean }; // the automatic daily task (photos from "today")
  accounts: InstagramProfile[];
};

type SpotifyProfile = { displayName: string; imageUrl?: string };

type Me = {
  id: string;
  email: string;
  name?: string; // from Google
  picture?: string; // Google avatar URL
  ntfyTopic: string; // private random topic, e.g. "postitup-k3j9x8q2m1v7c4b6"
  spotify: SpotifyProfile | null;
  settings: UserSettings;
};

/** Where the song comes from — chosen per post on the Create screen. Every source must yield a song that fits the photo(s). */
type MusicChoice =
  | { source: 'history' } // the user's Spotify top + recently played tracks (needs Me.spotify)
  | { source: 'playlists'; playlists: { id: string; name: string }[] } // 1–5 Spotify playlists the user picked
  | { source: 'artists'; artists: { name: string; id?: string }[] } // 1–10 artists; id when picked from Spotify search
  | { source: 'ai'; artistHint?: string; genreHint?: string }; // free choice, optional hints

/** One post the task should produce. */
type PostSpec = {
  kind: 'people' | 'scenery' | 'mix'; // which photos: people-focused, places/landscapes/things, or both
  format: 'single' | 'carousel'; // 'mix' is always 'carousel'
  maxPhotos: number; // 1 for single; 2–20 for carousel
};

/** What a task should make. Used for manual tasks and for the automatic daily task. */
type TaskConfig = {
  accountId: string; // InstagramProfile.id
  posts: PostSpec[]; // 1–5 posts; photos are never reused across posts in one task
  music: MusicChoice;
};

type DraftRequest = TaskConfig & {
  from: string; // local calendar day YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  auto?: boolean; // true when created by the daily background task
};

type JobStatus = 'queued' | 'running' | 'ready' | 'failed';

type SongClip = {
  // the part of the song to use, like Instagram's clip picker
  startSec: number;
  endSec: number; // startSec + one of the admin's allowed clip lengths
  lengthSec: number; // the chosen length (10/15/20/25/30 by default)
  lyric?: string; // the line sung at startSec (from timed lyrics)
  estimated: boolean; // true when guessed without timed lyrics
};

type Song = { title: string; artist: string; spotifyId?: string; clip?: SongClip };

type PostResult = {
  kind: PostSpec['kind'];
  assetIds: string[]; // chosen candidate ids, in post order (phone resolves to photos)
  caption: string; // hashtags already appended
  reason: string;
  photoSummary: string;
  song: Song;
  previousSongs: Song[]; // songs replaced via "Change the music", newest first
  musicStatus?: 'changing' | 'failed'; // while a "Change the music" request runs / if it failed
  musicError?: string;
};

/** A task: one run over a date range that produces one or more posts. (Named Job in the API for continuity.) */
type Job = {
  id: string;
  createdAt: number; // ms epoch
  updatedAt: number;
  request: DraftRequest;
  status: JobStatus;
  progress?: string; // e.g. "Shortlisting photos (2 of 4)" while queued/running
  error?: string; // when failed
  result?: {
    // when ready
    posts: PostResult[]; // same order as request.posts; a spec with too few matching photos is skipped and listed in `skipped`
    skipped?: { index: number; reason: string }[];
    modelName: string;
  };
};
```

New users get default settings: `{ onboarded: false, reminder: { hour: 20, minute: 0 }, accounts: [] }`.

## Endpoints

| Method & path                       | Body                                                                                                                                                                                                 | Response                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                       | —                                                                                                                                                                                                    | `{ ok: true, version: string, devLogin: boolean }` (no auth)                                                                                                                                                                                                                                                                                                       |
| `POST /auth/google`                 | `{ idToken }` — Google ID token from the app's sign-in                                                                                                                                               | `{ token, me: Me }`; creates the user on first sign-in; `401 { error }` if the token is invalid                                                                                                                                                                                                                                                                    |
| `POST /auth/dev`                    | `{ email }`                                                                                                                                                                                          | Same as `/auth/google`, for local testing only. Exists only when the server runs with `DEV_LOGIN=1`; otherwise `404`.                                                                                                                                                                                                                                              |
| `POST /auth/logout`                 | —                                                                                                                                                                                                    | `204` (invalidates this token)                                                                                                                                                                                                                                                                                                                                     |
| `GET /me`                           | —                                                                                                                                                                                                    | `Me`                                                                                                                                                                                                                                                                                                                                                               |
| `PUT /me/settings`                  | `UserSettings` (full replace)                                                                                                                                                                        | `UserSettings`                                                                                                                                                                                                                                                                                                                                                     |
| `PUT /me/spotify`                   | `{ accessToken, refreshToken, expiresAt }` (expiresAt = ms epoch)                                                                                                                                    | `SpotifyProfile` (server calls Spotify `/v1/me`)                                                                                                                                                                                                                                                                                                                   |
| `DELETE /me/spotify`                | —                                                                                                                                                                                                    | `204`                                                                                                                                                                                                                                                                                                                                                              |
| `GET /spotify/artists?q=`           | —                                                                                                                                                                                                    | `{ id, name, imageUrl? }[]` (≤10) — artist search for the picker                                                                                                                                                                                                                                                                                                   |
| `GET /spotify/playlist?url=`        | —                                                                                                                                                                                                    | `{ id, name, ownerName, trackCount, imageUrl? }` — resolves a pasted playlist link (open.spotify.com URL, spotify:playlist: URI or bare id); `422 { error }` if Spotify won't let us read it                                                                                                                                                                       |
| `GET /spotify/my-playlists`         | —                                                                                                                                                                                                    | `{ id, name, trackCount, imageUrl? }[]` — the user's own playlists (needs Me.spotify; `409` if not connected)                                                                                                                                                                                                                                                      |
| `POST /jobs`                        | `{ request: DraftRequest, candidates: { id: string; takenAt: number }[], images: string[] }` — `images[i]` is the base64 JPEG (no `data:` prefix) of `candidates[i]`, longest side 512px; 1–96 items | `201 Job` (status `queued`)                                                                                                                                                                                                                                                                                                                                        |
| `GET /jobs`                         | —                                                                                                                                                                                                    | `Job[]`, newest first, at most 30                                                                                                                                                                                                                                                                                                                                  |
| `GET /jobs/:id`                     | —                                                                                                                                                                                                    | `Job` (404 if not this user's)                                                                                                                                                                                                                                                                                                                                     |
| `POST /jobs/:id/retry`              | —                                                                                                                                                                                                    | `Job` re-queued from the stored thumbnails (`410` if they were already deleted)                                                                                                                                                                                                                                                                                    |
| `POST /jobs/:id/posts/:index/music` | `{ prompt }` (1–300 chars, e.g. "more upbeat, Bollywood")                                                                                                                                            | `202 Job` with that post's `musicStatus: 'changing'`; the server picks a new song + clip that still fits the photo(s), pushes the old song onto `previousSongs` (never re-suggests one of them), then clears `musicStatus`. Counts against `dailyMusicChangeLimit` (429 when exceeded). 409 if the job isn't `ready` or a change is already running for that post. |
| `DELETE /jobs/:id`                  | —                                                                                                                                                                                                    | `204` (also deletes thumbnails)                                                                                                                                                                                                                                                                                                                                    |

## Server behaviour

- Jobs survive server restarts: on boot, `queued`/`running` jobs are re-queued. Concurrency 2.
- Thumbnails live on disk only for the job's lifetime; deleted on `DELETE` or 7 days after the job finishes.
- OpenRouter: ONE server-wide key (`OPENROUTER_API_KEY`, owner pays) for every user — users never supply keys. Users never choose a model; the server uses its own setting (see "Server settings & admin"). Cost guard: at most `DAILY_JOB_LIMIT` (default 20) `POST /jobs` + retries per user per UTC day → `429 { error: "You've reached today's limit of N posts." }`. If the key is missing, jobs fail with "The server has no OpenRouter key — set OPENROUTER_API_KEY."
- The pipeline (shortlist → final pick + caption → song) runs server-side. The song must fit what's in the chosen photo(s) (scene, mood, colours, people, occasion) — say so explicitly in the prompt and include one line on why in `reason`.
- Song by `request.music.source`:
  - `history` — candidates = user's `/me/top/tracks` (medium_term, 50) + `/me/player/recently-played` (50), deduped; model picks one candidate id.
  - `playlists` — candidates = tracks of each playlist via `GET /v1/playlists/{id}/items` (paginate, cap 200 total, sample evenly). Read with the app's own credentials (Client Credentials: `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`), falling back to the user's token if they're connected; model picks one candidate id.
  - `artists` — no candidate list (Spotify removed artist top-tracks for dev-mode apps): model names a song BY one of the given artists that fits the photo.
  - `ai` — model suggests a well-known song (likely in Instagram's music library) fitting the photo, honouring `artistHint`/`genreHint` when given.
  - For `artists`/`ai` (and as a fallback when a candidate list is empty), match the suggestion with `GET /v1/search?type=track&limit=5` (app credentials, else user token) to fill `spotifyId`. If no Spotify access works, keep the suggestion without `spotifyId` — never fail a job over the song.
- Song clip: after the song is settled, fetch timed lyrics from LRCLIB (`GET https://lrclib.net/api/get?track_name=&artist_name=&duration=` with seconds from Spotify's `duration_ms` when known; fall back to `GET /api/search?track_name=&artist_name=` and take the closest-duration result with `syncedLyrics`). Parse the LRC lines (`[mm:ss.xx] text`), then a small second model call picks the ~15 s window whose lyrics best fit the photo(s) and caption — prefer the hook/chorus — returning a line index → `clip.startSec`, `clip.endSec = start + 15` (clamped to the duration), `clip.lyric`, `estimated: false`. No timed lyrics (instrumental/not found): ask the model for its best estimate of the hook's start (`estimated: true`, no lyric). Never fail a job over the clip; omit `clip` if everything fails. Set a descriptive `User-Agent` on LRCLIB requests.
- Spotify is optional per user (`history` needs it; the 5-user dev-mode cap applies to connected users only). `/spotify/*` endpoints use app credentials, falling back to the user's token.
- When a job becomes `ready` or `failed`, the server POSTs to ntfy: `POST {NTFY_URL}/{ntfyTopic}` with headers `Title`, `Click: postitup://draft/<jobId>`, `Tags`; body is generic (e.g. "Your Oct 21 – Oct 27 post is ready" / "Couldn't make your post"), never the caption.
- Per-user secrets (Spotify tokens) are encrypted at rest (AES-256-GCM, server master key). Sessions: random 32-byte token; only its SHA-256 is stored.
- Google sign-in: verify the ID token's RS256 signature against Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`, cached per its Cache-Control, refetched on unknown `kid`), `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud` ∈ `GOOGLE_CLIENT_IDS` (comma-separated env), `exp` in the future, `email_verified` true. Users are keyed by Google `sub` (store email, name, picture; refresh them on each sign-in). No passwords anywhere. `DEV_LOGIN` defaults off and must never be enabled on a public server.

## App behaviour (for reference)

- Sign-in: "Continue with Google" via expo-auth-session (authorization code + PKCE with the iOS OAuth client ID from `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, scopes `openid email profile`, redirect `com.googleusercontent.apps.<id>:/oauthredirect`), then `POST /auth/google` with the returned `id_token`. In `__DEV__` builds, when `/health` says `devLogin: true`, a small "Developer sign-in" (email only) is also shown.
- Deep link `postitup://draft/<jobId>` opens the post (Expo Router route `draft/[id]`).
- The app polls `GET /health`; when it fails it shows "Server isn't running" and blocks Start. A background task checks too and shows a local notification.

## Server settings & admin web app

Runtime settings live in the DB (`server_settings`), seeded from env on first boot; every read goes through one cached accessor so admin edits apply immediately without a restart or code change.

| Setting                                   | Seed (env)                                                | Notes                                                                                          |
| ----------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `model` `{ id, name, structuredOutputs }` | `OPENROUTER_DEFAULT_MODEL` (default `openai/gpt-6-astra`) | chosen from OpenRouter's vision-capable models                                                 |
| OpenRouter key                            | `OPENROUTER_API_KEY`                                      | stored encrypted; admin can replace/test; never returned in full (show `sk-or-…last4`)         |
| `dailyJobLimit`                           | `DAILY_JOB_LIMIT` (20)                                    | per user per UTC day (POST /jobs + retries)                                                    |
| `clipLengths`                             | `[10, 15, 20, 25, 30]`                                    | allowed clip lengths in seconds (each 5–90, 1–8 values); the model picks the best one per song |
| `dailyMusicChangeLimit`                   | 30                                                        | "Change the music" requests per user per UTC day                                               |

Admin UI: `GET /admin` serves a single self-contained HTML page (inline CSS/JS, no build step, minimal black/white, light/dark). Auth: username + password from env `ADMIN_USERNAME` / `ADMIN_PASSWORD` (no token file; if either is unset, admin login is disabled and the page says so). `POST /admin/login { username, password }` (username compared case-insensitively, password constant-time, both checked even if the username is wrong; rate-limited per IP; generic "Wrong username or password.") sets an `HttpOnly; SameSite=Strict; Path=/admin` cookie (`Secure` when served over HTTPS / `TRUST_PROXY=1`), 12-hour expiry; `POST /admin/logout`. Log a startup warning when the password is shorter than 12 characters. JSON API under `/admin/api/*` (cookie required, CSRF-safe via SameSite=Strict + requiring `Content-Type: application/json`):

| Method & path                         | Purpose                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /admin/api/settings`             | current settings + `{ openRouterKey: { set: boolean, hint?: string }, spotify: { appCredentials: boolean } }` |
| `PUT /admin/api/settings`             | partial update of `model`, `dailyJobLimit` (1–500), `clipLengths`, `dailyMusicChangeLimit` (0–500)            |
| `PUT /admin/api/openrouter-key`       | `{ key }` → validated with OpenRouter `/key`, then stored encrypted                                           |
| `POST /admin/api/openrouter-key/test` | validates the stored key → `{ ok, error? }` (+ remaining credit if OpenRouter returns it)                     |
| `GET /admin/api/models`               | vision-capable OpenRouter models `{ id, name, inputPrice, outputPrice, structuredOutputs }[]` (cached 1 h)    |
| `GET /admin/api/users`                | `{ id, email, name?, createdAt, spotify: boolean, postsToday, postsTotal }[]`                                 |

Admin routes are never covered by the app's bearer auth, and the app has no admin access.

## Prompts (admin-managed, versioned)

Every model instruction is a DB-stored template; the JSON response schemas stay in code (structure is not editable, wording is). Table `prompt_versions(key, version, body, note, created_at)` + one active version per key. On first boot each key gets **v1** = the built-in default (note "Default"). Editing never overwrites: it inserts version N+1 and activates it. Old versions are never deleted.

Templates use `{{name}}` placeholders, filled at run time; unknown placeholders are left as-is and flagged in the admin UI.

| Key                  | Used for                                                                                    | Placeholders                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shortlist`          | batch shortlisting on long ranges                                                           | `{{keep}}` `{{photoCount}}`                                                                                                                                                                                                   |
| `final_post`         | photo picks + caption + song for EVERY post spec in one call (no photo reused across posts) | `{{handle}}` `{{range}}` `{{postsInstructions}}` (numbered list of the requested posts: kind, single/carousel, max N) `{{tone}}` `{{emojiRule}}` `{{musicInstructions}}` (per music source: candidate list / artists / hints) |
| `song_clip`          | choose the start line AND the best length from timed lyrics                                 | `{{title}}` `{{artist}}` `{{photoSummary}}` `{{caption}}` `{{clipLengths}}` (e.g. "10, 15, 20, 25 or 30") `{{lyrics}}` (numbered `[index] m:ss text` lines)                                                                   |
| `song_clip_estimate` | estimate the hook start + best length when there are no timed lyrics                        | `{{title}}` `{{artist}}` `{{photoSummary}}` `{{clipLengths}}`                                                                                                                                                                 |
| `song_change`        | "Change the music" for one post                                                             | `{{photoSummary}}` `{{caption}}` `{{userRequest}}` `{{previousSongs}}` `{{musicInstructions}}`                                                                                                                                |

Each job stores the prompt versions it used (`{ shortlist?: n, final_post: n, song_clip?: n, song_clip_estimate?: n, song_change?: n }`) — server-side only, not part of the app's `Job` type.

Admin API (cookie auth like the rest of `/admin/api`):

| Method & path                           | Purpose                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/api/prompts`                | `[{ key, title, description, placeholders: { name, description }[], active: { version, body, note, createdAt }, versionCount }]` |
| `GET /admin/api/prompts/:key/versions`  | `[{ version, body, note, createdAt, active, jobs, failed }]` newest first (`jobs`/`failed` = posts made with that version)       |
| `POST /admin/api/prompts/:key`          | `{ body, note? }` → creates and activates the next version (body 20–20 000 chars)                                                |
| `POST /admin/api/prompts/:key/activate` | `{ version }` → makes an older version live again                                                                                |

Admin UI gets a "Prompts" section: list of the prompts → editor with the active body, placeholder reference (click to insert), note field, Save as new version; history list with version, date, note, posts/failed counts, "View" (read-only, with a simple line diff against the active version) and "Make active".

## Clip length

`song_clip` returns `{ startIndex, lengthSec }` where `lengthSec` must be one of `clipLengths`; the model picks the length that covers a natural lyrical unit (a full chorus/hook or verse paragraph) starting at `startIndex` — e.g. a 4-line chorus spanning 0:52–1:13 → 20 s. Snap anything else to the nearest allowed value and clamp to the song's duration. `song_clip_estimate` returns `{ startSec, lengthSec }` likewise. The app shows the clip read-only ("0:52 – 1:12 · 20 s"); users adjust it inside Instagram.

## Multiple posts per task

- One shortlist pass over the range (as now), then ONE `final_post` call producing every requested post, with the instruction that photos are not reused across posts and each post follows its `kind` (`people`: people are the subject; `scenery`: places, landscapes, food, objects — no people as the main subject; `mix`: a carousel combining both). Each post gets its own caption, song (per `music`) and clip. If the range lacks suitable photos for a spec, skip that post and record it in `result.skipped` (job still `ready` if at least one post was made; `failed` if none).
- Old jobs (single post, top-level `assetIds`/`caption`/`song`) must still read back as `result.posts[0]` — migrate on read.
- ntfy body: "Your N posts for <range> are ready".

## Daily automatic task

`UserSettings.dailyTask` is configured in the app's Settings (same controls as the Create screen, minus dates). The phone runs it, because only the phone can read photos: an `expo-background-task` job (and, as a fallback, the daily reminder notification opening the app) checks whether today's auto task already exists (`GET /jobs` → any job with `auto: true` and `from == today`), and if not, uploads today's thumbnails and `POST /jobs` with `{ ...dailyTask, from: today, to: today, auto: true }`. At most one auto task per user per day (server rejects a second with 409). If `dailyTask` is missing or disabled, nothing runs.

## Admin site structure, usage and account

The admin UI is a small multi-page site, not a single-page app: each section is its own server-rendered route sharing one layout (top/side nav, sign-out, minimal black/white, light/dark, works at phone width) with only page-specific inline JS. New sections are added by registering a route + nav entry in one place.

| Route                                          | Page                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin`                                   | Overview: credits remaining, today's posts/spend, status summary                                                                                                                            |
| `GET /admin/ai-usage`                          | OpenRouter credits (total purchased, total used, remaining) + this key's usage today/week/month + our own spend breakdowns (by day for 30 days, by user, by AI step = prompt key, by model) |
| `GET /admin/ai`                                | Model, OpenRouter key (replace/test), clip lengths                                                                                                                                          |
| `GET /admin/prompts` (+ `/admin/prompts/:key`) | Prompt list → editor + version history                                                                                                                                                      |
| `GET /admin/limits`                            | dailyJobLimit, dailyMusicChangeLimit                                                                                                                                                        |
| `GET /admin/users`                             | Users table incl. posts today/total and spend                                                                                                                                               |
| `GET /admin/account`                           | Admin username, last sign-in time/IP, change password                                                                                                                                       |
| `GET /admin/status`                            | OpenRouter, Spotify, LRCLIB reachability, server version/uptime                                                                                                                             |
| `GET /admin/login`                             | Sign-in page (all other admin pages redirect here when signed out)                                                                                                                          |

Usage tracking: every OpenRouter call records a row `ai_calls(id, job_id, user_id, prompt_key, model, prompt_tokens, completion_tokens, cost_usd, created_at)` from the response's `usage` (request usage accounting if needed — check OpenRouter's current docs; `cost` in USD). Credits: `GET https://openrouter.ai/api/v1/credits` (`total_credits`, `total_usage`) if the key may call it; otherwise fall back to `GET /api/v1/key` (`usage`, `usage_daily/weekly/monthly`, `limit`, `limit_remaining`) and say on the page which source is shown. Cache credit lookups ~60 s.

Admin account: on first boot the admin user is seeded from `ADMIN_USERNAME`/`ADMIN_PASSWORD` into the DB (`admin_account(username, password_hash (scrypt), updated_at, last_login_at, last_login_ip)`); afterwards the DB is the source of truth and env changes are ignored unless `ADMIN_RESET=1` is set for one boot (re-seed, logged loudly). Change password requires the current password, new ≥ 10 chars, and signs out other admin sessions. The startup warning about a short password applies to the stored one (warn while the seeded default is still in use).

Admin JSON API additions (cookie auth): `GET /admin/api/usage?days=30` → `{ credits: { source: 'credits' | 'key', total?, used, remaining?, usageDaily?, usageWeekly?, usageMonthly? }, byDay: { day, cost, calls }[], byUser: { userId, email, cost, posts }[], byStep: { key, cost, calls }[], byModel: { model, cost, calls }[] }`; `GET /admin/api/account`; `POST /admin/api/account/password { currentPassword, newPassword }`.

## Integration checks & logs

All outgoing HTTP calls (OpenRouter, Spotify accounts + Web API, LRCLIB, ntfy, Google JWKS) go through ONE wrapper that records a row in `integration_calls(id, at, integration, operation, user_id?, job_id?, method, path, status_code?, ok, duration_ms, cost_usd?, error?)`:

- `integration` ∈ `openrouter | spotify | lrclib | ntfy | google`; `operation` is a short name (`chat`, `models`, `key`, `credits`, `token`, `search`, `playlist`, `playlist_items`, `me`, `top_tracks`, `recently_played`, `lyrics_get`, `lyrics_search`, `push`, `jwks`, …).
- `path` = URL host + path only — never query strings that can carry secrets, never request/response bodies, keys, tokens, images or prompts. `error` = a short message (≤300 chars), with anything resembling a token/key redacted.
- `ai_calls` cost data is linked (or merged) so AI log rows show cost.
- Retention: `logRetentionDays` admin setting (default 30, 1–365); swept periodically.

Status page: "Run all checks" + per-check "Run" buttons → `POST /admin/api/checks/run { checks?: string[] }` → `[{ id, label, ok, durationMs, detail?, error? }]`. Checks: `openrouter_key` (valid + credits), `openrouter_model` (selected model exists and accepts images), `spotify_app` (client-credentials token), `spotify_search` (sample track search), `lrclib` (sample lyrics lookup), `ntfy` (publish to a throwaway random topic, never a user's), `google_jwks`. Checks are logged like any other call (`user_id` empty, operation prefixed `check:`). Show last run time and results; no automatic polling.

Logs page `GET /admin/logs`: table (time, integration, operation, user email, task id, status, ok/failed, duration, cost) newest first, 50 per page with next/prev; filters: integration (multi), user (email search), result (ok/failed/all), operation, task id, date range (from/to); filters live in the URL query so a filtered view can be bookmarked; row click → detail panel. API: `GET /admin/api/logs?integration=&user=&ok=&operation=&job=&from=&to=&cursor=` → `{ rows, nextCursor }`. The Overview page shows failed calls in the last 24 h with a link to the filtered logs.

## Integrations credentials (admin-managed)

Admin page `GET /admin/integrations` (nav entry "Integrations") manages every third-party credential; all stored encrypted in `server_settings`, seeded from env on first boot only:

- OpenRouter API key (moved here from AI settings): Replace (validated) / Test, masked `sk-or-…last4`.
- Spotify Client ID (plain, shown in full) + Client Secret (masked `••••last4`): Replace (validated by fetching a client-credentials token) / Test. Changing them invalidates the cached app token. Show a note: a different Spotify app must have redirect URI `postitup://spotify-callback` and your app's iOS bundle ID (`APP_BUNDLE_ID`); users must reconnect Spotify.
- Admin API: `GET /admin/api/integrations` → `{ openrouter: { set, hint? }, spotify: { clientId?, secretSet, secretHint? } }`; `PUT /admin/api/integrations/openrouter { key }`; `PUT /admin/api/integrations/spotify { clientId?, clientSecret? }`; tests reuse `POST /admin/api/checks/run`.
- Every server use of these values reads the cached settings accessor (no env reads at call time).

Public app config (no auth): `GET /config` → `{ spotifyClientId: string | null }`. The app fetches it at startup (cache the last value in kv storage for offline start) and uses it for Spotify PKCE login and App Remote playback, falling back to `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` only if the server has none. If it's null and there's no fallback, Spotify features show "Spotify isn't set up on the server yet."

## Spotify connection cap

- Admin setting `spotifyUserCap` (default 5, 0–25) on the Limits page. "Connected" = users with stored Spotify tokens.
- `GET /config` adds `spotifyConnect: { available: boolean }` — `false` when connected count ≥ cap. (Per-user view: the app also knows from `Me.spotify` whether _this_ user is connected; connected users always keep their connection.)
- `PUT /me/spotify` returns `409 { error: "Spotify sign-in is full." }` when the cap is reached and this user isn't already connected. It also calls `/v1/me` first; if Spotify answers 403 (user not on the app's dashboard allowlist), return `403 { error: "Ask the app owner to add your Spotify email in the Spotify dashboard." }` and store nothing (no slot used).
- Admin Users page: "Spotify" column shows connected users and a "Disconnect" action (`POST /admin/api/users/:id/spotify/disconnect`) that deletes their tokens, freeing a slot; Overview shows "Spotify: N of cap connected".
- App: when `spotifyConnect.available` is false and the user isn't connected, hide "Connect Spotify" (Settings + onboarding) and the "My listening" music chip, and show "Spotify sign-in is full. Use playlists, artists or AI pick instead." Show the 403/409 messages from `PUT /me/spotify` inline.

## Spotify access requests

Spotify dev mode only admits accounts the owner adds by hand in the Spotify dashboard (no API). This flow makes that a 20-second admin step.

```ts
type SpotifyAccess =
  | { status: 'none' } // hasn't asked
  | { status: 'requested'; spotifyEmail: string; at: number }
  | { status: 'approved'; spotifyEmail: string; at: number } // owner added them in Spotify's dashboard
  | { status: 'declined'; at: number; note?: string };
```

- `Me` gains `spotifyAccess: SpotifyAccess`. Connected users (`Me.spotify` set) and the owner (`spotifyOwnerUserId`) are always returned as `{ status: 'approved', spotifyEmail: <their Spotify or Google email>, at }` — the app needs no owner flag.
- `POST /me/spotify-access { spotifyEmail, name? }` → `SpotifyAccess` (`requested`). 409 if already requested/approved/connected; 409 "Spotify sign-in is full." when approved + connected + pending ≥ `spotifyUserCap`. A user may withdraw with `DELETE /me/spotify-access` (only while `requested`).
- `PUT /me/spotify` (connect) is allowed only when `spotifyAccess.status === 'approved'` or the user is the configured owner (setting `spotifyOwnerUserId`, picked on the admin Users page — the owner never needs approval). Otherwise 409 "Request Spotify access first."
- `/config.spotifyConnect.available` counts approved + connected (+ pending requests) against the cap.
- Admin: new page `GET /admin/spotify-access` (nav "Spotify access", with a pending-count badge) listing requests: app user (name, Google email), Spotify email with a **Copy** button, requested time, a link to the Spotify dashboard's User Management for the configured Spotify app (`https://developer.spotify.com/dashboard/<clientId>/users`), and actions **Mark as added** (→ approved; sends the user an ntfy push "You can connect Spotify in Post It Up now" with `Click: postitup://settings`) and **Decline** (optional note; push "Your Spotify access request wasn't approved"). Approved list with **Revoke** (→ none; disconnects their tokens; reminder text: "Also remove them in Spotify's dashboard"). Shows "N of cap used". APIs: `GET /admin/api/spotify-access`, `POST /admin/api/spotify-access/:userId/approve`, `…/decline { note? }`, `…/revoke`.
- App: in Settings → Spotify (and the onboarding Spotify step): `none` → "Request Spotify access" (field: Spotify account email, prefilled with the Google email, + one-line explanation); `requested` → "Waiting for approval · <email>" + "Withdraw"; `approved` → the Connect Spotify button; `declined` → the note + "Request again". "My listening" chip only for connected users. Full-cap messaging as before. Refetch `/me` on foreground so approval shows up without restarting.

## Playlists need a Spotify connection (live finding)

Verified against live Spotify: with app (client-credentials) tokens, `GET /v1/playlists/{id}` returns metadata but no `tracks`/`items`, and `/v1/playlists/{id}/items` → 401. So the `playlists` music source requires the user's own Spotify connection:

- Server: `POST /jobs` (and `/spotify/playlist`, `/spotify/my-playlists`) with `music.source === 'playlists'` → `409 { error: "Connect Spotify to use your playlists." }` when the user isn't connected. Read playlist items only with the user's token (no app-credential attempt). Track count comes from the items endpoint's `total`, never shown as 0 from missing metadata.
- App: the "Playlists" music chip is shown only to Spotify-connected users (like "My listening"); everyone else sees Artists and AI pick. A saved `lastMusic`/`dailyTask.music` of `playlists` falls back to `ai` for non-connected users.

## Artists source uses Spotify's popular tracks (live finding)

Verified live with app credentials: `/v1/artists/{id}/top-tracks` → 403, but `GET /v1/search?type=track&q=artist:"<name>"` returns the artist's tracks in popularity order, 5 per page regardless of `limit`; paging `offset=0,5,10` yields ~12–15 distinct popular tracks. So for `music.source === 'artists'`: for each artist (≤10) fetch offsets 0, 5, 10 with app credentials (fall back to the user's token), keep tracks whose primary artist matches (case-insensitive; prefer the artist id when known), dedupe by id and by normalised title (drop "(From …)", "- Remastered", live/remix duplicates), cap ~15 per artist / 60 total, and pass them to `final_post`/`song_change` as the candidate list (the model returns a candidate id). If Spotify is unavailable, fall back to the previous behaviour (model names a song by one of the artists, then search-match).

## Song fit score & alternative

- `Song` gains `fit?: { score: number; note: string }` — 0–100, how well the song fits what's actually in the post's photo(s); `note` = one short line (≤120 chars) explaining it. Rubric (put it in the prompts): 90–100 excellent (mood, energy and theme all match), 70–89 good, 50–69 okay (partly fits), <50 poor.
- `PostResult` gains `alternative?: Song` — present only when `song.fit.score < lowFitThreshold` AND the song came from a restricted source (`history`, `playlists`, `artists`): the model's best-fitting song from ANY artist (well-known, likely in Instagram's library), with its own `fit`, Spotify-matched (`spotifyId` when found) and with its own `clip`. Never equal to `song` or anything in `previousSongs`.
- Admin setting `lowFitThreshold` (default 65, 0–100) on the Limits page (rename the page "Limits & quality" if that reads better).
- `final_post` (new version v3, note "Fit score + alternative") and `song_change` (v2) return `fit` for the chosen song, plus `alternative` when the fit is below `{{lowFitThreshold}}` (new placeholder) and the source is restricted. Ask for honest, calibrated scores — "don't inflate; a weak match should score low so the user can choose something better".
- `POST /jobs/:id/posts/:index/use-alternative` → `Job`: swaps `alternative` into `song` (old song pushed to `previousSongs`), clears `alternative`. 409 if none. Doesn't count against any limit.
- App: next to the song line show a small badge "Fit 82%" (muted; amber when below the threshold — the app can treat < 65 as low unless `/config` provides `lowFitThreshold`, which it should: add `lowFitThreshold` to `GET /config`). When `alternative` exists show a soft note "<fit.note>" and a card "Better match: Title · Artist (86%)" with its clip line and a "Use this" button (and a Play control when playable). After swapping, the previous song appears in "Previous:" as usual.

## Models per AI step

- Steps (same keys as prompts): `shortlist` (sees photos), `final_post` (sees photos), `song_clip`, `song_clip_estimate`, `song_change` (text-only).
- Server setting `stepModels: Partial<Record<StepKey, { id, name, structuredOutputs }>>`; each step uses `stepModels[key] ?? model` (the default). The existing `model` setting is the default.
- `GET /admin/api/models?vision=1|0` — `vision=1` (default) as today; `vision=0` lists text-capable models too (still excluding :batch, routers, ~aliases, non-text outputs, negative prices), each with `vision: boolean`.
- `PUT /admin/api/settings { stepModels: { <key>: {id,name,structuredOutputs} | null } }` — `null` resets that step to default; 400 if a vision step is given a non-vision model.
- `GET /admin/api/step-models` → `[{ key, label, description, vision, model: {id,name,structuredOutputs} | null, effective: {id,name}, last30d: { calls, avgCostUsd, avgPromptTokens, avgCompletionTokens } }]` (from `ai_calls`).
- Admin UI (AI settings page): "Default model" card + "Model per step" card (row per step: label, one-line description, "Sees photos" pill, current model shown as "Default · <name>" or the override, 30-day avg cost/call + calls, Change / Reset to default). Change opens a right-side drawer picker: search, filters (Free, Structured outputs), sort by price; non-vision models disabled with a tooltip for vision steps; warning chip when a model lacks structured outputs. The per-prompt page shows "Model: <effective> · Change" linking to the AI settings row. Status check `openrouter_model` validates every effective model (default + overrides). Job `result.modelName` becomes the `final_post` model's name.

## Auto-router models (e.g. TypeSafe: Jev Router)

- `GET /admin/api/models?routers=1` additionally returns router models (negative/"-1" pricing, e.g. `typesafe/jev-router`, `openrouter/auto`) with `router: true` and no price; still subject to the vision/structured-outputs flags. Default (no param) keeps excluding them.
- Model picker: an "Include auto-routers" filter; routers are labelled "Auto · variable price" with a note: "Picks a model per request — great for varied requests, but makes prompt-version comparisons noisier."
- `ai_calls` gains `routed_model` = the response's `model` field when it differs from the requested id; AI usage "by model" and Logs show "Jev Router → <routed model>". Costs come from the response's usage as usual.

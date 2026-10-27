import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { config } from './config.ts';

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

/** Each entry runs once, in order; PRAGMA user_version records how many have run. */
const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     identity TEXT NOT NULL UNIQUE,      -- Google "sub", or "dev:<email>"
     email TEXT NOT NULL,
     name TEXT,
     picture TEXT,
     ntfy_topic TEXT NOT NULL,
     settings TEXT NOT NULL,             -- JSON UserSettings
     openrouter_key TEXT,                -- unused: one server-wide OpenRouter key now
     spotify_tokens TEXT,                -- encrypted JSON
     spotify_profile TEXT,               -- JSON SpotifyProfile
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,        -- sha256 of the bearer token
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     request TEXT NOT NULL,              -- JSON DraftRequest
     candidates TEXT NOT NULL,           -- JSON {id, takenAt}[]
     status TEXT NOT NULL,
     progress TEXT,
     error TEXT,
     result TEXT,                        -- JSON
     finished_at INTEGER,
     images_deleted INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX jobs_user ON jobs(user_id, created_at DESC);
   CREATE INDEX jobs_status ON jobs(status);`,
  // 2: per-user daily job counter (POST /jobs + retries), the OpenRouter cost guard.
  `CREATE TABLE job_usage (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     day TEXT NOT NULL,                  -- UTC YYYY-MM-DD
     count INTEGER NOT NULL,
     PRIMARY KEY (user_id, day)
   );`,
  // 3: runtime server settings edited from /admin (JSON value per key; the OpenRouter key is encrypted).
  `CREATE TABLE server_settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  // 4: admin-editable, versioned prompts, and which versions each job used.
  `CREATE TABLE prompt_versions (
     key TEXT NOT NULL,
     version INTEGER NOT NULL,
     body TEXT NOT NULL,
     note TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (key, version)
   );
   CREATE TABLE prompt_active (
     key TEXT PRIMARY KEY,
     version INTEGER NOT NULL
   );
   ALTER TABLE jobs ADD COLUMN prompt_versions TEXT;  -- JSON { shortlist?, final_post, song_clip?, song_clip_estimate? }`,
  // 5: "Change the music" counter per user per UTC day.
  `ALTER TABLE job_usage ADD COLUMN music_changes INTEGER NOT NULL DEFAULT 0;`,
  // 6: AI usage/cost per OpenRouter call, and the admin account (seeded from env).
  `CREATE TABLE ai_calls (
     id TEXT PRIMARY KEY,
     job_id TEXT,
     user_id TEXT,
     prompt_key TEXT NOT NULL,
     model TEXT NOT NULL,
     prompt_tokens INTEGER NOT NULL,
     completion_tokens INTEGER NOT NULL,
     cost_usd REAL NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX ai_calls_time ON ai_calls(created_at);
   CREATE INDEX ai_calls_user ON ai_calls(user_id);
   CREATE TABLE admin_account (
     id INTEGER PRIMARY KEY CHECK (id = 1),  -- single admin
     username TEXT NOT NULL,
     password_hash TEXT NOT NULL,            -- scrypt$N$r$p$salt$hash
     weak_password INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     last_login_at INTEGER,
     last_login_ip TEXT,
     prev_login_at INTEGER,
     prev_login_ip TEXT
   );`,
  // 7: one row per outgoing HTTP call (no secrets, bodies or query strings).
  `CREATE TABLE integration_calls (
     id TEXT PRIMARY KEY,
     at INTEGER NOT NULL,
     integration TEXT NOT NULL,
     operation TEXT NOT NULL,
     user_id TEXT,
     job_id TEXT,
     method TEXT NOT NULL,
     path TEXT NOT NULL,
     status_code INTEGER,
     ok INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     cost_usd REAL,
     error TEXT
   );
   CREATE INDEX integration_calls_at ON integration_calls(at DESC, id DESC);
   CREATE INDEX integration_calls_job ON integration_calls(job_id);`,
  // 8: Spotify access requests (dev-mode allowlist handled by hand by the owner).
  `ALTER TABLE users ADD COLUMN spotify_access TEXT;  -- JSON SpotifyAccess (+ name); NULL = none`,
  // 9: auto-router models: which model a router actually used.
  `ALTER TABLE ai_calls ADD COLUMN routed_model TEXT;
   ALTER TABLE integration_calls ADD COLUMN model TEXT;  -- "Router → model" for router chat calls`,
];

const current = Number(
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
);
for (let v = current; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

type Row = Record<string, unknown>;

export const one = <T = Row>(sql: string, ...params: SQLInputValue[]) =>
  db.prepare(sql).get(...params) as T | undefined;
export const all = <T = Row>(sql: string, ...params: SQLInputValue[]) =>
  db.prepare(sql).all(...params) as T[];
export const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);

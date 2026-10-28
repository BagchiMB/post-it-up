import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema migrations. APPEND-ONLY: never edit or reorder an entry once it has shipped (a test
 * fingerprints each one); to change the schema, add a new entry at the end. Each runs once, in its
 * own transaction; PRAGMA user_version records how many have run.
 */
/** Each entry runs once, in order; PRAGMA user_version records how many have run. */
export const MIGRATIONS: readonly string[] = [
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
  // 10: per-step AI usage (AI usage "by step", per-step model stats, posted rate by final_post model).
  //     Marking posts as posted needs no table change: postedAt lives in jobs.result (JSON, upgraded on read).
  `CREATE INDEX IF NOT EXISTS ai_calls_step ON ai_calls(prompt_key, created_at);`,
  // 11: admin database browser: audit of every write, console history and saved snippets.
  `CREATE TABLE db_audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     admin TEXT NOT NULL,
     table_name TEXT NOT NULL,
     row_key TEXT NOT NULL,              -- JSON, e.g. {"rowid": 3}
     action TEXT NOT NULL,               -- insert | update | delete
     before_json TEXT,                   -- masked row before (NULL for insert)
     after_json TEXT,                    -- masked row after (NULL for delete)
     sql TEXT NOT NULL
   );
   CREATE INDEX db_audit_at ON db_audit(at DESC);
   CREATE INDEX db_audit_table ON db_audit(table_name, at DESC);
   CREATE TABLE db_query_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     sql TEXT NOT NULL,
     ok INTEGER NOT NULL,
     row_count INTEGER,
     duration_ms INTEGER NOT NULL
   );
   CREATE TABLE db_snippets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     sql TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
];

export const BACKUPS_KEEP = 10;

const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

export const schemaVersion = (db: DatabaseSync) =>
  Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);

/** `DATA_DIR/backups`, newest first. */
export function listBackups(dataDir: string) {
  const dir = path.join(dataDir, 'backups');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^app-.*\.db$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const file = path.join(dir, f);
      const st = statSync(file);
      return { file, name: f, size: st.size, at: st.mtimeMs };
    });
}

/**
 * Consistent copy of the live database via SQLite's `VACUUM INTO` (works while the server is
 * running, WAL included) to `DATA_DIR/backups/app-<UTC stamp>-<label>.db`; keeps the newest 10.
 * Throws if the copy can't be made.
 */
export function backupDatabase(db: DatabaseSync, dataDir: string, label: string): string {
  const dir = path.join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // VACUUM INTO refuses to overwrite: two backups in the same second get -2, -3, …
  const base = `app-${stamp()}-${label}`;
  let file = path.join(dir, `${base}.db`);
  for (let i = 2; existsSync(file); i++) file = path.join(dir, `${base}-${i}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  if (!existsSync(file) || statSync(file).size === 0)
    throw new Error(`backup file ${file} is missing or empty`);
  chmodSync(file, 0o600);
  for (const old of listBackups(dataDir).slice(BACKUPS_KEEP)) rmSync(old.file, { force: true });
  return file;
}

/** Runs migrations [from, to) each in its own transaction. */
export function runMigrations(db: DatabaseSync, from: number, to = MIGRATIONS.length) {
  for (let v = from; v < to; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${v + 1} failed: ${(e as Error).message}`, { cause: e });
    }
  }
}

/**
 * Brings the database up to date safely: refuses to run on a database from a newer server
 * (downgrade guard); backs up before migrating an existing database and doesn't migrate if the
 * backup fails. Returns what happened, for logging.
 */
export function prepareDatabase(db: DatabaseSync, dataDir: string) {
  const from = schemaVersion(db);
  const to = MIGRATIONS.length;
  if (from > to) {
    throw new Error(
      `Database is from a newer server version (v${from}) than this code (v${to}). Deploy the newer code or restore a backup.`,
    );
  }
  if (from === to) return { from, to, backup: null as string | null };
  let backup: string | null = null;
  if (from > 0) {
    try {
      backup = backupDatabase(db, dataDir, `v${from}-to-v${to}`);
    } catch (e) {
      throw new Error(
        `Not migrating: the pre-migration backup failed (${(e as Error).message}). Free disk space or fix permissions on ${path.join(dataDir, 'backups')} and start again.`,
        { cause: e },
      );
    }
  }
  runMigrations(db, from, to);
  return { from, to, backup };
}

/**
 * Owner-only permissions for everything holding user data: DATA_DIR and backups/ 0700; app.db,
 * its -wal/-shm files, master.key and every backup 0600. Returns the paths that were tightened.
 */
export function tightenPermissions(dataDir: string): string[] {
  const changed: string[] = [];
  const ensure = (file: string, mode: number) => {
    if (!existsSync(file)) return;
    if ((statSync(file).mode & 0o777) === mode) return;
    chmodSync(file, mode);
    changed.push(file);
  };
  ensure(dataDir, 0o700);
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm', 'master.key'])
    ensure(path.join(dataDir, f), 0o600);
  const backups = path.join(dataDir, 'backups');
  ensure(backups, 0o700);
  for (const b of listBackups(dataDir)) ensure(b.file, 0o600);
  return changed;
}

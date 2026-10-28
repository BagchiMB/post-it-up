// Database safety: frozen migration fingerprints, upgrades from every intermediate version keep the
// data, pre-migration backups (+ retention, abort on failure) and the downgrade guard. No network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

import {
  backupDatabase,
  BACKUPS_KEEP,
  listBackups,
  MIGRATIONS,
  prepareDatabase,
  runMigrations,
  schemaVersion,
  tightenPermissions,
} from '../src/migrations.ts';
import { normalizeRequest, normalizeResult } from '../src/task.ts';

/**
 * SHA-256 of each shipped migration. If this test fails you edited an existing migration:
 * revert that edit and ADD A NEW MIGRATION at the end of MIGRATIONS instead (then add its hash here).
 */
const FINGERPRINTS = [
  'dcbf192107a81ad7404842c7c02bcdd02d597b67fc958ac06f16b3650d0c8af2', // 1
  'f7b9fd5ea0e3ad9e4b0ff7c05f2e4316424bbb83ebfdc51ab3c53b692b7b4e14', // 2
  '6f79bb68b6b874d6e2ca61e7d3187ce68647b8c600c1b187c19a1349c4cfdd56', // 3
  '3392a4606781144058e91533a33ad35d3e7adcb45d46ae65d4aa54a7c047a626', // 4
  'be6b6434f168ba60edbb216e018e935d245e7f919bc073f056eee13bb519451e', // 5
  '779bd8ca70ec6b47b65c3c00de9e55d0c949ddb08cec7980bfd8844bf4cc5f97', // 6
  'dbd6f570e653ccd9543833c5715e2a52d1b5b832f7aba9e3e82835b4f64d1e3a', // 7
  'af08065b708c5434b8434a97e0c933ada93a580a90e6c2bca92831b56ad3ddd3', // 8
  '95dc00a5d60c94ca4a3e05ba5f1ce3d9356e4931f8700439309860a24d593ae4', // 9
  'e2b72adb3806ccd0a7c75ff3725b52b2961bfaf647272d96cbe680a94424f866', // 10
  '1954bde2d1f6655b78a6eb9243c477a3d2b9d5e07972fc3f2da635af49495776', // 11
];

const tmp = mkdtempSync(path.join(tmpdir(), 'postitup-migrations-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const freshDir = () => path.join(tmp, `case-${++n}`);

test('shipped migrations are unchanged (append-only)', () => {
  assert.ok(MIGRATIONS.length >= FINGERPRINTS.length, 'a migration was removed');
  FINGERPRINTS.forEach((expected, i) => {
    const actual = createHash('sha256').update(MIGRATIONS[i]).digest('hex');
    assert.equal(
      actual,
      expected,
      `Migration ${i + 1} was edited. Never change a shipped migration: revert it and append a new migration instead.`,
    );
  });
  assert.equal(
    MIGRATIONS.length,
    FINGERPRINTS.length,
    'New migration without a fingerprint: add its SHA-256 to FINGERPRINTS in this test.',
  );
});

// Representative rows; only the columns that exist at a given version are written.
const OLD_RESULT = {
  assetIds: ['a1', 'a2'],
  caption: 'Old caption',
  reason: 'Old reason',
  song: { title: 'Old', artist: 'Song', clip: { startSec: 10, endSec: 25, estimated: false } },
  modelName: 'Old model',
};
const OLD_REQUEST = {
  from: '2026-10-20',
  to: '2026-10-20',
  format: 'carousel',
  maxPhotos: 3,
  accountId: 'acc',
};
const ROWS: Record<string, Record<string, string | number | null>> = {
  users: {
    id: 'u1',
    identity: 'google-sub-1',
    email: 'keep@example.com',
    name: 'Keep Me',
    picture: null,
    ntfy_topic: 'postitup-abc',
    settings: JSON.stringify({ onboarded: true, reminder: { hour: 20, minute: 0 }, accounts: [] }),
    openrouter_key: null,
    spotify_tokens: 'v1:encrypted',
    spotify_profile: JSON.stringify({ displayName: 'Keeper' }),
    created_at: 1700000000000,
    spotify_access: JSON.stringify({ status: 'approved', spotifyEmail: 'k@sp.com', at: 1 }),
  },
  sessions: { token_hash: 'h1', user_id: 'u1', created_at: 1, expires_at: 9999999999999 },
  jobs: {
    id: 'j1',
    user_id: 'u1',
    created_at: 1,
    updated_at: 2,
    request: JSON.stringify(OLD_REQUEST),
    candidates: JSON.stringify([{ id: 'a1', takenAt: 1 }]),
    status: 'ready',
    progress: null,
    error: null,
    result: JSON.stringify(OLD_RESULT),
    finished_at: 3,
    images_deleted: 0,
    prompt_versions: JSON.stringify({ final_post: 1 }),
  },
  job_usage: { user_id: 'u1', day: '2026-10-20', count: 3, music_changes: 1 },
  server_settings: { key: 'dailyJobLimit', value: '20' },
  prompt_versions: {
    key: 'final_post',
    version: 1,
    body: 'Body v1',
    note: 'Default',
    created_at: 1,
  },
  prompt_active: { key: 'final_post', version: 1 },
  ai_calls: {
    id: 'c1',
    job_id: 'j1',
    user_id: 'u1',
    prompt_key: 'final_post',
    model: 'm',
    prompt_tokens: 10,
    completion_tokens: 2,
    cost_usd: 0.01,
    created_at: 5,
    routed_model: null,
  },
  admin_account: {
    id: 1,
    username: 'Admin',
    password_hash: 'scrypt$x',
    weak_password: 0,
    updated_at: 1,
  },
  integration_calls: {
    id: 'i1',
    at: 5,
    integration: 'spotify',
    operation: 'search',
    user_id: 'u1',
    job_id: 'j1',
    method: 'GET',
    path: 'api.spotify.com/v1/search',
    status_code: 200,
    ok: 1,
    duration_ms: 12,
    cost_usd: null,
    error: null,
    model: null,
  },
};

function seed(db: DatabaseSync) {
  const counts: Record<string, number> = {};
  for (const [table, row] of Object.entries(ROWS)) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    if (cols.length === 0) continue; // table doesn't exist yet at this version
    const keys = Object.keys(row).filter((k) => cols.includes(k));
    db.prepare(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    ).run(...keys.map((k) => row[k]));
    counts[table] = 1;
  }
  return counts;
}

test('upgrading from every version keeps the data (and backs up first)', () => {
  for (let k = 0; k <= MIGRATIONS.length; k++) {
    const dir = freshDir();
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 0, k);
    assert.equal(schemaVersion(db), k);
    const counts = seed(db);

    // A file-backed copy so VACUUM INTO has a real database to copy.
    const file = path.join(tmp, `v${k}-${n}.db`);
    db.exec(`VACUUM INTO '${file}'`);
    db.close();
    const live = new DatabaseSync(file);
    const outcome = prepareDatabase(live, dir);

    assert.equal(schemaVersion(live), MIGRATIONS.length, `from v${k}`);
    if (k > 0 && k < MIGRATIONS.length) {
      assert.ok(outcome.backup, `backup made before migrating from v${k}`);
      assert.match(
        path.basename(outcome.backup),
        new RegExp(`-v${k}-to-v${MIGRATIONS.length}\\.db$`),
      );
      const copy = new DatabaseSync(outcome.backup);
      assert.equal(schemaVersion(copy), k, 'backup holds the pre-migration schema');
      copy.close();
    } else {
      assert.equal(
        outcome.backup,
        null,
        k === 0 ? 'no backup of an empty database' : 'nothing to do',
      );
    }
    for (const table of Object.keys(counts)) {
      const c = (live.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
      assert.equal(c, 1, `${table} rows survive the upgrade from v${k}`);
    }
    if (counts.users) {
      const u = live.prepare('SELECT email, settings, spotify_tokens FROM users').get() as Record<
        string,
        string
      >;
      assert.equal(u.email, 'keep@example.com');
      assert.equal((JSON.parse(u.settings) as { onboarded: boolean }).onboarded, true);
      assert.equal(u.spotify_tokens, 'v1:encrypted');
    }
    if (counts.jobs) {
      const j = live.prepare('SELECT request, result, status FROM jobs').get() as Record<
        string,
        string
      >;
      assert.equal(j.status, 'ready');
      const request = normalizeRequest(JSON.parse(j.request));
      const result = normalizeResult(JSON.parse(j.result), request);
      assert.equal(result.posts[0].caption, 'Old caption', 'old single-post job reads as posts[0]');
      assert.deepEqual(result.posts[0].assetIds, ['a1', 'a2']);
      assert.equal(result.posts[0].song.clip?.lengthSec, 15);
    }
    live.close();
  }
});

test('backups: newest 10 kept; a failed backup stops the migration', () => {
  const dir = freshDir();
  const file = path.join(tmp, 'retention.db');
  const db = new DatabaseSync(file);
  runMigrations(db, 0, 3);
  for (let i = 0; i < 12; i++) {
    const made = backupDatabase(db, dir, `manual-${String(i).padStart(2, '0')}`);
    assert.ok(made);
  }
  assert.equal(listBackups(dir).length, BACKUPS_KEEP);

  // backups/ is a file → the backup can't be written → no migration happens.
  const blocked = freshDir();
  mkdirSync(blocked, { recursive: true });
  writeFileSync(path.join(blocked, 'backups'), 'not a directory');
  assert.throws(
    () => prepareDatabase(db, blocked),
    /Not migrating: the pre-migration backup failed/,
  );
  assert.equal(schemaVersion(db), 3, 'schema untouched when the backup fails');
  db.close();
});

test('downgrade guard: refuses a database from a newer server', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, 0);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  assert.throws(
    () => prepareDatabase(db, freshDir()),
    new RegExp(
      `Database is from a newer server version \\(v${MIGRATIONS.length + 1}\\) than this code \\(v${MIGRATIONS.length}\\)`,
    ),
  );
  db.close();
});

test('permissions: data dir, database, backups owner-only', () => {
  const dir = freshDir();
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  chmodSync(dir, 0o755);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  runMigrations(db, 0, 2);
  const backup = backupDatabase(db, dir, 'manual');
  assert.equal(statSync(backup).mode & 0o777, 0o600, 'new backups are 0600');
  chmodSync(path.join(dir, 'app.db'), 0o644);
  chmodSync(backup, 0o644);
  const changed = tightenPermissions(dir);
  assert.ok(changed.length >= 3);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(dir, 'app.db')).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(dir, 'backups')).mode & 0o777, 0o700);
  assert.equal(statSync(backup).mode & 0o777, 0o600);
  assert.deepEqual(tightenPermissions(dir), [], 'nothing to do the second time');
  db.close();
});

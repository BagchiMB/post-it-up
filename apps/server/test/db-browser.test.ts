// Admin database browser: read-only connection, statement allowlist, secret masking (browse,
// console, CSV, audit), write mode (backup + audit) and the WHERE-less write guard. No network.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dataDir = mkdtempSync(path.join(tmpdir(), 'postitup-dbadmin-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_USERNAME = 'Tester';
process.env.ADMIN_PASSWORD = 'correct horse battery';
process.env.OPENROUTER_API_KEY = 'sk-or-v1-secret-test-value';
process.env.APP_BUNDLE_ID = 'com.example.test';

type Browser = typeof import('../src/admin/db-browser.ts');
let b: Browser;
let app: import('hono').Hono<{ Variables: { adminSession: string } }>;

before(async () => {
  (await import('../src/server-settings.ts')).seedServerSettings();
  (await import('../src/admin/account.ts')).seedAdminAccount();
  const { run } = await import('../src/db.ts');
  const { encrypt } = await import('../src/crypto.ts');
  run(
    `INSERT INTO users (id, identity, email, name, ntfy_topic, settings, spotify_tokens, created_at)
     VALUES ('u1', 'dev:a@x.y', 'a@x.y', 'Ann', 't1', '{"onboarded":true}', ?, 1),
            ('u2', 'dev:b@x.y', 'b@x.y', 'Bob', 't2', '{"onboarded":false}', NULL, 2)`,
    encrypt('{"accessToken":"spotify-secret"}', 'u1:spotify'),
  );
  run(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('deadbeefcafe', 'u1', 1, 9999999999999)",
  );
  b = await import('../src/admin/db-browser.ts');
  const { Hono } = await import('hono');
  const { dbApi } = await import('../src/admin/db-api.ts');
  const { ApiError } = await import('../src/http.ts');
  app = new Hono<{ Variables: { adminSession: string } }>();
  app.use('*', async (c, next) => {
    c.set('adminSession', 'test-session-cookie');
    await next();
  });
  app.route('/db', dbApi);
  app.onError((err, c) =>
    c.json({ error: err.message }, err instanceof ApiError ? (err.status as 400) : 500),
  );
});

after(() => {
  b?.closeDbBrowser();
  rmSync(dataDir, { recursive: true, force: true });
});

const post = (url: string, body: unknown, method = 'POST') =>
  app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the browsing connection is read-only', () => {
  assert.throws(() => b.readDb().exec("UPDATE users SET name = 'x'"), /readonly|not authorized/i);
  assert.throws(() => b.readDb().exec('DELETE FROM users'), /readonly|not authorized/i);
});

test('console allowlist blocks dangerous and multi-statement SQL', async () => {
  const blocked = [
    "ATTACH DATABASE '/tmp/x.db' AS x",
    'DETACH x',
    'PRAGMA user_version = 99',
    'DROP TABLE users',
    'CREATE TABLE t (a)',
    'ALTER TABLE users ADD COLUMN x',
    'VACUUM',
    "SELECT load_extension('evil')",
    'SELECT 1; SELECT 2',
    'SELECT 1; DELETE FROM users',
    'REPLACE INTO users (id) VALUES (1)',
  ];
  for (const sql of blocked)
    assert.throws(() => b.classifyStatement(sql), /allowed|one statement|internal tables/, sql);
  assert.equal(
    b.classifyStatement("SELECT ';' AS semi -- trailing; comment").kind,
    'read',
    'semicolons in strings/comments are fine',
  );
  assert.equal(b.classifyStatement('SELECT 1;').kind, 'read', 'one trailing semicolon is fine');
  await assert.rejects(b.runReadQuery("DELETE FROM users WHERE id = 'u2'"), /write mode/);
  await assert.rejects(b.runReadQuery("SELECT load_extension('x')"), /isn’t allowed/);
  const r = await b.runReadQuery('SELECT COUNT(*) AS n FROM users');
  assert.deepEqual(r.rows, [[2]]);
});

test('secrets are masked in browse, row view, console and CSV; explicit selection is refused', async () => {
  const users = b.browse('users', { filters: [] });
  const ann = users.rows.find((r) => r.id === 'u1')!;
  assert.equal(ann.spotify_tokens, b.MASK);
  assert.equal(ann.email, 'a@x.y');
  const settings = b.browse('server_settings', {
    filters: [{ column: 'key', op: 'eq', value: 'openRouterKey' }],
  });
  assert.equal(settings.rows[0].value, b.MASK, 'encrypted setting masked');
  assert.equal(b.browse('sessions', { filters: [] }).rows[0].token_hash, b.MASK);
  assert.equal(b.browse('admin_account', { filters: [] }).rows[0].password_hash, b.MASK);
  assert.throws(
    () =>
      b.browse('sessions', { filters: [{ column: 'token_hash', op: 'contains', value: 'dead' }] }),
    /secret/,
  );

  const star = await b.runReadQuery('SELECT * FROM users ORDER BY id');
  const col = star.columns.indexOf('spotify_tokens');
  assert.equal(star.rows[0][col], b.MASK);
  const csv = b.toCsv(star);
  assert.ok(
    !csv.includes('v1:') && !csv.includes('spotify-secret') && csv.includes(b.MASK),
    'CSV masked',
  );
  const sess = await b.runReadQuery('SELECT * FROM sessions');
  assert.ok(!JSON.stringify(sess.rows).includes('deadbeef'));
  await assert.rejects(b.runReadQuery('SELECT token_hash FROM sessions'), /secret column/);
  await assert.rejects(
    b.runReadQuery("SELECT id FROM sessions WHERE token_hash LIKE 'd%'"),
    /secret column/,
  );
  const viaApi = (await (await app.request('/db/tables/users/rows/1')).json()) as {
    row: Record<string, unknown>;
  };
  assert.equal(viaApi.row.spotify_tokens, b.MASK);
});

test('write mode: password, backup before the first write, preview + confirm, audit (masked)', async () => {
  let res = await post('/db/query', { sql: "UPDATE users SET name = 'Annie' WHERE id = 'u1'" });
  assert.equal(res.status, 403, 'writes need write mode');
  res = await post('/db/write-mode', { password: 'nope' });
  assert.equal(res.status, 403, 'wrong password is 403 (401 means the admin session is gone)');
  res = await post('/db/write-mode', { password: 'correct horse battery' });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { on: boolean }).on, true);

  const { listBackups } = await import('../src/migrations.ts');
  const backupsBefore = listBackups(dataDir).length;
  res = await post('/db/query', { sql: "UPDATE users SET name = 'Annie' WHERE id = 'u1'" });
  const preview = (await res.json()) as {
    kind: string;
    preview: { affected: number };
    confirmToken: string;
  };
  assert.equal(preview.kind, 'preview');
  assert.equal(preview.preview.affected, 1, 'COUNT preview');
  res = await post('/db/query', {
    sql: "UPDATE users SET name = 'Annie' WHERE id = 'u1'",
    confirmToken: 'forged',
  });
  assert.equal(res.status, 409, 'unknown token refused');
  res = await post('/db/query', {
    sql: "UPDATE users SET name = 'Annie' WHERE id = 'u1'",
    confirmToken: preview.confirmToken,
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { changes: number }).changes, 1);

  const backups = listBackups(dataDir);
  assert.equal(backups.length, backupsBefore + 1, 'one backup before the first write');
  assert.match(backups[0].name, /-dbadmin\.db$/);
  const audit = (await (await app.request('/db/audit?table=users')).json()) as {
    action: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    admin: string;
  }[];
  assert.equal(audit[0].action, 'update');
  assert.equal(audit[0].admin, 'Tester');
  assert.equal(audit[0].before.name, 'Ann');
  assert.equal(audit[0].after.name, 'Annie');
  assert.equal(audit[0].before.spotify_tokens, b.MASK, 'audit before masked');
  assert.equal(audit[0].after.spotify_tokens, b.MASK, 'audit after masked');

  // Second write in the same window: no extra backup.
  res = await post('/db/tables/users/rows/2', { values: { name: 'Bobby' } }, 'PATCH');
  const t = ((await res.json()) as { confirmToken: string }).confirmToken;
  res = await post(
    '/db/tables/users/rows/2',
    { values: { name: 'Bobby' }, confirmToken: t },
    'PATCH',
  );
  assert.equal(res.status, 200);
  assert.equal(listBackups(dataDir).length, backupsBefore + 1);

  res = await post('/db/tables/users/rows/1', { values: { spotify_tokens: 'x' } }, 'PATCH');
  const t2 = ((await res.json()) as { confirmToken?: string }).confirmToken;
  res = await post(
    '/db/tables/users/rows/1',
    { values: { spotify_tokens: 'x' }, confirmToken: t2 },
    'PATCH',
  );
  assert.equal(res.status, 400, 'secret columns not editable');
  res = await post('/db/tables/users/rows/1', { values: { settings: '{bad json' } }, 'PATCH');
  const t3 = ((await res.json()) as { confirmToken?: string }).confirmToken;
  res = await post(
    '/db/tables/users/rows/1',
    { values: { settings: '{bad json' }, confirmToken: t3 },
    'PATCH',
  );
  assert.equal(res.status, 400, 'JSON validated');
  res = await post('/db/query', { sql: "UPDATE users SET spotify_tokens = NULL WHERE id = 'u1'" });
  assert.equal(res.status, 400, 'console cannot write secret columns');
});

test('WHERE-less DELETE is refused without affectAll', async () => {
  let res = await post('/db/write-mode', { password: 'correct horse battery' });
  assert.equal(res.status, 200, await res.clone().text());
  res = await post('/db/query', { sql: 'DELETE FROM sessions' });
  const p = (await res.json()) as {
    preview: { affected: number; needsAffectAll: boolean };
    confirmToken: string;
  };
  assert.equal(p.preview.needsAffectAll, true);
  assert.equal(p.preview.affected, 1);
  res = await post('/db/query', { sql: 'DELETE FROM sessions', confirmToken: p.confirmToken });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /affectAll/);
  const left = await b.runReadQuery('SELECT COUNT(*) FROM sessions');
  assert.deepEqual(left.rows, [[1]], 'nothing deleted');

  res = await post('/db/query', { sql: 'DELETE FROM sessions' });
  const p2 = (await res.json()) as { confirmToken: string };
  res = await post('/db/query', {
    sql: 'DELETE FROM sessions',
    confirmToken: p2.confirmToken,
    affectAll: true,
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await b.runReadQuery('SELECT COUNT(*) FROM sessions')).rows, [[0]]);

  res = await post('/db/query', { sql: 'DELETE FROM db_audit' });
  assert.equal(res.status, 400, 'the audit log is protected');
  await app.request('/db/write-mode', { method: 'DELETE' });
  res = await post('/db/query', { sql: "DELETE FROM users WHERE id = 'u2'" });
  assert.equal(res.status, 403, 'write mode can be turned off');
});

test('structure, relations (declared + inferred) and tables overview', async () => {
  const s = (await (await app.request('/db/tables/sessions/structure')).json()) as {
    columns: { name: string; masked: boolean; primaryKey: boolean }[];
  };
  assert.ok(s.columns.find((c) => c.name === 'token_hash')?.masked);
  assert.ok(s.columns.find((c) => c.name === 'token_hash')?.primaryKey);
  const r = (await (await app.request('/db/relations')).json()) as {
    relations: { from: string; fromColumn: string; to: string; inferred: boolean }[];
  };
  assert.ok(
    r.relations.some((x) => x.from === 'sessions' && x.to === 'users' && !x.inferred),
    'declared FK',
  );
  assert.ok(
    r.relations.some(
      (x) => x.from === 'ai_calls' && x.fromColumn === 'job_id' && x.to === 'jobs' && x.inferred,
    ),
    'inferred link',
  );
  const t = (await (await app.request('/db/tables')).json()) as {
    tables: { name: string; rows: number }[];
    schemaVersion: number;
  };
  assert.ok(t.tables.some((x) => x.name === 'users' && x.rows === 2));
  assert.ok(t.schemaVersion >= 11);
});

test('login-status is public; integrations expose the app bundle ID', async () => {
  const { Hono } = await import('hono');
  const { adminRoutes } = await import('../src/admin/index.ts');
  const { ApiError } = await import('../src/http.ts');
  const root = new Hono();
  root.route('/admin', adminRoutes);
  root.onError((err, c) =>
    c.json({ error: err.message }, err instanceof ApiError ? (err.status as 401) : 500),
  );
  const res = await root.request('/admin/api/login-status');
  assert.equal(res.status, 200, 'no session needed');
  assert.deepEqual(await res.json(), { enabled: true });
  assert.equal(
    (await root.request('/admin/api/session')).status,
    401,
    'everything else needs a session',
  );

  const { adminApi } = await import('../src/admin/api.ts');
  const api = new Hono<{ Variables: { adminSession: string } }>();
  api.route('/api', adminApi);
  const body = (await (await api.request('/api/integrations')).json()) as {
    spotify: { appBundleId?: string };
  };
  assert.equal(body.spotify.appBundleId, 'com.example.test');
});

test('console worker runs when the server was started with --watch (dev command)', async () => {
  assert.deepEqual(
    b.workerExecArgv([
      '--disable-warning=ExperimentalWarning',
      '--watch',
      '--watch-path',
      'src',
      '--watch-preserve-output',
      '--import',
      'tsx',
    ]),
    ['--disable-warning=ExperimentalWarning', '--import', 'tsx'],
  );
  // The real dev command: `node --watch --import tsx …` (watch mode also posts loader messages
  // on the worker channel). Run a console query in such a process and read its answer.
  const { spawn } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const probe = path.join(dataDir, 'probe.mts');
  const browser = pathToFileURL(path.resolve('src/admin/db-browser.ts')).href;
  writeFileSync(
    probe,
    `const b = await import(${JSON.stringify(browser)});
     try { const r = await b.runReadQuery('SELECT 1 AS a'); process.stdout.write('RESULT ' + JSON.stringify(r.rows) + '\\n'); }
     catch (e) { process.stdout.write('FAILED ' + (e as Error).message + '\\n'); }`,
  );
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--watch', '--import', 'tsx', probe],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const line = await new Promise<string>((resolve) => {
    let out = '';
    const done = (v: string) => {
      child.kill();
      resolve(v);
    };
    const timer = setTimeout(() => done(`TIMEOUT ${out}`), 20_000);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      const m = /(RESULT|FAILED) [^\n]*/.exec(out);
      if (m) {
        clearTimeout(timer);
        done(m[0]);
      }
    });
  });
  assert.equal(line, 'RESULT [[1]]');
});

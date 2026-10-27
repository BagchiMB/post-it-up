// Integration-call logging: redaction, a failing (faked) Spotify call, and combined log filters.
// Run: npm test   (uses a throwaway DATA_DIR; no network)
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

/** The URL a fetch fake was called with. */
const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();

const dataDir = mkdtempSync(path.join(tmpdir(), 'postitup-test-'));
process.env.DATA_DIR = dataDir;
process.env.SPOTIFY_CLIENT_ID = 'testclientid0000000000000000000';
process.env.SPOTIFY_CLIENT_SECRET = 'testclientsecret00000000000000';

type Mods = {
  outbound: typeof import('../src/outbound.ts');
  settings: typeof import('../src/server-settings.ts');
  spotify: typeof import('../src/spotify.ts');
  users: typeof import('../src/users.ts');
};
let m: Mods;
const realFetch = globalThis.fetch;

before(async () => {
  m = {
    outbound: await import('../src/outbound.ts'),
    settings: await import('../src/server-settings.ts'),
    spotify: await import('../src/spotify.ts'),
    users: await import('../src/users.ts'),
  };
  m.settings.seedServerSettings();
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

test('redacts token-like strings in errors', () => {
  const r = m.outbound.redact(
    'failed: Authorization: Bearer abc.def.ghi sk-or-v1-0123456789abcdef access_token=xyz123 and AQB9x8y7z6w5v4u3t2s1r0q9p8o7n6m5',
  );
  assert.ok(!r.includes('abc.def.ghi'));
  assert.ok(!r.includes('sk-or-v1-0123456789abcdef'));
  assert.ok(!r.includes('xyz123'));
  assert.ok(!r.includes('AQB9x8y7z6w5v4u3t2s1r0q9p8o7n6m5'));
  assert.match(r, /\[redacted\]/);
  assert.ok(m.outbound.redact('x'.repeat(1000)).length <= 300);
});

test('a failing Spotify call is logged as failed, without query string or secrets', async () => {
  const { id: userId } = m.users.upsertUser('dev:logs@example.com', { email: 'logs@example.com' });
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = urlOf(input);
    if (url.includes('accounts.spotify.com')) {
      return new Response(JSON.stringify({ access_token: 'app-token', expires_in: 3600 }), {
        status: 200,
      });
    }
    return new Response('{"error":{"status":503}}', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  };

  await assert.rejects(
    m.outbound.callContext.run({ userId, jobId: 'job-123' }, () =>
      m.spotify.findTrack(userId, 'Secret Song', 'Artist'),
    ),
  );
  const { rows } = m.outbound.queryLogs({ integrations: ['spotify'], ok: 'failed' });
  const row = rows.find((r) => r.operation === 'search');
  assert.ok(row, 'search call logged');
  assert.equal(row.ok, false);
  assert.equal(row.statusCode, 503);
  assert.equal(row.userEmail, 'logs@example.com');
  assert.equal(row.jobId, 'job-123');
  assert.equal(row.path, 'api.spotify.com/v1/search'); // no query string (would contain the song)
  assert.ok(!JSON.stringify(row).includes('Secret'));
  assert.ok(!JSON.stringify(rows).includes('app-token'));

  const tokenCall = m.outbound.queryLogs({ integrations: ['spotify'], operation: 'token' }).rows[0];
  assert.ok(tokenCall?.ok, 'token call logged as ok');
});

test('network errors are logged with a redacted message', async () => {
  globalThis.fetch = async () => {
    throw new Error('connect failed for Bearer supersecrettoken123456789');
  };
  await assert.rejects(
    m.outbound.outbound(
      { integration: 'lrclib', operation: 'lyrics_get' },
      'https://lrclib.net/api/get?track_name=x',
    ),
  );
  const row = m.outbound.queryLogs({ integrations: ['lrclib'] }).rows[0];
  assert.equal(row.ok, false);
  assert.equal(row.statusCode, null);
  assert.ok(row.error && !row.error.includes('supersecrettoken'));
  assert.equal(row.path, 'lrclib.net/api/get');
});

test('filters combine (integration + result + user + operation + task + dates) and paginate', async () => {
  globalThis.fetch = async (input: string | URL | Request) =>
    new Response('{}', { status: urlOf(input).includes('fail') ? 500 : 200 });
  const { id: a } = m.users.upsertUser('dev:a@example.com', { email: 'a@example.com' });
  const { id: b } = m.users.upsertUser('dev:b@example.com', { email: 'b@example.com' });
  const call = (
    userId: string,
    jobId: string,
    integration: 'ntfy' | 'google',
    op: string,
    url: string,
  ) =>
    m.outbound.callContext.run({ userId, jobId }, () =>
      m.outbound.outbound({ integration, operation: op }, url),
    );
  for (let i = 0; i < 3; i++) await call(a, 'job-a', 'ntfy', 'push', 'https://ntfy.example/ok');
  await call(a, 'job-a', 'ntfy', 'push', 'https://ntfy.example/fail');
  await call(b, 'job-b', 'ntfy', 'push', 'https://ntfy.example/fail');
  await call(b, 'job-b', 'google', 'jwks', 'https://google.example/fail');

  const q = m.outbound.queryLogs;
  assert.equal(q({ integrations: ['ntfy'] }).rows.length, 5);
  assert.equal(q({ integrations: ['ntfy', 'google'], ok: 'failed' }).rows.length, 3);
  assert.equal(q({ integrations: ['ntfy'], ok: 'failed', user: 'a@' }).rows.length, 1);
  assert.equal(q({ integrations: ['ntfy'], ok: 'ok', job: 'job-a' }).rows.length, 3);
  assert.equal(q({ ok: 'failed', operation: 'jwks', user: 'b@example' }).rows.length, 1);
  assert.equal(q({ integrations: ['google'], user: 'a@' }).rows.length, 0);
  assert.equal(q({ integrations: ['ntfy'], from: Date.now() + 60_000 }).rows.length, 0);
  assert.equal(q({ integrations: ['ntfy'], to: Date.now() - 86_400_000 }).rows.length, 0);

  const page1 = q({ integrations: ['ntfy'], limit: 2 });
  assert.equal(page1.rows.length, 2);
  assert.ok(page1.nextCursor);
  const page2 = q({ integrations: ['ntfy'], limit: 2, cursor: page1.nextCursor });
  const page3 = q({ integrations: ['ntfy'], limit: 2, cursor: page2.nextCursor! });
  const ids = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.id);
  assert.equal(new Set(ids).size, 5);
  assert.equal(page3.nextCursor, null);
});

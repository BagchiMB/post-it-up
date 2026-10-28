// OpenRouter balance alerts: balance status from account credits (never the key limit), and
// insufficient-credits (402) responses classified as out_of_credits. Faked network only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type { Job } from '@postitup/shared';

const dataDir = mkdtempSync(path.join(tmpdir(), 'postitup-balance-'));
process.env.DATA_DIR = dataDir;
process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-not-real';
process.env.OPENROUTER_DEFAULT_MODEL = 'test/vision';
process.env.SPOTIFY_CLIENT_ID = '';
process.env.SPOTIFY_CLIENT_SECRET = '';
process.env.NTFY_URL = 'http://ntfy.invalid';

const realFetch = globalThis.fetch;
const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

/** Account credits per key: key → [total, used]. */
const ACCOUNTS: Record<string, [number, number]> = {
  'sk-or-v1-test-not-real': [10, 10],
  'key-empty': [5, 5],
  'key-low': [5, 4],
  'key-ok': [50, 1],
};
let creditsCalls = 0;

before(() => {
  globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(urlOf(input));
    const auth = new Headers(init.headers).get('authorization')?.replace('Bearer ', '') ?? '';
    if (url.pathname === '/api/v1/credits') {
      creditsCalls++;
      const [total, used] = ACCOUNTS[auth] ?? [0, 0];
      return json({ data: { total_credits: total, total_usage: used } });
    }
    if (url.pathname === '/api/v1/key')
      return json({ data: { usage: 0, limit: 100, limit_remaining: 100, is_free_tier: false } });
    if (url.pathname === '/api/v1/models') {
      return json({
        data: [
          {
            id: 'test/vision',
            name: 'Test Vision',
            pricing: { prompt: '0.000001', completion: '0.000001' },
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['structured_outputs'],
          },
        ],
      });
    }
    if (url.pathname === '/api/v1/chat/completions') {
      return json(
        {
          error: {
            code: 402,
            message: 'Insufficient credits. Add more using https://openrouter.ai/credits',
          },
        },
        402,
      );
    }
    return json({}, 599);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

test('balance status uses the account balance and the low-balance threshold', async () => {
  (await import('../src/server-settings.ts')).seedServerSettings();
  const { balanceStatus, credits } = await import('../src/openrouter.ts');
  // The cache holds the last key looked up, so check each right after its lookup.
  await credits('key-empty');
  assert.equal(balanceStatus('key-empty', 2).status, 'empty');
  await credits('key-low');
  assert.equal(balanceStatus('key-low', 2).status, 'low');
  assert.equal(balanceStatus('key-low', 2).balanceUsd, 1);
  assert.equal(balanceStatus('key-low', 2).keyLimitUsd, 100, 'key limit reported separately');
  assert.equal(balanceStatus('key-low', 0.5).status, 'ok', 'threshold applies');
  await credits('key-ok');
  assert.equal(balanceStatus('key-ok', 2).status, 'ok');
  assert.equal(balanceStatus('never-looked-up', 2).status, 'unknown');
});

test('a 402 fails the job with a generic message, marks the log row and refreshes the balance', async () => {
  (await import('../src/prompts.ts')).seedPrompts();
  const users = await import('../src/users.ts');
  const { id: userId } = users.upsertUser('dev:credits@example.com', {
    email: 'credits@example.com',
  });
  users.setSettings(userId, {
    onboarded: true,
    reminder: { hour: 9, minute: 0 },
    accounts: [
      { id: 'a1', handle: 'me', tone: 'casual', emojis: false, hashtags: '', activeDays: [] },
    ],
  });
  const { Hono } = await import('hono');
  const { jobRoutes } = await import('../src/jobs.ts');
  const { ApiError } = await import('../src/http.ts');
  const app = new Hono<{ Variables: { userId: string; tokenHash: string } }>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    await next();
  });
  app.route('/jobs', jobRoutes);
  app.onError((err, c) =>
    c.json({ error: err.message }, err instanceof ApiError ? (err.status as 400) : 500),
  );

  const before = creditsCalls;
  const res = await app.request('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: {
        accountId: 'a1',
        from: '2026-10-27',
        to: '2026-10-27',
        music: { source: 'ai' },
        posts: [{ kind: 'people', format: 'single', maxPhotos: 1 }],
      },
      candidates: [{ id: 'p1', takenAt: 1 }],
      images: ['/9j/2Q=='],
    }),
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as Job;
  let job: Job | undefined;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 20));
    job = (await (await app.request(`/jobs/${id}`)).json()) as Job;
    if (job.status === 'failed' || job.status === 'ready') break;
  }
  assert.equal(job?.status, 'failed');
  assert.equal(
    job?.error,
    'The AI service is temporarily unavailable. Try again later.',
    'no billing details for users',
  );

  const { queryLogs, outOfCreditsState } = await import('../src/outbound.ts');
  const row = queryLogs({ integrations: ['openrouter'], operation: 'chat', job: id }).rows[0];
  assert.equal(row.statusCode, 402);
  assert.match(row.error ?? '', /^out_of_credits/);
  assert.ok(outOfCreditsState(), 'Overview signal: AI calls failing');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(creditsCalls > before, 'balance re-read after the failure');
  const { balanceStatus } = await import('../src/openrouter.ts');
  assert.equal(balanceStatus('sk-or-v1-test-not-real', 2).status, 'empty');
});

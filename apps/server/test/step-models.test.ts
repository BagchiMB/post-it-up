// Models per AI step: vision guard, reset to default, and the effective model used by each step;
// auto-routers record the model they picked. Faked network only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

/** The URL a fetch fake was called with. */
const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();

/** The parts of an OpenRouter chat request these fakes read. */
type ChatBody = {
  model: string;
  response_format?: { json_schema?: { name?: string } };
  messages: { content: { type: string; text?: string }[] }[];
};

const dataDir = mkdtempSync(path.join(tmpdir(), 'postitup-steps-'));
process.env.DATA_DIR = dataDir;
process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-not-real';
process.env.OPENROUTER_DEFAULT_MODEL = 'vendor/default-vision';
process.env.SPOTIFY_CLIENT_ID = '';
process.env.SPOTIFY_CLIENT_SECRET = '';
const realFetch = globalThis.fetch;
const calls: { step: string | undefined; model: string }[] = [];

const MODELS = [
  {
    id: 'vendor/default-vision',
    name: 'Default Vision',
    pricing: { prompt: '0.000001', completion: '0.000002' },
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['structured_outputs'],
  },
  {
    id: 'vendor/cheap-vision',
    name: 'Cheap Vision',
    pricing: { prompt: '0.0000001', completion: '0.0000002' },
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['structured_outputs'],
  },
  {
    id: 'vendor/text-only',
    name: 'Text Only',
    pricing: { prompt: '0.0000001', completion: '0.0000001' },
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    supported_parameters: ['structured_outputs'],
  },
  {
    id: 'typesafe/jev-router',
    name: 'TypeSafe: Jev Router',
    pricing: { prompt: '-1', completion: '-1' },
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    supported_parameters: ['structured_outputs'],
  },
];

before(() => {
  globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(urlOf(input));
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/models')) return json({ data: MODELS });
    if (url.pathname.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body as string) as ChatBody;
      const step = body.response_format?.json_schema?.name;
      calls.push({ step, model: body.model });
      let content: unknown;
      if (step === 'shortlist') content = { picks: [1, 2] };
      else if (step === 'posts')
        content = {
          posts: [
            {
              post: 1,
              photos: [1],
              photoSummary: 's',
              reason: 'r',
              caption: 'c',
              song: { trackId: null, title: 'Song A', artist: 'Artist A' },
              fit: { score: 90, note: 'n' },
              alternative: { title: null, artist: null, fitScore: null, fitNote: null },
            },
          ],
        };
      else if (step === 'clip') content = { startIndex: 1, lengthSec: 15 };
      else content = { startSec: 20, lengthSec: 15 };
      // A router answers with the model it picked.
      const answered = body.model === 'typesafe/jev-router' ? 'vendor/cheap-vision' : body.model;
      return json({
        model: answered,
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.001 },
      });
    }
    if (url.host === 'lrclib.net') {
      const lrc = { duration: 200, syncedLyrics: '[00:10.00] a\n[00:20.00] b' };
      return url.pathname.endsWith('/get') ? json(lrc) : json([lrc]);
    }
    return json({}, 599);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

async function adminApp() {
  const settings = await import('../src/server-settings.ts');
  settings.seedServerSettings();
  (await import('../src/prompts.ts')).seedPrompts();
  const { Hono } = await import('hono');
  const { adminApi } = await import('../src/admin/api.ts');
  const { ApiError } = await import('../src/http.ts');
  const app = new Hono<{ Variables: { adminSession: string } }>();
  app.route('/api', adminApi);
  app.onError((err, c) =>
    c.json({ error: err.message }, err instanceof ApiError ? (err.status as 400) : 500),
  );
  const put = (body: unknown) =>
    app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { app, put, settings };
}

test('vision guard, text model for a text step, reset to default', async () => {
  const { app, put, settings } = await adminApp();
  let res = await put({ stepModels: { final_post: { id: 'vendor/text-only' } } });
  assert.equal(res.status, 400, 'photo step rejects a text-only model');
  assert.match(((await res.json()) as { error: string }).error, /image-capable/);
  res = await put({ stepModels: { song_change: { id: 'vendor/text-only' } } });
  assert.equal(res.status, 200, 'text step accepts it');
  assert.equal(settings.serverSettings().stepModels.song_change?.name, 'Text Only');
  res = await put({ stepModels: { song_change: null } });
  assert.equal(res.status, 200);
  assert.equal(
    settings.serverSettings().stepModels.song_change,
    undefined,
    'null resets to default',
  );
  res = await put({ stepModels: { nope: null } });
  assert.equal(res.status, 400);

  const list = (await (await app.request('/api/models?vision=0')).json()) as {
    id: string;
    vision: boolean;
  }[];
  assert.ok(list.some((m) => m.id === 'vendor/text-only' && !m.vision));
  assert.ok(!list.some((m) => m.id === 'typesafe/jev-router'), 'routers hidden by default');
  const withRouters = (await (await app.request('/api/models?vision=0&routers=1')).json()) as {
    id: string;
    router?: boolean;
    inputPrice: number | null;
  }[];
  const router = withRouters.find((m) => m.id === 'typesafe/jev-router');
  assert.ok(router?.router && router.inputPrice === null, 'router listed with no price');

  const steps = (await (await app.request('/api/step-models')).json()) as {
    key: string;
    vision: boolean;
    model: unknown;
    effective: { id: string };
  }[];
  assert.equal(steps.length, 5);
  assert.ok(steps.find((s) => s.key === 'shortlist')?.vision);
  assert.ok(steps.every((s) => s.model === null && s.effective.id === 'vendor/default-vision'));
});

test('each step uses its effective model; modelName is the final_post model; routers record the picked model', async () => {
  const { put } = await adminApp();
  assert.equal(
    (
      await put({
        stepModels: {
          shortlist: { id: 'vendor/cheap-vision' },
          final_post: { id: 'typesafe/jev-router' },
          song_clip: { id: 'vendor/text-only' },
        },
      })
    ).status,
    200,
  );

  const users = await import('../src/users.ts');
  const { id: userId } = users.upsertUser('dev:steps@example.com', { email: 'steps@example.com' });
  users.setSettings(userId, {
    onboarded: true,
    reminder: { hour: 9, minute: 0 },
    accounts: [
      { id: 'a1', handle: 'me', tone: 'casual', emojis: false, hashtags: '', activeDays: [] },
    ],
  });
  const dir = path.join(dataDir, 'thumbs');
  mkdirSync(dir, { recursive: true });
  const candidates = Array.from({ length: 20 }, (_, i) => {
    const file = path.join(dir, `${i}.jpg`);
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return { id: `p${i}`, takenAt: i, file };
  });
  const { runPipeline } = await import('../src/pipeline.ts');
  const { callContext } = await import('../src/outbound.ts');
  calls.length = 0;
  const result = await callContext.run({ userId, jobId: 'steps-job' }, () =>
    runPipeline(
      userId,
      'steps-job',
      {
        accountId: 'a1',
        from: '2026-10-27',
        to: '2026-10-27',
        music: { source: 'ai' },
        posts: [{ kind: 'people', format: 'single', maxPhotos: 1 }],
      },
      candidates,
      () => {},
      {},
    ),
  );
  const byStep = (s: string) => [...new Set(calls.filter((c) => c.step === s).map((c) => c.model))];
  assert.deepEqual(byStep('shortlist'), ['vendor/cheap-vision']);
  assert.deepEqual(byStep('posts'), ['typesafe/jev-router']);
  assert.deepEqual(byStep('clip'), ['vendor/text-only']);
  assert.equal(result.modelName, 'TypeSafe: Jev Router');

  const { all } = await import('../src/db.ts');
  const routed = all<{ model: string; routed_model: string | null }>(
    "SELECT model, routed_model FROM ai_calls WHERE prompt_key = 'final_post'",
  );
  assert.deepEqual(
    routed.map((r) => [r.model, r.routed_model]),
    [['typesafe/jev-router', 'vendor/cheap-vision']],
  );
  const { queryLogs } = await import('../src/outbound.ts');
  const chat = queryLogs({ job: 'steps-job', operation: 'chat' }).rows;
  assert.ok(
    chat.some((r) => r.model === 'TypeSafe: Jev Router → vendor/cheap-vision'),
    'log row shows Router → model',
  );
});

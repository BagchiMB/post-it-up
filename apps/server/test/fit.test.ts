// Song fit score & alternative: low fit on a restricted source → alternative; high fit / free source → none;
// use-alternative swaps the song and 409s when there is none. Faked network only.
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

const dataDir = mkdtempSync(path.join(tmpdir(), 'postitup-fit-'));
process.env.DATA_DIR = dataDir;
process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-not-real';
process.env.OPENROUTER_DEFAULT_MODEL = 'test/vision';
process.env.SPOTIFY_CLIENT_ID = 'testclientid0000000000000000000';
process.env.SPOTIFY_CLIENT_SECRET = 'testclientsecret00000000000000';
const realFetch = globalThis.fetch;

let fitScore = 40;
let altTitle: string | null = 'Golden Hour';
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const track = (id: string, name: string, artist: string) => ({
  id,
  name,
  type: 'track',
  duration_ms: 200_000,
  artists: [{ name: artist }],
});

before(() => {
  globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(urlOf(input));
    if (url.host === 'openrouter.ai' && url.pathname.endsWith('/models')) {
      return json({
        data: [
          {
            id: 'test/vision',
            name: 'Test Vision',
            pricing: { prompt: '0.000001', completion: '0.000002' },
            architecture: { input_modalities: ['image'], output_modalities: ['text'] },
            supported_parameters: ['structured_outputs'],
          },
        ],
      });
    }
    if (url.host === 'openrouter.ai' && url.pathname.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body as string) as ChatBody;
      const name = body.response_format?.json_schema?.name;
      const text = body.messages[0].content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');
      const candidate =
        /\n(\w[\w-]*) \| [^\n]+ \| [^\n]+/.exec(text.slice(text.indexOf('SONG')))?.[1] ?? null;
      const alternative = altTitle
        ? { title: altTitle, artist: 'Other Artist', fitScore: 88, fitNote: 'Warm, sunny and easy' }
        : { title: null, artist: null, fitScore: null, fitNote: null };
      let content: unknown;
      if (name === 'posts') {
        content = {
          posts: [
            {
              post: 1,
              photos: [1],
              photoSummary: 'Friends at a sunny beach',
              reason: 'Bright and candid.',
              caption: 'Sun-drunk',
              song: { trackId: candidate, title: 'x', artist: 'y' },
              fit: { score: fitScore, note: 'Too moody for a sunny beach' },
              alternative,
            },
          ],
        };
      } else if (name === 'clip_estimate') content = { startSec: 30, lengthSec: 15 };
      else content = { startIndex: 1, lengthSec: 15 };
      return json({
        model: body.model,
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
      });
    }
    if (url.host === 'accounts.spotify.com') return json({ access_token: 'app', expires_in: 3600 });
    if (url.host === 'api.spotify.com' && url.pathname === '/v1/search') {
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('artist:"Moody Band"'))
        return json({
          tracks: {
            items:
              url.searchParams.get('offset') === '0'
                ? [track('m1', 'Rain Song', 'Moody Band')]
                : [],
          },
        });
      if (q.includes('Golden Hour'))
        return json({ tracks: { items: [track('g1', 'Golden Hour', 'Other Artist')] } });
      if (q.includes('Rain Song'))
        return json({ tracks: { items: [track('m1', 'Rain Song', 'Moody Band')] } });
      return json({ tracks: { items: [] } });
    }
    if (url.host === 'lrclib.net') return url.pathname.endsWith('/get') ? json({}, 404) : json([]);
    if (url.host === 'ntfy.sh') return new Response('ok');
    return json({}, 599);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

async function setupUser(email: string) {
  const settings = await import('../src/server-settings.ts');
  settings.seedServerSettings();
  (await import('../src/prompts.ts')).seedPrompts();
  const users = await import('../src/users.ts');
  const { id } = users.upsertUser(`dev:${email}`, { email });
  users.setSettings(id, {
    onboarded: true,
    reminder: { hour: 9, minute: 0 },
    accounts: [
      { id: 'a1', handle: 'me', tone: 'casual', emojis: false, hashtags: '', activeDays: [] },
    ],
  });
  return id;
}

function candidates() {
  const dir = path.join(dataDir, 'thumbs');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '0.jpg');
  writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return [{ id: 'p1', takenAt: 1, file }];
}

const req = (music: import('@postitup/shared').MusicChoice) => ({
  accountId: 'a1',
  from: '2026-10-27',
  to: '2026-10-27',
  music,
  posts: [{ kind: 'people' as const, format: 'single' as const, maxPhotos: 1 }],
});

test('low fit on a restricted source → alternative (matched, own fit + clip); none when fit is high or source is free', async () => {
  const userId = await setupUser('fit@example.com');
  const { runPipeline } = await import('../src/pipeline.ts');
  const artists = req({ source: 'artists', artists: [{ name: 'Moody Band' }] });

  fitScore = 40;
  altTitle = 'Golden Hour';
  let r = await runPipeline(userId, 'job-low', artists, candidates(), () => {}, {});
  const post = r.posts[0];
  assert.equal(post.song.spotifyId, 'm1', 'song from the candidate list');
  assert.deepEqual(post.song.fit, { score: 40, note: 'Too moody for a sunny beach' });
  assert.ok(post.alternative, 'alternative present');
  assert.equal(post.alternative.spotifyId, 'g1');
  assert.equal(post.alternative.fit?.score, 88);
  assert.ok(post.alternative.clip, 'alternative has its own clip');

  fitScore = 82;
  r = await runPipeline(userId, 'job-high', artists, candidates(), () => {}, {});
  assert.equal(r.posts[0].song.fit?.score, 82);
  assert.equal(r.posts[0].alternative, undefined, 'no alternative above the threshold');

  fitScore = 30;
  r = await runPipeline(userId, 'job-ai', req({ source: 'ai' }), candidates(), () => {}, {});
  assert.equal(r.posts[0].alternative, undefined, 'free (ai) source never gets an alternative');

  fitScore = 30;
  altTitle = 'Rain Song'; // the model "suggests" the same song → dropped
  r = await runPipeline(userId, 'job-same', artists, candidates(), () => {}, {});
  assert.equal(r.posts[0].alternative, undefined, 'alternative equal to the song is dropped');
  altTitle = 'Golden Hour';
});

test('use-alternative swaps the song (old one → previousSongs) and 409s when there is none', async () => {
  const userId = await setupUser('swap@example.com');
  const { Hono } = await import('hono');
  const { jobRoutes } = await import('../src/jobs.ts');
  const { run } = await import('../src/db.ts');
  const { ApiError } = await import('../src/http.ts');
  const app = new Hono<{ Variables: { userId: string; tokenHash: string } }>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    await next();
  });
  app.route('/jobs', jobRoutes);
  app.onError((err, c) =>
    c.json({ error: err.message }, err instanceof ApiError ? (err.status as 409) : 500),
  );

  const song = {
    title: 'Rain Song',
    artist: 'Moody Band',
    spotifyId: 'm1',
    fit: { score: 40, note: 'Too moody' },
  };
  const alternative = {
    title: 'Golden Hour',
    artist: 'Other Artist',
    spotifyId: 'g1',
    fit: { score: 88, note: 'Sunny' },
  };
  const result = {
    posts: [
      {
        kind: 'people',
        assetIds: ['p1'],
        caption: 'c',
        reason: 'r',
        photoSummary: 's',
        song,
        previousSongs: [],
        alternative,
      },
    ],
    modelName: 'm',
  };
  const request = {
    accountId: 'a1',
    from: '2026-10-27',
    to: '2026-10-27',
    music: { source: 'artists', artists: [{ name: 'Moody Band' }] },
    posts: [{ kind: 'people', format: 'single', maxPhotos: 1 }],
  };
  run(
    `INSERT INTO jobs (id, user_id, created_at, updated_at, request, candidates, status, result, finished_at)
       VALUES ('swapjob', ?, 1, 1, ?, '[]', 'ready', ?, 1)`,
    userId,
    JSON.stringify(request),
    JSON.stringify(result),
  );

  let res = await app.request('/jobs/swapjob/posts/0/use-alternative', { method: 'POST' });
  assert.equal(res.status, 200);
  const job = (await res.json()) as {
    result: {
      posts: {
        song: { spotifyId: string };
        previousSongs: { spotifyId: string }[];
        alternative?: unknown;
      }[];
    };
  };
  const p = job.result.posts[0];
  assert.equal(p.song.spotifyId, 'g1');
  assert.equal(p.previousSongs[0].spotifyId, 'm1');
  assert.equal(p.alternative, undefined);

  res = await app.request('/jobs/swapjob/posts/0/use-alternative', { method: 'POST' });
  assert.equal(res.status, 409);
  res = await app.request('/jobs/swapjob/posts/5/use-alternative', { method: 'POST' });
  assert.equal(res.status, 404);
});

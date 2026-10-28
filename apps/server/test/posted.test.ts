// Marking posts as posted: set/clear (idempotent), 409 unless ready, thumbnails deleted once every
// post is posted (retry then 410), and the admin counts. No network.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import type { Job } from '@postitup/shared';

const dataDir = mkdtempSync(path.join(tmpdir(), 'postitup-posted-'));
process.env.DATA_DIR = dataDir;

after(() => rmSync(dataDir, { recursive: true, force: true }));

async function setup() {
  (await import('../src/server-settings.ts')).seedServerSettings();
  (await import('../src/prompts.ts')).seedPrompts();
  const { upsertUser } = await import('../src/users.ts');
  const { id: userId } = upsertUser('dev:posted@example.com', { email: 'posted@example.com' });
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
  return { app, userId };
}

function insertJob(userId: string, id: string, status: string, postCount: number) {
  const post = (i: number) => ({
    kind: 'people',
    assetIds: [`p${i}`],
    caption: 'c',
    reason: 'r',
    photoSummary: 's',
    song: { title: 'Song', artist: 'Artist' },
    previousSongs: [],
  });
  const result = { posts: Array.from({ length: postCount }, (_, i) => post(i)), modelName: 'm' };
  const request = {
    accountId: 'a1',
    from: '2026-10-27',
    to: '2026-10-27',
    music: { source: 'ai' },
    posts: Array.from({ length: postCount }, () => ({
      kind: 'people',
      format: 'single',
      maxPhotos: 1,
    })),
  };
  return import('../src/db.ts').then(({ run }) => {
    run(
      `INSERT INTO jobs (id, user_id, created_at, updated_at, request, candidates, status, result, finished_at, prompt_versions)
       VALUES (?, ?, 1, 1, ?, '[]', ?, ?, 1, '{"final_post":1}')`,
      id,
      userId,
      JSON.stringify(request),
      status,
      status === 'ready' ? JSON.stringify(result) : null,
    );
    const dir = path.join(dataDir, 'jobs', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '0.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return dir;
  });
}

test('mark posted / undo / all posted deletes thumbnails / 409 / 400', async () => {
  const { app, userId } = await setup();
  const dir = await insertJob(userId, 'job2', 'ready', 2);
  const mark = (index: number, posted: unknown, id = 'job2') =>
    app.request(`/jobs/${id}/posts/${index}/posted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posted }),
    });

  const res = await mark(0, true);
  assert.equal(res.status, 200);
  let job = (await res.json()) as Job;
  const first = job.result!.posts[0].postedAt;
  assert.ok(typeof first === 'number' && first > 0, 'postedAt set');
  assert.equal(job.result!.posts[1].postedAt, undefined);
  assert.ok(existsSync(dir), 'thumbnails kept while a post is unposted');

  job = (await (await mark(0, true)).json()) as Job;
  assert.equal(job.result!.posts[0].postedAt, first, 'idempotent: same timestamp');

  job = (await (await mark(0, false)).json()) as Job;
  assert.equal(job.result!.posts[0].postedAt, undefined, 'undo clears postedAt');
  assert.equal((await mark(0, false)).status, 200, 'undo is idempotent');

  assert.equal((await mark(0, 'yes')).status, 400);
  assert.equal((await mark(9, true)).status, 404);

  await mark(0, true);
  job = (await (await mark(1, true)).json()) as Job;
  assert.ok(
    job.result!.posts.every((p) => p.postedAt),
    'both posted',
  );
  assert.ok(!existsSync(dir), 'thumbnails deleted once every post is posted');
  const retry = await app.request('/jobs/job2/retry', { method: 'POST' });
  assert.equal(retry.status, 410, 'retry after thumbnails are gone');

  await insertJob(userId, 'queued1', 'queued', 1);
  assert.equal((await mark(0, true, 'queued1')).status, 409, 'only ready jobs');

  const { listVersions } = await import('../src/prompts.ts');
  assert.equal(
    listVersions('final_post').find((v) => v.version === 1)?.posted,
    2,
    'prompt history posted count',
  );
  const { postedByUser } = await import('../src/usage.ts');
  assert.equal(postedByUser().get(userId), 2, 'users posted count');
});

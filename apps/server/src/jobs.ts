import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type DraftRequest,
  type Job,
  type JobStatus,
  MAX_UPLOAD_PHOTOS,
  type PostResult,
} from '@postitup/shared';
import { Hono } from 'hono';

import type { AuthEnv } from './auth.ts';
import { config } from './config.ts';
import { newId } from './crypto.ts';
import { all, one, run } from './db.ts';
import { ApiError, readJson } from './http.ts';
import { log, logError } from './log.ts';
import { notifyJobFinished } from './ntfy.ts';
import { OutOfCreditsError } from './openrouter.ts';
import { changeSong, runPipeline } from './pipeline.ts';
import type { PromptVersionsUsed } from './prompts.ts';
import { serverSettings } from './server-settings.ts';
import { normalizeRequest, normalizeResult, parseTaskConfig } from './task.ts';
import { aiContext } from './usage.ts';
import { getMe, getNtfyTopic } from './users.ts';

const CONCURRENCY = 2;
const MAX_ITEMS = MAX_UPLOAD_PHOTOS;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const KEEP_IMAGES_MS = 7 * 24 * 60 * 60 * 1000;
const JOBS_DIR = path.join(config.dataDir, 'jobs');

type JobRow = {
  id: string;
  user_id: string;
  created_at: number;
  updated_at: number;
  request: string;
  candidates: string;
  status: JobStatus;
  progress: string | null;
  error: string | null;
  result: string | null;
  finished_at: number | null;
  images_deleted: number;
  prompt_versions: string | null;
};

const jobDir = (id: string) => path.join(JOBS_DIR, id);
const imageFile = (id: string, n: number) => path.join(jobDir(id), `${n}.jpg`);

/** Old single-post jobs are migrated on read (request.posts, result.posts[0]). */
const requestOf = (r: JobRow) => normalizeRequest(JSON.parse(r.request));
const resultOf = (r: JobRow, request = requestOf(r)) =>
  normalizeResult(JSON.parse(r.result!), request);

function toJob(r: JobRow): Job {
  const active = r.status === 'queued' || r.status === 'running';
  const request = requestOf(r);
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    request,
    status: r.status,
    ...(active && r.progress ? { progress: r.progress } : {}),
    ...(r.status === 'failed' && r.error ? { error: r.error } : {}),
    ...(r.status === 'ready' && r.result ? { result: resultOf(r, request) } : {}),
  };
}

const getRow = (id: string) => one<JobRow>('SELECT * FROM jobs WHERE id = ?', id);

function ownJob(userId: string, id: string) {
  const r = getRow(id);
  if (!r || r.user_id !== userId) throw new ApiError(404, 'Post not found.');
  return r;
}

// Worker: in-process queue, CONCURRENCY at a time.

const queue: string[] = [];
const active = new Set<string>();

export function enqueue(id: string) {
  if (!queue.includes(id) && !active.has(id)) queue.push(id);
  // Start on the next tick so the caller can answer with the job still "queued".
  setImmediate(pump);
}

function pump() {
  while (active.size < CONCURRENCY && queue.length > 0) {
    const id = queue.shift()!;
    active.add(id);
    void runJob(id)
      .catch((e) => logError(`job ${id} worker`, e))
      .finally(() => {
        active.delete(id);
        pump();
      });
  }
}

/** The job was deleted (or retried) while running; stop quietly. */
class Cancelled extends Error {}

async function runJob(id: string) {
  const r = getRow(id);
  if (!r || r.status !== 'queued') return;
  const started = Date.now();
  run(
    "UPDATE jobs SET status = 'running', progress = 'Starting', updated_at = ? WHERE id = ?",
    started,
    id,
  );
  log(`job ${id} running (user ${r.user_id})`);

  const step = (progress: string) => {
    const res = run(
      "UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ? AND status = 'running'",
      progress,
      Date.now(),
      id,
    );
    if (Number(res.changes) === 0) throw new Cancelled();
  };

  const request = requestOf(r);
  const candidates = (JSON.parse(r.candidates) as { id: string; takenAt: number }[]).map(
    (c, n) => ({
      ...c,
      file: imageFile(id, n),
    }),
  );

  let outcome: 'ready' | 'failed';
  let postCount = 0;
  const used: PromptVersionsUsed = {};
  try {
    const result = await aiContext.run({ jobId: id, userId: r.user_id }, () =>
      runPipeline(r.user_id, id, request, candidates, step, used),
    );
    postCount = result.posts.length;
    const now = Date.now();
    const res = run(
      `UPDATE jobs SET status = 'ready', progress = NULL, error = NULL, result = ?, prompt_versions = ?,
         updated_at = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`,
      JSON.stringify(result),
      JSON.stringify(used),
      now,
      now,
      id,
    );
    if (Number(res.changes) === 0) throw new Cancelled();
    outcome = 'ready';
    log(
      `job ${id} ready in ${Math.round((now - started) / 1000)}s (${result.posts.length} post(s)` +
        `${result.skipped?.length ? `, ${result.skipped.length} skipped` : ''})`,
    );
  } catch (e) {
    if (e instanceof Cancelled) {
      log(`job ${id} cancelled`);
      return;
    }
    // Out of OpenRouter credits: users get a generic message; the details are in the admin logs.
    const message =
      e instanceof OutOfCreditsError
        ? e.userMessage
        : (e as Error).message || 'Something went wrong.';
    const now = Date.now();
    const res = run(
      `UPDATE jobs SET status = 'failed', progress = NULL, error = ?, result = NULL, prompt_versions = ?,
         updated_at = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`,
      message,
      Object.keys(used).length ? JSON.stringify(used) : null,
      now,
      now,
      id,
    );
    if (Number(res.changes) === 0) return;
    outcome = 'failed';
    log(`job ${id} failed: ${message}`);
  }

  let topic: string;
  try {
    topic = getNtfyTopic(r.user_id);
  } catch {
    return;
  }
  await notifyJobFinished(topic, id, request, outcome, postCount);
}

/** On boot: anything that was queued or interrupted mid-run goes back in the queue. */
export function requeueUnfinished() {
  const rows = all<{ id: string }>(
    "SELECT id FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at",
  );
  for (const { id } of rows) {
    run(
      "UPDATE jobs SET status = 'queued', progress = 'Waiting to start', updated_at = ? WHERE id = ?",
      Date.now(),
      id,
    );
    log(`job ${id} re-queued after restart`);
    enqueue(id);
  }
}

/** Deletes thumbnails 7 days after a job finished, and folders whose job no longer exists. */
export async function sweepImages() {
  const cutoff = Date.now() - KEEP_IMAGES_MS;
  const old = all<{ id: string }>(
    'SELECT id FROM jobs WHERE images_deleted = 0 AND finished_at IS NOT NULL AND finished_at < ?',
    cutoff,
  );
  for (const { id } of old) {
    await rm(jobDir(id), { recursive: true, force: true });
    run('UPDATE jobs SET images_deleted = 1 WHERE id = ?', id);
    log(`job ${id} thumbnails expired`);
  }
  const dirs = await readdir(JOBS_DIR).catch(() => [] as string[]);
  for (const d of dirs) {
    if (!getRow(d)) await rm(jobDir(d), { recursive: true, force: true });
  }
}

// Validation

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function parseRequest(v: unknown): DraftRequest {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new ApiError(400, 'Invalid request: request is required.');
  const r = v as Record<string, unknown>;
  if (!isDay(r.from) || !isDay(r.to))
    throw new ApiError(400, 'Invalid request: from and to must be YYYY-MM-DD.');
  if (r.from > r.to) throw new ApiError(400, 'Invalid request: from must not be after to.');
  if (r.auto !== undefined && typeof r.auto !== 'boolean')
    throw new ApiError(400, 'Invalid request: auto must be true or false.');
  return {
    ...parseTaskConfig(r, 'request'),
    from: r.from,
    to: r.to,
    ...(r.auto === true ? { auto: true } : {}),
  };
}

function parseUploads(body: Record<string, unknown>) {
  const { candidates, images } = body;
  if (!Array.isArray(candidates) || !Array.isArray(images)) {
    throw new ApiError(400, 'candidates and images are required.');
  }
  if (candidates.length < 1 || candidates.length > MAX_ITEMS) {
    throw new ApiError(400, `Send between 1 and ${MAX_ITEMS} photos.`);
  }
  if (images.length !== candidates.length)
    throw new ApiError(400, 'images must match candidates one-to-one.');
  const cands = candidates.map((c: unknown, i) => {
    const o = c as Record<string, unknown> | null;
    if (
      !o ||
      typeof o.id !== 'string' ||
      !o.id ||
      typeof o.takenAt !== 'number' ||
      !Number.isFinite(o.takenAt)
    ) {
      throw new ApiError(400, `candidates[${i}] needs an id and takenAt.`);
    }
    return { id: o.id, takenAt: o.takenAt };
  });
  const buffers = images.map((img: unknown, i) => {
    const s = typeof img === 'string' ? img.replace(/\s+/g, '') : '';
    if (!s || !B64_RE.test(s))
      throw new ApiError(400, `images[${i}] must be base64 (no data: prefix).`);
    const buf = Buffer.from(s, 'base64');
    if (buf.length > MAX_IMAGE_BYTES) throw new ApiError(400, `images[${i}] is too large.`);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      throw new ApiError(400, `images[${i}] is not a JPEG.`);
    }
    return buf;
  });
  return { cands, buffers };
}

// Daily cost guard: POST /jobs + retries per user per UTC day.

const utcDay = () => new Date().toISOString().slice(0, 10);

function useDailyQuota(userId: string) {
  const day = utcDay();
  const used =
    one<{ count: number }>('SELECT count FROM job_usage WHERE user_id = ? AND day = ?', userId, day)
      ?.count ?? 0;
  const limit = serverSettings().dailyJobLimit;
  if (used >= limit) {
    throw new ApiError(429, `You've reached today's limit of ${limit} posts.`);
  }
  run(
    `INSERT INTO job_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1`,
    userId,
    day,
  );
}

function useMusicChangeQuota(userId: string) {
  const day = utcDay();
  const used =
    one<{ music_changes: number }>(
      'SELECT music_changes FROM job_usage WHERE user_id = ? AND day = ?',
      userId,
      day,
    )?.music_changes ?? 0;
  const limit = serverSettings().dailyMusicChangeLimit;
  if (used >= limit) {
    throw new ApiError(429, `You've reached today's limit of ${limit} music changes.`);
  }
  run(
    `INSERT INTO job_usage (user_id, day, count, music_changes) VALUES (?, ?, 0, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET music_changes = music_changes + 1`,
    userId,
    day,
  );
}

export function sweepUsage() {
  const weekAgo = new Date(Date.now() - KEEP_IMAGES_MS).toISOString().slice(0, 10);
  run('DELETE FROM job_usage WHERE day < ?', weekAgo);
}

// Routes

export const jobRoutes = new Hono<AuthEnv>();

jobRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await readJson(c);
  const request = parseRequest(body.request);
  const { cands, buffers } = parseUploads(body);
  if (request.music.source === 'history' && !getMe(userId).spotify) {
    throw new ApiError(
      400,
      'Connect Spotify to use your listening history, or pick another music source.',
    );
  }
  if (request.music.source === 'playlists' && !getMe(userId).spotify) {
    throw new ApiError(409, 'Connect Spotify to use your playlists.');
  }
  if (request.auto) {
    const existing = one(
      `SELECT 1 FROM jobs WHERE user_id = ? AND json_extract(request, '$.auto') = 1
         AND json_extract(request, '$.from') = ? LIMIT 1`,
      userId,
      request.from,
    );
    if (existing) throw new ApiError(409, 'Today’s automatic task already exists.');
  }
  useDailyQuota(userId);

  const id = newId();
  await mkdir(jobDir(id), { recursive: true });
  try {
    await Promise.all(buffers.map((b, n) => writeFile(imageFile(id, n), b)));
    const now = Date.now();
    run(
      `INSERT INTO jobs (id, user_id, created_at, updated_at, request, candidates, status, progress)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 'Waiting to start')`,
      id,
      userId,
      now,
      now,
      JSON.stringify(request),
      JSON.stringify(cands),
    );
  } catch (e) {
    await rm(jobDir(id), { recursive: true, force: true });
    throw e;
  }
  log(
    `job ${id} queued (user ${userId}, ${cands.length} photos, ${request.posts.length} post(s), music ${request.music.source}${request.auto ? ', auto' : ''})`,
  );
  enqueue(id);
  return c.json(toJob(getRow(id)!), 201);
});

jobRoutes.get('/', (c) => {
  const rows = all<JobRow>(
    'SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
    c.get('userId'),
  );
  return c.json(rows.map(toJob));
});

jobRoutes.get('/:id', (c) => c.json(toJob(ownJob(c.get('userId'), c.req.param('id')))));

jobRoutes.post('/:id/retry', (c) => {
  const r = ownJob(c.get('userId'), c.req.param('id'));
  if (r.status === 'queued' || r.status === 'running') {
    throw new ApiError(409, 'This post is still being made.');
  }
  if (r.images_deleted || !existsSync(jobDir(r.id))) {
    throw new ApiError(410, 'The photos for this post have expired. Start a new one.');
  }
  useDailyQuota(r.user_id);
  run(
    `UPDATE jobs SET status = 'queued', progress = 'Waiting to start', error = NULL, result = NULL,
       prompt_versions = NULL, finished_at = NULL, updated_at = ? WHERE id = ?`,
    Date.now(),
    r.id,
  );
  log(`job ${r.id} retried`);
  enqueue(r.id);
  return c.json(toJob(getRow(r.id)!));
});

jobRoutes.delete('/:id', async (c) => {
  const r = ownJob(c.get('userId'), c.req.param('id'));
  run('DELETE FROM jobs WHERE id = ?', r.id);
  await rm(jobDir(r.id), { recursive: true, force: true });
  log(`job ${r.id} deleted`);
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// "Change the music" for one post (async; the app polls the job)

/** Applies a patch to one post of a ready job, synchronously (no await between read and write). */
function patchPost(jobId: string, index: number, patch: (p: PostResult) => PostResult | null) {
  const r = getRow(jobId);
  if (!r || r.status !== 'ready' || !r.result) return false;
  const result = resultOf(r);
  const post = result.posts[index];
  if (!post) return false;
  const next = patch(post);
  if (!next) return false;
  result.posts[index] = next;
  run(
    'UPDATE jobs SET result = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(result),
    Date.now(),
    jobId,
  );
  return true;
}

function recordPromptVersions(jobId: string, used: PromptVersionsUsed) {
  const r = getRow(jobId);
  if (!r || Object.keys(used).length === 0) return;
  const merged = {
    ...(r.prompt_versions ? (JSON.parse(r.prompt_versions) as PromptVersionsUsed) : {}),
    ...used,
  };
  run('UPDATE jobs SET prompt_versions = ? WHERE id = ?', JSON.stringify(merged), jobId);
}

async function runMusicChange(jobId: string, index: number, userRequest: string) {
  const r = getRow(jobId);
  if (!r || r.status !== 'ready' || !r.result) return;
  const request = requestOf(r);
  const post = resultOf(r, request).posts[index];
  if (!post || post.musicStatus !== 'changing') return;
  const candidates = JSON.parse(r.candidates) as { id: string }[];
  const photoFiles = post.assetIds
    .map((assetId) => candidates.findIndex((c) => c.id === assetId))
    .filter((n) => n >= 0)
    .map((n) => imageFile(jobId, n));

  const used: PromptVersionsUsed = {};
  try {
    const { song, reason, alternative } = await aiContext.run({ jobId, userId: r.user_id }, () =>
      changeSong({ userId: r.user_id, jobId, request, post, userRequest, photoFiles, used }),
    );
    const ok = patchPost(jobId, index, (p) => {
      if (p.musicStatus !== 'changing') return null;
      const { musicStatus: _s, musicError: _e, alternative: _a, ...rest } = p;
      return {
        ...rest,
        song,
        reason: reason || p.reason,
        previousSongs: [p.song, ...p.previousSongs],
        ...(alternative ? { alternative } : {}),
      };
    });
    if (ok) log(`job ${jobId} post ${index + 1}: music changed`);
  } catch (e) {
    const message =
      e instanceof OutOfCreditsError
        ? e.userMessage
        : (e as Error).message || 'Couldn’t change the music.';
    patchPost(jobId, index, (p) =>
      p.musicStatus === 'changing' ? { ...p, musicStatus: 'failed', musicError: message } : null,
    );
    log(`job ${jobId} post ${index + 1}: music change failed: ${message}`);
  } finally {
    recordPromptVersions(jobId, used);
  }
}

/** On boot: a music change cut off by a restart is marked failed so the user can try again. */
export function failInterruptedMusicChanges() {
  const rows = all<{ id: string }>(
    `SELECT id FROM jobs WHERE status = 'ready' AND result LIKE '%"musicStatus":"changing"%'`,
  );
  for (const { id } of rows) {
    const r = getRow(id)!;
    resultOf(r).posts.forEach((p, i) => {
      if (p.musicStatus === 'changing') {
        patchPost(id, i, (q) => ({
          ...q,
          musicStatus: 'failed',
          musicError: 'Interrupted by a server restart. Try again.',
        }));
      }
    });
  }
}

jobRoutes.post('/:id/posts/:index/music', async (c) => {
  const userId = c.get('userId');
  const r = ownJob(userId, c.req.param('id'));
  const index = Number(c.req.param('index'));
  const { prompt: userRequest } = await readJson(c);
  const text = typeof userRequest === 'string' ? userRequest.trim() : '';
  if (!text || text.length > 300)
    throw new ApiError(400, 'Describe the music you want (1–300 characters).');
  if (r.status !== 'ready' || !r.result) throw new ApiError(409, 'This post isn’t ready yet.');
  const result = resultOf(r);
  if (!Number.isInteger(index) || index < 0 || index >= result.posts.length)
    throw new ApiError(404, 'Post not found.');
  if (result.posts[index].musicStatus === 'changing')
    throw new ApiError(409, 'The music for this post is already changing.');
  useMusicChangeQuota(userId);

  patchPost(r.id, index, (p) => {
    const { musicError: _e, ...rest } = p;
    return { ...rest, musicStatus: 'changing' };
  });
  log(`job ${r.id} post ${index + 1}: music change requested`);
  void runMusicChange(r.id, index, text).catch((e) => logError(`job ${r.id} music change`, e));
  return c.json(toJob(getRow(r.id)!), 202);
});

jobRoutes.post('/:id/posts/:index/use-alternative', (c) => {
  const r = ownJob(c.get('userId'), c.req.param('id'));
  const index = Number(c.req.param('index'));
  if (r.status !== 'ready' || !r.result) throw new ApiError(409, 'This post isn’t ready yet.');
  const result = resultOf(r);
  if (!Number.isInteger(index) || index < 0 || index >= result.posts.length)
    throw new ApiError(404, 'Post not found.');
  const post = result.posts[index];
  if (post.musicStatus === 'changing')
    throw new ApiError(409, 'The music for this post is changing.');
  if (!post.alternative) throw new ApiError(409, 'There is no alternative song for this post.');
  patchPost(r.id, index, (p) => {
    if (!p.alternative) return null;
    const { alternative, musicError: _e, musicStatus: _s, ...rest } = p;
    return { ...rest, song: alternative, previousSongs: [p.song, ...p.previousSongs] };
  });
  log(`job ${r.id} post ${index + 1}: switched to the alternative song`);
  return c.json(toJob(getRow(r.id)!));
});

/** Marks a post as published on Instagram (or undoes it). When every post is posted, the thumbnails go now. */
jobRoutes.post('/:id/posts/:index/posted', async (c) => {
  const r = ownJob(c.get('userId'), c.req.param('id'));
  const index = Number(c.req.param('index'));
  const { posted } = await readJson(c);
  if (typeof posted !== 'boolean') throw new ApiError(400, 'posted must be true or false.');
  if (r.status !== 'ready' || !r.result) throw new ApiError(409, 'This task isn’t ready yet.');
  const result = resultOf(r);
  if (!Number.isInteger(index) || index < 0 || index >= result.posts.length)
    throw new ApiError(404, 'Post not found.');
  patchPost(r.id, index, (p) => {
    if (posted) return p.postedAt ? null : { ...p, postedAt: Date.now() };
    if (!p.postedAt) return null;
    const { postedAt: _p, ...rest } = p;
    return rest;
  });
  const after = getRow(r.id)!;
  if (posted && resultOf(after).posts.every((p) => p.postedAt) && !after.images_deleted) {
    await rm(jobDir(r.id), { recursive: true, force: true });
    run('UPDATE jobs SET images_deleted = 1 WHERE id = ?', r.id);
    log(`job ${r.id}: all posts posted, thumbnails deleted`);
  }
  return c.json(toJob(getRow(r.id)!));
});

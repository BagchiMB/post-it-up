import {
  type DraftRequest,
  type JobResult,
  MAX_CAROUSEL_PHOTOS,
  MAX_POSTS,
  type PostKind,
  type PostSpec,
  type Song,
  type TaskConfig,
} from '@postitup/shared';

import { ApiError } from './http.ts';
import { parseMusic } from './music.ts';

const KINDS: PostKind[] = ['people', 'scenery', 'mix'];
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** 1–5 post specs; 'mix' must be a carousel; single = 1 photo, carousel = 2–20. */
export function parsePosts(v: unknown, label: string): PostSpec[] {
  const bad = (what: string): never => {
    throw new ApiError(400, `Invalid ${label}: ${what}.`);
  };
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_POSTS)
    return bad(`posts must list 1–${MAX_POSTS} posts`);
  return v.map((p, i) => {
    const at = `posts[${i}]`;
    if (!isObj(p)) return bad(`${at} must be an object`);
    if (!KINDS.includes(p.kind as PostKind))
      return bad(`${at}.kind must be 'people', 'scenery' or 'mix'`);
    if (p.format !== 'single' && p.format !== 'carousel')
      return bad(`${at}.format must be 'single' or 'carousel'`);
    if (p.kind === 'mix' && p.format !== 'carousel')
      return bad(`${at}: a 'mix' post must be a carousel`);
    const max = p.maxPhotos;
    if (!Number.isInteger(max)) return bad(`${at}.maxPhotos must be a whole number`);
    if (p.format === 'single' && max !== 1)
      return bad(`${at}.maxPhotos must be 1 for a single photo`);
    if (p.format === 'carousel' && ((max as number) < 2 || (max as number) > MAX_CAROUSEL_PHOTOS)) {
      return bad(`${at}.maxPhotos must be 2–20 for a carousel`);
    }
    return { kind: p.kind as PostKind, format: p.format, maxPhotos: max as number };
  });
}

export function parseTaskConfig(v: Record<string, unknown>, label: string): TaskConfig {
  if (typeof v.accountId !== 'string' || !v.accountId || v.accountId.length > 100) {
    throw new ApiError(400, `Invalid ${label}: accountId is required.`);
  }
  if (v.music === undefined || v.music === null)
    throw new ApiError(400, `Invalid ${label}: music is required.`);
  return {
    accountId: v.accountId,
    posts: parsePosts(v.posts, label),
    music: parseMusic(v.music, label),
  };
}

// Old jobs (single post: request.format/maxPhotos, result.assetIds/caption/song) read back in the new shape.

type LegacyRequest = Partial<DraftRequest> & { format?: 'single' | 'carousel'; maxPhotos?: number };

export function normalizeRequest(raw: unknown): DraftRequest {
  const r = raw as LegacyRequest;
  const posts = r.posts ?? [
    r.format === 'carousel'
      ? { kind: 'mix' as const, format: 'carousel' as const, maxPhotos: r.maxPhotos ?? 10 }
      : { kind: 'people' as const, format: 'single' as const, maxPhotos: 1 },
  ];
  return {
    accountId: r.accountId ?? '',
    posts,
    music: r.music ?? { source: 'ai' },
    from: r.from ?? '',
    to: r.to ?? '',
    ...(r.auto ? { auto: true } : {}),
  };
}

const normalizeSong = (s: Song): Song =>
  s.clip && typeof s.clip.lengthSec !== 'number'
    ? { ...s, clip: { ...s.clip, lengthSec: Math.round(s.clip.endSec - s.clip.startSec) } }
    : s;

type LegacyResult = Partial<JobResult> & {
  assetIds?: string[];
  caption?: string;
  reason?: string;
  song?: Song;
};

export function normalizeResult(raw: unknown, request: DraftRequest): JobResult {
  const r = raw as LegacyResult;
  if (Array.isArray(r.posts)) {
    return {
      ...r,
      posts: r.posts.map((p) => ({
        ...p,
        song: normalizeSong(p.song),
        previousSongs: (p.previousSongs ?? []).map(normalizeSong),
      })),
    } as JobResult;
  }
  return {
    posts: [
      {
        kind: request.posts[0]?.kind ?? 'people',
        assetIds: r.assetIds ?? [],
        caption: r.caption ?? '',
        reason: r.reason ?? '',
        photoSummary: '',
        song: normalizeSong(r.song ?? { title: '', artist: '' }),
        previousSongs: [],
      },
    ],
    modelName: r.modelName ?? '',
  };
}

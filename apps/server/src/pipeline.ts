import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import type {
  DraftRequest,
  InstagramProfile,
  JobResult,
  MusicChoice,
  PostResult,
  PostSpec,
  Song,
  SongFit,
} from '@postitup/shared';

import { pickClip } from './clip.ts';
import { log } from './log.ts';
import { chatJson, type Content, type ModelChoice, modelInfo } from './openrouter.ts';
import { prompt, PROMPT_KEYS, type PromptKey, type PromptVersionsUsed } from './prompts.ts';
import { openRouterKey, serverSettings, updateServerSettings } from './server-settings.ts';
import {
  artistTracks,
  findTrack,
  historyTracks,
  playlistsTracks,
  type TrackSummary,
} from './spotify.ts';
import { getMe } from './users.ts';

/** A candidate with the file its thumbnail lives in. */
export type Candidate = { id: string; takenAt: number; file: string };

/** Most images sent to the model in a single request. */
const BATCH = 16;
/** Most photos in the final (all-posts) call. */
const MAX_FINAL = 32;

/** The user-facing range, e.g. "Oct 27" or "Oct 21 – Oct 27". Days are calendar days, so format in UTC. */
export function formatRange({ from, to }: { from: string; to: string }) {
  const fmt = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  };
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

function setup() {
  const apiKey = openRouterKey();
  if (!apiKey) throw new Error('The server has no OpenRouter key — set OPENROUTER_API_KEY.');
  return { apiKey, settings: serverSettings() };
}

/** The server's default model. A seeded model lacks its name/details: look them up once and save them. */
async function serverModel(model: ModelChoice): Promise<ModelChoice> {
  if (model.structuredOutputs !== undefined) return model;
  const info = await modelInfo(model.id);
  if (info.structuredOutputs !== undefined) updateServerSettings({ model: info });
  return info;
}

export type StepModels = Record<PromptKey, ModelChoice>;

/** The effective model for every AI step: the step's override, else the default. */
export async function resolveStepModels(
  settings: ReturnType<typeof serverSettings>,
): Promise<StepModels> {
  const fallback = await serverModel(settings.model);
  return Object.fromEntries(
    PROMPT_KEYS.map((k) => [k, settings.stepModels[k] ?? fallback]),
  ) as StepModels;
}

/**
 * One task: shortlist (batches of 16) → ONE final call that makes every requested post (photos
 * never reused) → per post: song match + clip. Uses the server's OpenRouter key and model; Spotify
 * via app credentials and/or the user's own login depending on `request.music`.
 */
export async function runPipeline(
  userId: string,
  jobId: string,
  request: DraftRequest,
  candidates: Candidate[],
  step: (progress: string) => void,
  /** Filled with the prompt versions used, so the caller can record them even on failure. */
  used: PromptVersionsUsed,
): Promise<JobResult> {
  const { apiKey, settings } = setup();
  const me = getMe(userId);
  const account =
    me.settings.accounts.find((a) => a.id === request.accountId) ?? me.settings.accounts[0];
  if (!account) throw new Error('Add an Instagram account in Settings.');
  const models = await resolveStepModels(settings);
  const specs = request.posts;

  let pool = [...candidates].sort((a, b) => a.takenAt - b.takenAt);
  if (pool.length === 0) throw new Error(`No photos found for ${formatRange(request)}.`);

  const needed = specs.reduce((n, s) => n + s.maxPhotos, 0) + 4 * specs.length;
  const finalSize = Math.min(MAX_FINAL, Math.max(BATCH, needed));
  if (pool.length > finalSize) {
    pool = await shortlist(apiKey, pool, finalSize, models.shortlist, step, used);
  }

  const tracks = await candidateTracks(userId, jobId, request.music, !!me.spotify, step);

  step(
    specs.length > 1
      ? `Making ${specs.length} posts from ${pool.length} photos`
      : `Choosing from ${pool.length} photos`,
  );
  const images = await Promise.all(pool.map(thumbnail));
  const answer = await chatJson<FinalAnswer>({
    apiKey,
    model: models.final_post,
    schemaName: 'posts',
    schema: FINAL_SCHEMA,
    content: [
      { type: 'text', text: finalPrompt(request, account, tracks, used) },
      ...labelled(images),
    ],
  });

  // Match answers to specs by their "post" number (falling back to position), then enforce
  // "no photo in two posts" here: later posts lose duplicates; a post left too small is skipped.
  const answers = Array.isArray(answer.posts) ? answer.posts : [];
  const byNumber = new Map<number, FinalPost>();
  answers.forEach((a, i) => {
    const n = Number.isInteger(a?.post) && a.post >= 1 && a.post <= specs.length ? a.post : i + 1;
    if (!byNumber.has(n)) byNumber.set(n, a);
  });

  const usedPhotos = new Set<number>();
  const made: { index: number; spec: PostSpec; a: FinalPost; picks: number[] }[] = [];
  const skipped: { index: number; reason: string }[] = [];
  specs.forEach((spec, index) => {
    const a = byNumber.get(index + 1);
    const limit = spec.format === 'single' ? 1 : spec.maxPhotos;
    const min = spec.format === 'single' ? 1 : 2;
    const picks = validPicks(a?.photos ?? [], pool.length)
      .filter((n) => !usedPhotos.has(n))
      .slice(0, limit);
    if (!a || picks.length < min) {
      const why = a?.reason?.trim();
      skipped.push({
        index,
        reason:
          why && (a?.photos ?? []).length === 0
            ? why
            : `Not enough suitable ${spec.kind === 'scenery' ? 'scenery ' : spec.kind === 'people' ? 'people ' : ''}photos for this post.`,
      });
      return;
    }
    picks.forEach((n) => usedPhotos.add(n));
    made.push({ index, spec, a, picks });
  });
  if (made.length === 0) {
    throw new Error(
      specs.length > 1
        ? `Couldn’t find suitable photos for any of the posts in ${formatRange(request)}.`
        : (skipped[0]?.reason ?? 'The model didn’t choose any photos. Try again.'),
    );
  }

  const posts: PostResult[] = [];
  const songsSoFar: Song[] = [];
  for (const [n, m] of made.entries()) {
    step(made.length > 1 ? `Matching songs (${n + 1} of ${made.length})` : 'Matching the song');
    const text = String(m.a.caption ?? '').trim();
    const caption = account.hashtags.trim() ? `${text}\n\n${account.hashtags.trim()}` : text;
    const photoSummary = String(m.a.photoSummary ?? '').trim();
    const matched = await resolveSong(userId, jobId, m.a.song, tracks);

    step(
      made.length > 1
        ? `Finding the best part of each song (${n + 1} of ${made.length})`
        : 'Finding the best part of the song',
    );
    const clip = await pickClip({
      apiKey,
      models,
      song: matched,
      caption: text,
      photoSummary,
      lengths: settings.clipLengths,
      used,
    }).catch((e: unknown) => {
      log(`job ${jobId} post ${m.index + 1}: no song clip: ${(e as Error).message}`);
      return undefined;
    });
    const fit = parseFit(m.a.fit);
    const song = { ...toSong(matched, clip), ...(fit ? { fit } : {}) };
    const alternative = await buildAlternative({
      userId,
      jobId,
      music: request.music,
      fit,
      alt: m.a.alternative,
      avoid: [song, ...songsSoFar],
      apiKey,
      models,
      caption: text,
      photoSummary,
      settings,
      used,
    });
    songsSoFar.push(song);
    posts.push({
      kind: m.spec.kind,
      assetIds: m.picks.map((i) => pool[i - 1].id),
      caption,
      reason: String(m.a.reason ?? ''),
      photoSummary,
      song,
      previousSongs: [],
      ...(alternative ? { alternative } : {}),
    });
  }

  return { posts, ...(skipped.length ? { skipped } : {}), modelName: models.final_post.name };
}

// ---------------------------------------------------------------------------
// "Change the music" for one post

/**
 * A new song (+ clip) for one finished post: honours the user's request, still fits the photo(s),
 * follows the task's music source unless the request clearly asks otherwise, and never repeats
 * the current or any previous song. Throws with a user-facing message on failure.
 */
export async function changeSong(opts: {
  userId: string;
  jobId: string;
  request: DraftRequest;
  post: PostResult;
  userRequest: string;
  /** Thumbnails of the post's photos, if still on disk. */
  photoFiles: string[];
  used: PromptVersionsUsed;
}): Promise<{ song: Song; reason: string; alternative?: Song }> {
  const { apiKey, settings } = setup();
  const { userId, jobId, request, post } = opts;
  const models = await resolveStepModels(settings);
  const me = getMe(userId);
  const avoid = [post.song, ...post.previousSongs];
  const isAvoided = (title: string, artist: string, id?: string) =>
    avoid.some(
      (s) =>
        (id && s.spotifyId === id) ||
        (norm(s.title) === norm(title) && sameArtist(s.artist, artist)),
    );

  const tracks = (
    await candidateTracks(userId, jobId, request.music, !!me.spotify, () => {})
  ).filter((t) => !isAvoided(t.name, t.artist, t.id));
  const images = await Promise.all(
    opts.photoFiles.filter((f) => existsSync(f)).map((file) => thumbnail({ file })),
  );

  const rejected: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const previousSongs = [...avoid.map((s) => `${s.title} by ${s.artist}`), ...rejected]
      .map((l) => `- ${l}`)
      .join('\n');
    const answer = await chatJson<ChangeAnswer>({
      apiKey,
      model: models.song_change,
      schemaName: 'song_change',
      schema: CHANGE_SCHEMA,
      content: [
        {
          type: 'text',
          text: prompt(
            'song_change',
            {
              photoSummary: post.photoSummary || 'see the attached photo(s)',
              caption: post.caption,
              userRequest: opts.userRequest,
              previousSongs,
              musicInstructions: musicInstructions(request.music, tracks),
              lowFitThreshold: settings.lowFitThreshold,
            },
            opts.used,
          ),
        },
        ...labelled(images),
      ],
    });
    const matched = await resolveSong(userId, jobId, answer.song, tracks);
    if (!matched.title || isAvoided(matched.title, matched.artist, matched.spotifyId)) {
      rejected.push(
        `${matched.title || answer.song?.title} by ${matched.artist || answer.song?.artist}`,
      );
      continue;
    }
    const clip = await pickClip({
      apiKey,
      models,
      song: matched,
      caption: post.caption.split('\n\n')[0],
      photoSummary: post.photoSummary,
      lengths: settings.clipLengths,
      used: opts.used,
    }).catch((e: unknown) => {
      log(`job ${jobId} music change: no song clip: ${(e as Error).message}`);
      return undefined;
    });
    const fit = parseFit(answer.fit);
    const song = { ...toSong(matched, clip), ...(fit ? { fit } : {}) };
    const alternative = await buildAlternative({
      userId,
      jobId,
      music: request.music,
      fit,
      alt: answer.alternative,
      avoid: [song, ...avoid],
      apiKey,
      models,
      caption: post.caption.split('\n\n')[0],
      photoSummary: post.photoSummary,
      settings,
      used: opts.used,
    });
    return { song, reason: String(answer.reason ?? ''), ...(alternative ? { alternative } : {}) };
  }
  throw new Error('Couldn’t find a different song for that. Try describing it another way.');
}

// ---------------------------------------------------------------------------
// Helpers

async function thumbnail(c: { file: string }) {
  const bytes = await readFile(c.file);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

/** Long ranges: ask the model for the best few of each batch, then decide among those. */
async function shortlist(
  apiKey: string,
  pool: Candidate[],
  size: number,
  model: ModelChoice,
  step: (p: string) => void,
  used: PromptVersionsUsed,
) {
  const batches: Candidate[][] = [];
  for (let i = 0; i < pool.length; i += BATCH) batches.push(pool.slice(i, i + BATCH));
  const keep = Math.max(2, Math.ceil(size / batches.length));

  const kept: Candidate[] = [];
  for (const [n, batch] of batches.entries()) {
    step(`Shortlisting photos (${n + 1} of ${batches.length})`);
    const images = await Promise.all(batch.map(thumbnail));
    const { picks } = await chatJson<{ picks: number[] }>({
      apiKey,
      model,
      schemaName: 'shortlist',
      schema: SHORTLIST_SCHEMA,
      content: [
        { type: 'text', text: prompt('shortlist', { keep, photoCount: batch.length }, used) },
        ...labelled(images),
      ],
    });
    kept.push(
      ...validPicks(picks ?? [], batch.length)
        .slice(0, keep)
        .map((i) => batch[i - 1]),
    );
  }
  return kept.sort((a, b) => a.takenAt - b.takenAt);
}

/** The tracks the model must choose from (history / playlists); empty for artists / ai or on failure. */
async function candidateTracks(
  userId: string,
  jobId: string,
  music: MusicChoice,
  spotifyConnected: boolean,
  step: (p: string) => void,
): Promise<TrackSummary[]> {
  if (music.source === 'history') {
    if (!spotifyConnected) {
      log(`job ${jobId} history music but Spotify isn't connected; letting the model suggest`);
      return [];
    }
    step('Reading your Spotify history');
    return historyTracks(userId).catch((e: unknown) => {
      log(`job ${jobId} spotify history unavailable: ${(e as Error).message}`);
      return [];
    });
  }
  if (music.source === 'playlists') {
    if (!spotifyConnected) {
      log(`job ${jobId} playlists music but Spotify isn't connected; letting the model suggest`);
      return [];
    }
    step(music.playlists.length > 1 ? 'Reading your playlists' : 'Reading your playlist');
    return playlistsTracks(
      userId,
      music.playlists.map((p) => p.id),
      (id, e) => log(`job ${jobId} playlist ${id} unreadable: ${(e as Error).message}`),
    ).catch(() => []);
  }
  if (music.source === 'artists') {
    step('Finding songs by your artists');
    return artistTracks(userId, music.artists).catch((e: unknown) => {
      // Spotify unavailable: the model names a song by one of the artists instead.
      log(`job ${jobId} artist tracks unavailable: ${(e as Error).message}`);
      return [];
    });
  }
  return [];
}

type Matched = { title: string; artist: string; spotifyId?: string; durationMs?: number };

/** Candidate id → that track; else a Spotify catalog search; else the model's suggestion as-is. */
async function resolveSong(
  userId: string,
  jobId: string,
  s: SongAnswer | undefined,
  tracks: TrackSummary[],
): Promise<Matched> {
  const title = String(s?.title ?? '').trim();
  const artist = String(s?.artist ?? '').trim();
  const picked = s?.trackId ? tracks.find((t) => t.id === s.trackId) : undefined;
  const asSong = (t: TrackSummary): Matched => ({
    title: t.name,
    artist: t.artist,
    spotifyId: t.id,
    ...(t.durationMs ? { durationMs: t.durationMs } : {}),
  });
  if (picked) return asSong(picked);
  try {
    const found = await findTrack(userId, title, artist);
    if (found) return asSong(found);
  } catch (e) {
    log(`job ${jobId} spotify song lookup failed: ${(e as Error).message}`);
  }
  return { title, artist };
}

const toSong = (m: Matched, clip: Song['clip']): Song => ({
  title: m.title,
  artist: m.artist,
  ...(m.spotifyId ? { spotifyId: m.spotifyId } : {}),
  ...(clip ? { clip } : {}),
});

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const sameArtist = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

// ---------------------------------------------------------------------------
// Fit score & alternative

/** Sources that limit the model's choice; only these get an `alternative` on a weak fit. */
const RESTRICTED = new Set<MusicChoice['source']>(['history', 'playlists', 'artists']);

function parseFit(f: FitAnswer | undefined): SongFit | undefined {
  const score = Number(f?.score);
  if (!Number.isFinite(score)) return undefined;
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    note: String(f?.note ?? '')
      .trim()
      .slice(0, 120),
  };
}

const sameSong = (
  a: { title: string; artist: string; spotifyId?: string },
  b: { title: string; artist: string; spotifyId?: string },
) =>
  (!!a.spotifyId && a.spotifyId === b.spotifyId) ||
  (norm(a.title) === norm(b.title) && sameArtist(a.artist, b.artist));

/**
 * The better-fitting song from any artist, when a restricted source gave a fit below the
 * threshold: Spotify-matched, with its own fit and clip, never one of `avoid`. Never throws.
 */
async function buildAlternative(o: {
  userId: string;
  jobId: string;
  music: MusicChoice;
  fit: SongFit | undefined;
  alt: AltAnswer | undefined;
  avoid: Song[];
  apiKey: string;
  models: StepModels;
  caption: string;
  photoSummary: string;
  settings: ReturnType<typeof serverSettings>;
  used: PromptVersionsUsed;
}): Promise<Song | undefined> {
  if (!RESTRICTED.has(o.music.source) || !o.fit || o.fit.score >= o.settings.lowFitThreshold)
    return undefined;
  const title = String(o.alt?.title ?? '').trim();
  const artist = String(o.alt?.artist ?? '').trim();
  if (!title) return undefined;
  try {
    const found = await findTrack(o.userId, title, artist).catch(() => null);
    const matched: Matched = found
      ? {
          title: found.name,
          artist: found.artist,
          spotifyId: found.id,
          ...(found.durationMs ? { durationMs: found.durationMs } : {}),
        }
      : { title, artist };
    if (o.avoid.some((s) => sameSong(s, matched))) return undefined;
    const clip = await pickClip({
      apiKey: o.apiKey,
      models: o.models,
      song: matched,
      caption: o.caption,
      photoSummary: o.photoSummary,
      lengths: o.settings.clipLengths,
      used: o.used,
    }).catch(() => undefined);
    const fit = parseFit({ score: o.alt?.fitScore ?? NaN, note: o.alt?.fitNote ?? '' });
    return { ...toSong(matched, clip), ...(fit ? { fit } : {}) };
  } catch (e) {
    log(`job ${o.jobId} alternative song failed: ${(e as Error).message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Prompting (wording lives in the DB templates; schemas and computed parts here)

type SongAnswer = { trackId: string | null; title: string; artist: string };
type FitAnswer = { score: number; note: string };
type AltAnswer = {
  title: string | null;
  artist: string | null;
  fitScore: number | null;
  fitNote: string | null;
};
type FinalPost = {
  post: number;
  photos: number[];
  photoSummary: string;
  reason: string;
  caption: string;
  song: SongAnswer;
  fit: FitAnswer;
  alternative?: AltAnswer;
};
type FinalAnswer = { posts: FinalPost[] };
type ChangeAnswer = { song: SongAnswer; reason: string; fit: FitAnswer; alternative?: AltAnswer };

const SONG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['trackId', 'title', 'artist'],
  properties: {
    trackId: { type: ['string', 'null'], description: 'id from the candidate track list, or null' },
    title: { type: 'string' },
    artist: { type: 'string' },
  },
};

const FIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'note'],
  properties: {
    score: {
      type: 'integer',
      description:
        '0–100: 90–100 excellent, 70–89 good, 50–69 okay, under 50 poor. Do not inflate.',
    },
    note: {
      type: 'string',
      description: 'One short line (under 120 characters) on why it fits or doesn’t',
    },
  },
};

const ALT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'artist', 'fitScore', 'fitNote'],
  description:
    'Only when the choice was limited and the fit is below the threshold; otherwise all fields null',
  properties: {
    title: { type: ['string', 'null'] },
    artist: { type: ['string', 'null'] },
    fitScore: { type: ['integer', 'null'] },
    fitNote: { type: ['string', 'null'] },
  },
};

const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posts'],
  properties: {
    posts: {
      type: 'array',
      description: 'One entry per requested post, in the order listed',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'post',
          'photos',
          'photoSummary',
          'reason',
          'caption',
          'song',
          'fit',
          'alternative',
        ],
        properties: {
          post: {
            type: 'integer',
            description: 'The post number from the list of requested posts',
          },
          photos: {
            type: 'array',
            items: { type: 'integer' },
            description:
              'Chosen photo numbers in post order; never a photo used by another post; empty if no suitable photos',
          },
          photoSummary: {
            type: 'string',
            description: "One plain sentence describing this post's photo(s)",
          },
          reason: {
            type: 'string',
            description: 'One sentence on why these photos, plus why the song fits them',
          },
          caption: { type: 'string' },
          song: SONG_SCHEMA,
          fit: FIT_SCHEMA,
          alternative: ALT_SCHEMA,
        },
      },
    },
  },
};

const CHANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['song', 'reason', 'fit', 'alternative'],
  properties: {
    song: SONG_SCHEMA,
    fit: FIT_SCHEMA,
    alternative: ALT_SCHEMA,
    reason: {
      type: 'string',
      description: 'One sentence on why this song fits the photo(s) and the request',
    },
  },
};

const SHORTLIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: { picks: { type: 'array', items: { type: 'integer' } } },
};

const KIND_TEXT: Record<PostSpec['kind'], string> = {
  people: 'People: people are the subject',
  scenery: 'Scenery: places, landscapes, food or objects, with no people as the main subject',
  mix: 'Mix: people and scenery together',
};

/** The {{postsInstructions}} part of final_post: one numbered line per requested post. */
function postsInstructions(posts: PostSpec[]) {
  return posts
    .map((p, i) => {
      const size =
        p.format === 'single'
          ? 'a single photo (choose exactly 1)'
          : `a carousel of 2 to ${p.maxPhotos} photos that tells the story of the period, strongest photo first, no near-duplicates`;
      return `${i + 1}. ${KIND_TEXT[p.kind]}. Format: ${size}.`;
    })
    .join('\n');
}

/** The {{musicInstructions}} part of final_post / song_change, per music source. */
function musicInstructions(music: MusicChoice, tracks: TrackSummary[]) {
  if (tracks.length > 0) {
    const from =
      music.source === 'history'
        ? "the listener's most-played and recently played Spotify tracks"
        : music.source === 'artists'
          ? `popular tracks by the artists the listener picked (${music.artists.map((a) => a.name).join(', ')})`
          : 'tracks from the playlists the listener picked';
    return [
      `Choose each song from ${from} (id | title | artist). Pick the one that best fits the photo(s) and return its id as trackId, with its title and artist:`,
      tracks.map((t) => `${t.id} | ${t.name} | ${t.artist}`).join('\n'),
    ].join('\n');
  }
  if (music.source === 'artists') {
    const names = music.artists.map((a) => a.name).join(', ');
    return `Name a real, released song by one of these artists: ${names}. Give its exact title and the artist's name, and set trackId to null.`;
  }
  const hints = [
    music.source === 'ai' && music.artistHint
      ? `The listener would like something by or like ${music.artistHint}.`
      : '',
    music.source === 'ai' && music.genreHint ? `Preferred genre or vibe: ${music.genreHint}.` : '',
  ].filter(Boolean);
  return [
    "Suggest a well-known song that is likely to be in Instagram's music library.",
    ...hints,
    'Give its exact title and main artist, and set trackId to null.',
  ].join(' ');
}

function finalPrompt(
  request: DraftRequest,
  account: InstagramProfile,
  tracks: TrackSummary[],
  used: PromptVersionsUsed,
) {
  const range =
    request.from === request.to
      ? `on ${formatRange(request)}`
      : `between ${formatRange({ from: request.from, to: request.from })} and ${formatRange({ from: request.to, to: request.to })}`;
  const posts = postsInstructions(request.posts);
  return prompt(
    'final_post',
    {
      handle: account.handle,
      range,
      postsInstructions: posts,
      formatInstructions: posts, // for older prompt versions
      tone: account.tone,
      emojiRule: account.emojis ? 'a couple of emojis are welcome' : 'no emojis',
      musicInstructions: musicInstructions(request.music, tracks),
      lowFitThreshold: serverSettings().lowFitThreshold,
    },
    used,
  );
}

function labelled(images: string[]): Content[] {
  return images.flatMap((url, i): Content[] => [
    { type: 'text', text: `Photo ${i + 1}` },
    { type: 'image_url', image_url: { url } },
  ]);
}

/** 1-based, in range, no repeats. */
function validPicks(picks: unknown[], count: number) {
  return [...new Set(picks)].filter(
    (n): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count,
  );
}

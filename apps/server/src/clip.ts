import type { SongClip } from '@postitup/shared';

import { config } from './config.ts';
import type { ModelChoice } from './openrouter.ts';
import { chatJson } from './openrouter.ts';
import { outbound } from './outbound.ts';
import { prompt, type PromptVersionsUsed } from './prompts.ts';

const LRCLIB = 'https://lrclib.net/api';
const USER_AGENT = `PostItUp-server/${config.version} (self-hosted personal app that suggests song clips for Instagram posts)`;
const MAX_LINES = 160;

export type LyricLine = { t: number; text: string };

type LrcRecord = { duration?: number; instrumental?: boolean; syncedLyrics?: string | null };

/** `[mm:ss.xx] text` lines (several time tags per line allowed), sorted by time; empty lines dropped. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (tags.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const m of tags) out.push({ t: Number(m[1]) * 60 + Number(m[2].replace(':', '.')), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function lrclib<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const res = await outbound(
    { integration: 'lrclib', operation: path === '/get' ? 'lyrics_get' : 'lyrics_search' },
    `${LRCLIB}${path}?${new URLSearchParams(params).toString()}`,
    {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB returned ${res.status}`);
  return (await res.json()) as T;
}

/** Timed lyrics and the duration LRCLIB knows, or null lines when there are none. */
export async function fetchSyncedLyrics(
  title: string,
  artist: string,
  durationSec?: number,
): Promise<{ lines: LyricLine[]; durationSec?: number }> {
  if (durationSec) {
    const hit = await lrclib<LrcRecord>('/get', {
      track_name: title,
      artist_name: artist,
      duration: String(Math.round(durationSec)),
    }).catch(() => null);
    if (hit?.syncedLyrics)
      return { lines: parseLrc(hit.syncedLyrics), durationSec: durationSec ?? hit.duration };
    if (hit?.instrumental) return { lines: [], durationSec };
  }
  const results =
    (await lrclib<LrcRecord[]>('/search', { track_name: title, artist_name: artist })) ?? [];
  const synced = results.filter((r) => r.syncedLyrics);
  if (synced.length === 0) return { lines: [], durationSec: durationSec ?? results[0]?.duration };
  const best = durationSec
    ? synced.reduce((a, b) =>
        Math.abs((a.duration ?? 0) - durationSec) <= Math.abs((b.duration ?? 0) - durationSec)
          ? a
          : b,
      )
    : synced[0];
  return { lines: parseLrc(best.syncedLyrics!), durationSec: durationSec ?? best.duration };
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** "10, 15, 20, 25 or 30" */
export const lengthsText = (lengths: number[]) =>
  lengths.length === 1
    ? String(lengths[0])
    : `${lengths.slice(0, -1).join(', ')} or ${lengths[lengths.length - 1]}`;

/** Nearest allowed length (ties go to the longer one, so a phrase isn't cut short). */
export function snapLength(n: unknown, lengths: number[]) {
  const want =
    typeof n === 'number' && Number.isFinite(n) ? n : lengths[Math.floor(lengths.length / 2)];
  return lengths.reduce((best, l) =>
    Math.abs(l - want) < Math.abs(best - want) ||
    (Math.abs(l - want) === Math.abs(best - want) && l > best)
      ? l
      : best,
  );
}

/**
 * Clamps to the song: a lyric clip keeps its start (it must begin on that line) and takes the
 * longest allowed length that still fits, else ends at the song's end; an estimated clip moves its
 * start earlier instead so the whole length fits.
 */
function placeClip(
  start: number,
  length: number,
  lengths: number[],
  durationSec: number | undefined,
  fixedStart: boolean,
) {
  let s = Math.max(0, start);
  let len = length;
  if (durationSec && durationSec > 0) {
    if (fixedStart) {
      s = Math.min(s, Math.max(0, durationSec - 1));
      if (s + len > durationSec) {
        const fits = lengths.filter((l) => s + l <= durationSec);
        len = fits.length ? fits[fits.length - 1] : len;
      }
    } else if (s + len > durationSec) {
      s = Math.max(0, durationSec - len);
    }
  }
  const end = durationSec && durationSec > 0 ? Math.min(s + len, durationSec) : s + len;
  return { startSec: round1(s), endSec: round1(end), lengthSec: len };
}

/**
 * The part of the song to use, like Instagram's clip picker: a start line + length chosen by the
 * model from timed lyrics (hook/chorus preferred, fitting the photos and caption), or the model's
 * estimate of the hook when there are no timed lyrics. Throws on failure; the caller omits the clip.
 */
export async function pickClip(opts: {
  apiKey: string;
  /** Models for the two clip steps (each step may use its own). */
  models: { song_clip: ModelChoice; song_clip_estimate: ModelChoice };
  song: { title: string; artist: string; durationMs?: number };
  caption: string;
  photoSummary: string;
  lengths: number[];
  used: PromptVersionsUsed;
}): Promise<SongClip> {
  const { title, artist } = opts.song;
  const lengths = [...opts.lengths].sort((a, b) => a - b);
  const known = opts.song.durationMs ? opts.song.durationMs / 1000 : undefined;
  const { lines: all, durationSec } = await fetchSyncedLyrics(title, artist, known).catch(() => ({
    lines: [] as LyricLine[],
    durationSec: known,
  }));
  const lines = all.filter((l) => !durationSec || l.t < durationSec).slice(0, MAX_LINES);
  const base = {
    title,
    artist,
    photoSummary: opts.photoSummary || 'not described',
    clipLengths: lengthsText(lengths),
    clipSeconds: lengthsText(lengths), // for older prompt versions
  };
  const lengthProp = {
    type: 'integer',
    description: `Clip length in seconds: one of ${lengths.join(', ')}`,
  };

  if (lines.length > 0) {
    const answer = await chatJson<{ startIndex: number; lengthSec: number }>({
      apiKey: opts.apiKey,
      model: opts.models.song_clip,
      schemaName: 'clip',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['startIndex', 'lengthSec'],
        properties: {
          startIndex: {
            type: 'integer',
            description: 'Index (the number in brackets) of the lyric line the clip starts on',
          },
          lengthSec: lengthProp,
        },
      },
      content: [
        {
          type: 'text',
          text: prompt(
            'song_clip',
            {
              ...base,
              caption: opts.caption,
              lyrics: lines.map((l, i) => `[${i + 1}] ${fmt(l.t)} ${l.text}`).join('\n'),
            },
            opts.used,
          ),
        },
      ],
    });
    const raw = answer.startIndex ?? (answer as unknown as { line?: number }).line;
    const idx = Number.isInteger(raw) && raw >= 1 && raw <= lines.length ? raw - 1 : null;
    if (idx === null) throw new Error('model picked no valid lyric line');
    const placed = placeClip(
      lines[idx].t,
      snapLength(answer.lengthSec, lengths),
      lengths,
      durationSec,
      true,
    );
    return { ...placed, lyric: lines[idx].text, estimated: false };
  }

  const answer = await chatJson<{ startSec: number; lengthSec: number }>({
    apiKey: opts.apiKey,
    model: opts.models.song_clip_estimate,
    schemaName: 'clip_estimate',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['startSec', 'lengthSec'],
      properties: {
        startSec: { type: 'number', description: 'Seconds from the start of the song' },
        lengthSec: lengthProp,
      },
    },
    content: [{ type: 'text', text: prompt('song_clip_estimate', base, opts.used) }],
  });
  if (typeof answer.startSec !== 'number' || !Number.isFinite(answer.startSec))
    throw new Error('model gave no start time');
  return {
    ...placeClip(
      answer.startSec,
      snapLength(answer.lengthSec, lengths),
      lengths,
      durationSec,
      false,
    ),
    estimated: true,
  };
}

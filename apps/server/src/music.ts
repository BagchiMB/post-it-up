import type { MusicChoice } from '@postitup/shared';

import { ApiError } from './http.ts';

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim().length <= max ? v.trim() : null;
const ID_RE = /^[A-Za-z0-9]{1,64}$/;

/** Strict validation of a MusicChoice; unknown keys are dropped. `label` prefixes error messages. */
export function parseMusic(v: unknown, label: string): MusicChoice {
  const bad = (what: string): never => {
    throw new ApiError(400, `Invalid ${label}: ${what}.`);
  };
  if (!isObj(v)) return bad('music must be an object');
  switch (v.source) {
    case 'history':
      return { source: 'history' };
    case 'playlists': {
      const list = v.playlists;
      if (!Array.isArray(list) || list.length < 1 || list.length > 5)
        return bad('pick 1–5 playlists');
      const playlists = list.map((p, i) => {
        if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id))
          return bad(`playlists[${i}].id must be a Spotify playlist id`);
        const name = text(p.name, 300);
        if (name === null) return bad(`playlists[${i}].name must be text`);
        return { id: p.id, name };
      });
      if (new Set(playlists.map((p) => p.id)).size !== playlists.length)
        bad('the same playlist is listed twice');
      return { source: 'playlists', playlists };
    }
    case 'artists': {
      const list = v.artists;
      if (!Array.isArray(list) || list.length < 1 || list.length > 10)
        return bad('pick 1–10 artists');
      const artists = list.map((a, i) => {
        if (!isObj(a)) return bad(`artists[${i}] must be an object`);
        const name = text(a.name, 200);
        if (!name) return bad(`artists[${i}].name is required`);
        if (
          a.id !== undefined &&
          a.id !== null &&
          (typeof a.id !== 'string' || !ID_RE.test(a.id))
        ) {
          return bad(`artists[${i}].id must be a Spotify artist id`);
        }
        return { name, ...(typeof a.id === 'string' ? { id: a.id } : {}) };
      });
      return { source: 'artists', artists };
    }
    case 'ai': {
      const out: MusicChoice = { source: 'ai' };
      for (const key of ['artistHint', 'genreHint'] as const) {
        const raw = v[key];
        if (raw === undefined || raw === null) continue;
        const t = text(raw, 100);
        if (t === null) return bad(`${key} must be text (100 characters max)`);
        if (t) out[key] = t;
      }
      return out;
    }
    default:
      return bad("music.source must be 'history', 'playlists', 'artists' or 'ai'");
  }
}

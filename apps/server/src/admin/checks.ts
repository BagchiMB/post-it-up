import { fetchSyncedLyrics } from '../clip.ts';
import { config } from '../config.ts';
import { randomAlnum } from '../crypto.ts';
import { checkJwks } from '../google.ts';
import { allModels, checkKey, credits } from '../openrouter.ts';
import { callContext, outbound } from '../outbound.ts';
import { PROMPT_KEYS, VISION_STEPS } from '../prompts.ts';
import {
  openRouterKey,
  serverSettings,
  spotifyClientId,
  spotifyClientSecret,
} from '../server-settings.ts';
import { findTrack, requestAppToken } from '../spotify.ts';
import { usd } from './format.ts';

export type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
};

type Check = { id: string; label: string; run: () => Promise<string> };

/** Each check returns a short detail on success and throws a user-facing message on failure. */
export const CHECKS: Check[] = [
  {
    id: 'openrouter_key',
    label: 'OpenRouter key',
    run: async () => {
      const key = openRouterKey();
      if (!key) throw new Error('No OpenRouter key is set (Integrations).');
      const k = await checkKey(key);
      if (!k.ok) throw new Error(k.error ?? 'OpenRouter rejected the key.');
      const c = await credits(key).catch(() => null);
      const balance = c?.source === 'credits' ? usd(c.balance) : 'unknown';
      const limit = c?.key ? (c.key.limit === null ? 'none' : usd(c.key.limit)) : 'unknown';
      return `Key valid · balance ${balance} · key limit ${limit}${c?.key?.isFreeTier ? ' · free tier' : ''}`;
    },
  },
  {
    id: 'openrouter_model',
    label: 'Models (default + per step)',
    run: async () => {
      const s = serverSettings();
      const list = await allModels({ routers: true });
      const problems: string[] = [];
      const used = new Map<string, string[]>();
      for (const key of PROMPT_KEYS) {
        const m = s.stepModels[key] ?? s.model;
        used.set(m.id, [...(used.get(m.id) ?? []), key]);
        const found = list.find((x) => x.id === m.id);
        if (!found) problems.push(`${key}: ${m.id} isn't available on OpenRouter`);
        else if (VISION_STEPS.has(key) && !found.vision)
          problems.push(`${key}: ${found.name} can't see images`);
      }
      if (problems.length) throw new Error(problems.join('; '));
      return [...used.entries()]
        .map(
          ([id, keys]) =>
            `${list.find((x) => x.id === id)!.name} (${keys.length === PROMPT_KEYS.length ? 'all steps' : keys.join(', ')})`,
        )
        .join(' · ');
    },
  },
  {
    id: 'spotify_app',
    label: 'Spotify app credentials',
    run: async () => {
      const id = spotifyClientId();
      const secret = spotifyClientSecret();
      if (!id || !secret) throw new Error('Spotify client ID / secret are not set (Integrations).');
      await requestAppToken(id, secret).catch((e: { status?: number }) => {
        throw new Error(
          e.status
            ? `Spotify rejected the credentials (HTTP ${e.status}).`
            : 'Couldn’t reach Spotify.',
        );
      });
      return 'Client-credentials token issued';
    },
  },
  {
    id: 'spotify_search',
    label: 'Spotify search',
    run: async () => {
      const t = await findTrack('', 'Bohemian Rhapsody', 'Queen');
      if (!t) throw new Error('Search returned nothing for a well-known song.');
      return `Found “${t.name}” by ${t.artist}`;
    },
  },
  {
    id: 'lrclib',
    label: 'LRCLIB lyrics',
    run: async () => {
      const { lines } = await fetchSyncedLyrics('Bohemian Rhapsody', 'Queen', 354);
      if (lines.length === 0) throw new Error('No timed lyrics returned for a well-known song.');
      return `${lines.length} timed lines for a sample song`;
    },
  },
  {
    id: 'ntfy',
    label: 'ntfy push',
    run: async () => {
      // A throwaway random topic: never a user's.
      const url = `${config.ntfyUrl}/postitup-check-${randomAlnum(16)}`;
      const res = await outbound(
        { integration: 'ntfy', operation: 'push', logPath: `${new URL(url).host}/[check-topic]` },
        url,
        {
          method: 'POST',
          body: 'Post It Up connectivity check',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}`);
      return `Published to a throwaway topic on ${new URL(url).host}`;
    },
  },
  {
    id: 'google_jwks',
    label: 'Google sign-in keys',
    run: async () => `${await checkJwks()} signing keys fetched`,
  },
];

export let lastRun: { at: number; results: CheckResult[] } | null = null;

export async function runChecks(ids?: string[]): Promise<CheckResult[]> {
  const selected = ids?.length ? CHECKS.filter((c) => ids.includes(c.id)) : CHECKS;
  const results = await callContext.run({ check: true }, () =>
    Promise.all(
      selected.map(async (c): Promise<CheckResult> => {
        const started = performance.now();
        try {
          const detail = await c.run();
          return {
            id: c.id,
            label: c.label,
            ok: true,
            durationMs: Math.round(performance.now() - started),
            detail,
          };
        } catch (e) {
          return {
            id: c.id,
            label: c.label,
            ok: false,
            durationMs: Math.round(performance.now() - started),
            error: (e as Error).message || 'Failed',
          };
        }
      }),
    ),
  );
  // Merge into the last run so per-check runs update just their rows.
  const merged = new Map((lastRun?.results ?? []).map((r) => [r.id, r]));
  for (const r of results) merged.set(r.id, r);
  lastRun = {
    at: Date.now(),
    results: CHECKS.map((c) => merged.get(c.id)).filter((r): r is CheckResult => !!r),
  };
  return results;
}

// Artists music source: popular tracks via paged search (5 per page), filtered and deduped. No network.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

/** The URL a fetch fake was called with. */
const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input.toString();

const dataDir = mkdtempSync(path.join(tmpdir(), 'postitup-artists-'));
process.env.DATA_DIR = dataDir;
process.env.SPOTIFY_CLIENT_ID = 'testclientid0000000000000000000';
process.env.SPOTIFY_CLIENT_SECRET = 'testclientsecret00000000000000';
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

type T = {
  id: string;
  name: string;
  artists: { name: string; id?: string }[];
  type: 'track';
  duration_ms: number;
};
const tr = (id: string, name: string, artist: string, artistId?: string): T => ({
  id,
  name,
  type: 'track',
  duration_ms: 200_000,
  artists: [{ name: artist, ...(artistId ? { id: artistId } : {}) }],
});

// 3 pages of 5 for "Artist A" (offsets 0/5/10), with features, other artists, versions and repeats.
const PAGES: Record<string, T[]> = {
  '0': [
    tr('a1', 'Hit One', 'Artist A', 'artA'),
    tr('a2', 'Hit Two', 'Artist A', 'artA'),
    tr('x1', 'Cover of Hit One', 'Someone Else', 'artX'),
    tr('a3', 'Hit One - Remastered 2011', 'Artist A', 'artA'),
    tr('a4', 'Live Forever', 'Artist A', 'artA'),
  ],
  '5': [
    tr('a5', 'Hit Two (Live)', 'Artist A', 'artA'),
    tr('a6', 'Deep Cut', 'Artist A', 'artA'),
    tr('a1', 'Hit One', 'Artist A', 'artA'),
    tr('a7', 'Hit Three Remix', 'Artist A', 'artA'),
    tr('a8', 'Hit Three', 'Artist A', 'artA'),
  ],
  '10': [
    tr('a9', 'Ballad', 'Artist A', 'artA'),
    tr('y1', 'Feat Song', 'Other', 'artY'),
    tr('a10', 'Encore', 'Artist A', 'artA'),
    tr('a11', 'Hit Four (From "Some Film")', 'Artist A', 'artA'),
    tr('a12', 'Hit Five', 'Artist A', 'artA'),
  ],
};

test('artist tracks: pages 0/5/10, primary artist only, versions deduped, capped', async () => {
  const offsets: string[] = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = new URL(urlOf(input));
    if (url.host === 'accounts.spotify.com')
      return new Response(JSON.stringify({ access_token: 'app', expires_in: 3600 }));
    if (url.pathname === '/v1/search') {
      const q = url.searchParams.get('q') ?? '';
      const offset = url.searchParams.get('offset') ?? '0';
      assert.equal(url.searchParams.get('limit'), '5');
      if (q.includes('Artist A')) {
        offsets.push(offset);
        return new Response(JSON.stringify({ tracks: { items: PAGES[offset] ?? [] } }));
      }
      if (q.includes('Broken')) return new Response('{}', { status: 503 });
      // Any other artist: 5 distinct tracks per page by that artist (15 over 3 pages).
      const name = /artist:"([^"]+)"/.exec(q)?.[1] ?? 'Unknown';
      const n = Number(offset);
      return new Response(
        JSON.stringify({
          tracks: {
            items: Array.from({ length: 5 }, (_, i) =>
              tr(`${name}-${n + i}`, `${name} Song ${n + i}`, name),
            ),
          },
        }),
      );
    }
    return new Response('{}', { status: 404 });
  };

  const settings = await import('../src/server-settings.ts');
  settings.seedServerSettings();
  const { artistTracks } = await import('../src/spotify.ts');
  const { upsertUser } = await import('../src/users.ts');
  const { id: userId } = upsertUser('dev:artists@example.com', { email: 'artists@example.com' });

  const a = await artistTracks(userId, [{ name: 'Artist A', id: 'artA' }]);
  assert.deepEqual(offsets.sort(), ['0', '10', '5']);
  const ids = a.map((t) => t.id);
  assert.ok(!ids.includes('x1') && !ids.includes('y1'), 'other artists dropped');
  assert.ok(!ids.includes('a3'), 'remastered duplicate dropped');
  assert.ok(!ids.includes('a5'), 'live duplicate dropped');
  assert.ok(!ids.includes('a7') || !ids.includes('a8'), 'remix duplicate dropped');
  assert.equal(ids.filter((id) => id === 'a1').length, 1, 'repeat dropped');
  assert.ok(ids.includes('a4'), '"Live Forever" is a real title, kept');
  assert.ok(ids.includes('a11'), '"(From …)" kept once');

  const mixed = await artistTracks(userId, [
    { name: 'Artist A', id: 'artA' },
    { name: 'Artist B' },
  ]);
  assert.ok(mixed.filter((t) => t.artist === 'Artist B').length <= 15, 'per-artist cap');
  assert.equal(mixed[0].artist, 'Artist A');
  assert.equal(mixed[1].artist, 'Artist B', 'interleaved so every artist shows');

  const ten = await artistTracks(
    userId,
    Array.from({ length: 10 }, (_, i) => ({ name: `Artist B${i}` })),
  );
  assert.equal(ten.length, 60, 'total cap (10 artists × 15 → 60)');
  assert.equal(
    new Set(ten.slice(0, 10).map((t) => t.artist)).size,
    10,
    'first round has every artist',
  );

  await assert.rejects(
    artistTracks(userId, [{ name: 'Broken' }]),
    'all pages failed → caller falls back',
  );
});

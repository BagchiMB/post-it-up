import { useEffect, useState } from 'react';

import { displayUri } from './photos';

/** Resolved URIs, shared across screens; null when the photo is gone from the library. */
const cache = new Map<string, string | null>();

function resolve(id: string) {
  if (cache.has(id)) return Promise.resolve(cache.get(id)!);
  return displayUri(id).then(
    (uri) => {
      cache.set(id, uri);
      return uri;
    },
    () => {
      cache.set(id, null);
      return null;
    },
  );
}

/**
 * Turns photo library ids (from the server) into URIs this phone can show, in the same order.
 * Entries are undefined while loading and null for photos that were deleted.
 */
export function useDisplayUris(ids: string[] | undefined): (string | null | undefined)[] {
  // Asset ids never contain newlines, so the joined string is a stable dependency.
  const key = ids?.join('\n') ?? '';
  const [resolved, setResolved] = useState<{ key: string; uris: (string | null)[] }>();

  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(key.split('\n').map(resolve)).then((uris) => {
      if (alive) setResolved({ key, uris });
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const list = key ? key.split('\n') : [];
  if (resolved?.key === key) return resolved.uris;
  return list.map((id) => cache.get(id) ?? undefined);
}

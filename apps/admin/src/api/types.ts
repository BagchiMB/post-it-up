/**
 * Admin API types come from `@postitup/shared` (packages/shared/src/admin.ts). The few response
 * shapes it doesn't name are declared here.
 */
import type { AdminSpotifyAccessItem } from '@postitup/shared';

/** `GET /admin/api/spotify-access`. */
export type SpotifyAccessList = { items: AdminSpotifyAccessItem[]; used: number; cap: number };

/** `GET /admin/api/db/history` item. */
export type QueryHistoryItem = {
  id: number;
  at: number;
  sql: string;
  ok: boolean;
  rowCount: number | null;
  durationMs: number;
};

/** `GET /admin/api/db/snippets` item. */
export type Snippet = { id: number; name: string; sql: string; updatedAt: number };

/** `GET /admin/api/db/relations`. */
export type DbRelations = { tables: string[]; relations: import('@postitup/shared').DbRelation[] };

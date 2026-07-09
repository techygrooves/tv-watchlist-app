import type { SQLiteDatabase } from 'expo-sqlite';

import { enrichItem } from './enrichment';
import type { TvdbSearchResult } from './tvdb';
import type { MediaItem } from '@/src/types';

/**
 * Add-to-watchlist from TVDB search results (Explore tab).
 *
 * Items are keyed show:{tvdbId} / movie:{tvdbId} like everything else, are
 * never marked watched on add, and never overwrite an existing row —
 * imported TV Time data stays untouched. After a successful insert the item
 * is enriched in place (poster/overview and, for shows, the full episode
 * catalog — all episodes unwatched); if enrichment fails (offline, quota),
 * the add still succeeds and Fetch Missing Metadata completes it later.
 */

export function mediaItemIdFor(result: TvdbSearchResult): string {
  return `${result.mediaType}:${result.tvdbId}`;
}

export async function mediaItemExists(db: SQLiteDatabase, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM media_items WHERE id = ?',
    id,
  );
  return row !== null;
}

export type AddResult = 'added' | 'already_exists';

export async function addMediaItemFromTvdb(
  db: SQLiteDatabase,
  result: TvdbSearchResult,
): Promise<AddResult> {
  const id = mediaItemIdFor(result);
  if (await mediaItemExists(db, id)) return 'already_exists';

  // INSERT OR IGNORE guards the race where the item appeared between the
  // existence check and the insert — existing rows are never overwritten.
  const inserted = await db.runAsync(
    `INSERT OR IGNORE INTO media_items (
       id, media_type, tvdb_id, title, year, overview, poster_url,
       is_favorite, is_watched, watched_count, total_count, progress_percent,
       rewatch_count, on_watchlist, raw_json, added_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, 0, 1, ?, datetime('now'), datetime('now'))`,
    id,
    result.mediaType,
    result.tvdbId,
    result.title,
    result.year,
    result.overview,
    result.posterUrl,
    result.mediaType === 'show' ? 0 : null,
    result.mediaType === 'show' ? 0 : null,
    JSON.stringify(result.raw ?? result),
  );
  if (inserted.changes === 0) return 'already_exists';

  // Best-effort immediate enrichment (episode catalog for shows). Failure
  // must not break the add — the item is already on the watchlist.
  try {
    const item = await db.getFirstAsync<MediaItem>(
      'SELECT * FROM media_items WHERE id = ?',
      id,
    );
    if (item) await enrichItem(db, item);
  } catch {
    // Left for Fetch Missing Metadata (metadata_fetched_at is still NULL).
  }
  return 'added';
}

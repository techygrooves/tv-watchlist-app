import type { SQLiteDatabase } from 'expo-sqlite';

import type { MediaItem } from '@/src/types';

/**
 * Watched/unwatched actions for movies and shows.
 *
 * Every action inserts a watch_events row (action = 'watched'|'unwatched',
 * source = 'manual') with the current ISO timestamp — the log is append-only
 * and never rewritten. Each mutator returns a snapshot of the fields it
 * changed so the UI can offer a one-tap Undo that restores the exact
 * previous state (the undo itself is logged too).
 *
 * Imported data is preserved:
 * - a movie's imported TV Time watchedAt is kept on unwatch (only
 *   app-created watched_at values are cleared);
 * - a show's imported progress (watched/total/pct from raw_json) is
 *   restored on unwatch, never zeroed;
 * - no historical watch dates are ever invented.
 */

export interface MediaSnapshot {
  id: string;
  is_watched: 0 | 1;
  watched_at: string | null;
  rewatch_count: number;
  watched_count: number | null;
  progress_percent: number | null;
}

export type WatchAction = 'watched' | 'unwatched';

function nowIso(): string {
  return new Date().toISOString();
}

function snapshotOf(item: MediaItem): MediaSnapshot {
  return {
    id: item.id,
    is_watched: item.is_watched,
    watched_at: item.watched_at,
    rewatch_count: item.rewatch_count,
    watched_count: item.watched_count,
    progress_percent: item.progress_percent,
  };
}

async function logEvent(
  db: SQLiteDatabase,
  mediaItemId: string,
  action: WatchAction,
  timestamp: string,
): Promise<void> {
  await db.runAsync(
    "INSERT INTO watch_events (media_item_id, action, watched_at, source, created_at) VALUES (?, ?, ?, 'manual', ?)",
    mediaItemId,
    action,
    timestamp,
    timestamp,
  );
}

/** The movie's imported watchedAt from TV Time, or null if it wasn't imported as watched. */
function importedWatchedAt(item: MediaItem): string | null {
  if (!item.raw_json) return null;
  try {
    const raw = JSON.parse(item.raw_json) as { watchedAt?: unknown };
    return typeof raw.watchedAt === 'string' ? raw.watchedAt : null;
  } catch {
    return null;
  }
}

/** Imported show progress (watched/pct) from TV Time, if available. */
function importedShowProgress(
  item: MediaItem,
): { watched: number; pct: number } | null {
  if (!item.raw_json) return null;
  try {
    const raw = JSON.parse(item.raw_json) as { watched?: unknown; pct?: unknown };
    if (typeof raw.watched === 'number' && typeof raw.pct === 'number') {
      return { watched: raw.watched, pct: raw.pct };
    }
    return null;
  } catch {
    return null;
  }
}

export async function markMovieWatched(
  db: SQLiteDatabase,
  item: MediaItem,
): Promise<MediaSnapshot> {
  const snapshot = snapshotOf(item);
  const timestamp = nowIso();
  // A movie seen before (imported watch date or an earlier watched event)
  // counts as a rewatch; a first watch keeps the count as-is.
  const seenBefore = item.watched_at !== null || importedWatchedAt(item) !== null;
  const rewatchCount = seenBefore ? item.rewatch_count + 1 : item.rewatch_count;

  await db.runAsync(
    "UPDATE media_items SET is_watched = 1, watched_at = ?, rewatch_count = ?, updated_at = datetime('now') WHERE id = ?",
    timestamp,
    rewatchCount,
    item.id,
  );
  await logEvent(db, item.id, 'watched', timestamp);
  return snapshot;
}

export async function markMovieUnwatched(
  db: SQLiteDatabase,
  item: MediaItem,
): Promise<MediaSnapshot> {
  const snapshot = snapshotOf(item);
  const timestamp = nowIso();
  // Only clear watched_at when this app set it; an imported TV Time
  // timestamp is preserved on the row.
  const imported = importedWatchedAt(item);
  const keepWatchedAt = imported !== null && item.watched_at === imported;

  await db.runAsync(
    "UPDATE media_items SET is_watched = 0, watched_at = ?, updated_at = datetime('now') WHERE id = ?",
    keepWatchedAt ? item.watched_at : null,
    item.id,
  );
  await logEvent(db, item.id, 'unwatched', timestamp);
  return snapshot;
}

export async function markShowWatched(
  db: SQLiteDatabase,
  item: MediaItem,
): Promise<MediaSnapshot> {
  const snapshot = snapshotOf(item);
  const timestamp = nowIso();
  await db.runAsync(
    "UPDATE media_items SET is_watched = 1, watched_count = COALESCE(total_count, watched_count), progress_percent = 100, updated_at = datetime('now') WHERE id = ?",
    item.id,
  );
  await logEvent(db, item.id, 'watched', timestamp);
  return snapshot;
}

export async function markShowUnwatched(
  db: SQLiteDatabase,
  item: MediaItem,
): Promise<MediaSnapshot> {
  const snapshot = snapshotOf(item);
  const timestamp = nowIso();
  // Restore the progress TV Time reported at import time where possible,
  // rather than zeroing the user's history.
  const imported = importedShowProgress(item);
  await db.runAsync(
    "UPDATE media_items SET is_watched = 0, watched_count = ?, progress_percent = ?, updated_at = datetime('now') WHERE id = ?",
    imported ? imported.watched : item.watched_count,
    imported ? imported.pct : item.progress_percent,
    item.id,
  );
  await logEvent(db, item.id, 'unwatched', timestamp);
  return snapshot;
}

/**
 * One-tap Undo: restores the exact snapshot taken before the last action and
 * logs the reversal as its own watch event.
 */
export async function restoreSnapshot(
  db: SQLiteDatabase,
  snapshot: MediaSnapshot,
): Promise<void> {
  const timestamp = nowIso();
  await db.runAsync(
    "UPDATE media_items SET is_watched = ?, watched_at = ?, rewatch_count = ?, watched_count = ?, progress_percent = ?, updated_at = datetime('now') WHERE id = ?",
    snapshot.is_watched,
    snapshot.watched_at,
    snapshot.rewatch_count,
    snapshot.watched_count,
    snapshot.progress_percent,
    snapshot.id,
  );
  await logEvent(db, snapshot.id, snapshot.is_watched === 1 ? 'watched' : 'unwatched', timestamp);
}

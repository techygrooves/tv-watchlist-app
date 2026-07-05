import type { SQLiteDatabase } from 'expo-sqlite';

import type { Episode, MediaItem } from '@/src/types';

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
  // Marking a show watched checks off every remaining episode too (like
  // TV Time). One show-level event is logged, not one per episode.
  await db.runAsync(
    'UPDATE episodes SET is_watched = 1, watched_at = ? WHERE media_item_id = ? AND is_watched = 0',
    timestamp,
    item.id,
  );
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
  // rather than zeroing the user's history. Episode rows go back to their
  // imported (unwatched) state to match.
  const imported = importedShowProgress(item);
  await db.runAsync(
    'UPDATE episodes SET is_watched = 0, watched_at = NULL WHERE media_item_id = ? AND is_watched = 1',
    item.id,
  );
  await db.runAsync(
    "UPDATE media_items SET is_watched = 0, watched_count = ?, progress_percent = ?, updated_at = datetime('now') WHERE id = ?",
    imported ? imported.watched : item.watched_count,
    imported ? imported.pct : item.progress_percent,
    item.id,
  );
  await logEvent(db, item.id, 'unwatched', timestamp);
  return snapshot;
}

export interface EpisodeSnapshot {
  episodeId: number;
  is_watched: 0 | 1;
  watched_at: string | null;
  show: MediaSnapshot;
}

async function logEpisodeEvent(
  db: SQLiteDatabase,
  mediaItemId: string,
  episodeId: number,
  action: WatchAction,
  timestamp: string,
): Promise<void> {
  await db.runAsync(
    "INSERT INTO watch_events (media_item_id, episode_id, action, watched_at, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)",
    mediaItemId,
    episodeId,
    action,
    timestamp,
    timestamp,
  );
}

/**
 * Recomputes the parent show's progress from its episode rows. The imported
 * episode rows cover exactly the unwatched set (verified against the TV Time
 * export: watched + unwatchedRegularEps == total for every show), so
 * watched = total − (rows still unwatched). Shows without a usable
 * total_count keep their imported counts untouched.
 */
async function recomputeShowProgress(db: SQLiteDatabase, mediaItemId: string): Promise<void> {
  await db.runAsync(
    `UPDATE media_items SET
       watched_count = CASE WHEN COALESCE(total_count, 0) > 0
         THEN total_count - (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_watched = 0)
         ELSE watched_count END,
       progress_percent = CASE WHEN COALESCE(total_count, 0) > 0
         THEN ROUND(100.0 * (total_count - (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_watched = 0)) / total_count, 1)
         ELSE progress_percent END,
       is_watched = CASE WHEN COALESCE(total_count, 0) > 0
         AND (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_watched = 0) = 0
         THEN 1 ELSE is_watched END,
       updated_at = datetime('now')
     WHERE id = ?`,
    mediaItemId,
  );
}

export async function markEpisodeWatched(
  db: SQLiteDatabase,
  show: MediaItem,
  episode: Episode,
): Promise<EpisodeSnapshot> {
  const snapshot: EpisodeSnapshot = {
    episodeId: episode.id,
    is_watched: episode.is_watched,
    watched_at: episode.watched_at,
    show: snapshotOf(show),
  };
  const timestamp = nowIso();
  await db.runAsync(
    'UPDATE episodes SET is_watched = 1, watched_at = ? WHERE id = ?',
    timestamp,
    episode.id,
  );
  await recomputeShowProgress(db, show.id);
  await logEpisodeEvent(db, show.id, episode.id, 'watched', timestamp);
  return snapshot;
}

export async function markEpisodeUnwatched(
  db: SQLiteDatabase,
  show: MediaItem,
  episode: Episode,
): Promise<EpisodeSnapshot> {
  const snapshot: EpisodeSnapshot = {
    episodeId: episode.id,
    is_watched: episode.is_watched,
    watched_at: episode.watched_at,
    show: snapshotOf(show),
  };
  const timestamp = nowIso();
  await db.runAsync(
    'UPDATE episodes SET is_watched = 0, watched_at = NULL WHERE id = ?',
    episode.id,
  );
  // A show that was fully watched is no longer.
  await db.runAsync('UPDATE media_items SET is_watched = 0 WHERE id = ?', show.id);
  await recomputeShowProgress(db, show.id);
  await logEpisodeEvent(db, show.id, episode.id, 'unwatched', timestamp);
  return snapshot;
}

/** Undo for an episode toggle: restores the episode row and the parent show's fields. */
export async function restoreEpisodeSnapshot(
  db: SQLiteDatabase,
  snapshot: EpisodeSnapshot,
): Promise<void> {
  const timestamp = nowIso();
  await db.runAsync(
    'UPDATE episodes SET is_watched = ?, watched_at = ? WHERE id = ?',
    snapshot.is_watched,
    snapshot.watched_at,
    snapshot.episodeId,
  );
  await db.runAsync(
    "UPDATE media_items SET is_watched = ?, watched_at = ?, rewatch_count = ?, watched_count = ?, progress_percent = ?, updated_at = datetime('now') WHERE id = ?",
    snapshot.show.is_watched,
    snapshot.show.watched_at,
    snapshot.show.rewatch_count,
    snapshot.show.watched_count,
    snapshot.show.progress_percent,
    snapshot.show.id,
  );
  await logEpisodeEvent(
    db,
    snapshot.show.id,
    snapshot.episodeId,
    snapshot.is_watched === 1 ? 'watched' : 'unwatched',
    timestamp,
  );
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

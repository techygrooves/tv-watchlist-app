import type { SQLiteDatabase } from 'expo-sqlite';

import { fetchMovie, fetchSeries, fetchSeriesEpisodes, TvdbError } from './tvdb';
import type { MediaItem } from '@/src/types';

/**
 * TVDB metadata enrichment.
 *
 * Fills poster_url / overview / year (and status only when previously
 * unknown) and, for shows, the full episode catalog. Hard rules:
 * - media_items.id, media_type, tvdb_id, raw_json, favorites, rewatch
 *   counts and every user watch_event are never touched;
 * - existing episode rows keep their is_watched / watched_at exactly;
 * - good existing values are never overwritten with empty API values;
 * - no historical watched dates are invented. Episodes the import counted
 *   as watched (not in unwatchedRegularEps, aired before the import) are
 *   marked watched with watched_at = NULL — status known, date unknown.
 */

export interface EnrichProgress {
  total: number;
  processed: number;
  updated: number;
  failed: number;
  skipped: number;
  needsReview: number;
  currentTitle: string | null;
  done: boolean;
}

export interface EnrichOptions {
  onProgress?: (progress: EnrichProgress) => void;
  shouldCancel?: () => boolean;
}

/** Items that still need metadata: never fetched successfully. Shows first. */
export async function listItemsNeedingMetadata(db: SQLiteDatabase): Promise<MediaItem[]> {
  return db.getAllAsync<MediaItem>(
    `SELECT * FROM media_items
     WHERE on_watchlist = 1 AND metadata_fetched_at IS NULL
     ORDER BY media_type DESC, title COLLATE NOCASE ASC`,
  );
}

function importedUnwatchedSet(item: MediaItem): Set<string> {
  const set = new Set<string>();
  if (!item.raw_json) return set;
  try {
    const raw = JSON.parse(item.raw_json) as {
      unwatchedRegularEps?: { season: number; episode: number }[];
    };
    for (const ep of raw.unwatchedRegularEps ?? []) {
      if (typeof ep?.season === 'number' && typeof ep?.episode === 'number') {
        set.add(`${ep.season}:${ep.episode}`);
      }
    }
  } catch {
    // Malformed raw_json — treat as no import knowledge.
  }
  return set;
}

function importedWatchedCount(item: MediaItem): number | null {
  if (!item.raw_json) return null;
  try {
    const raw = JSON.parse(item.raw_json) as { watched?: unknown };
    return typeof raw.watched === 'number' ? raw.watched : null;
  } catch {
    return null;
  }
}

async function importCutoffDate(db: SQLiteDatabase, item: MediaItem): Promise<string> {
  const row = await db.getFirstAsync<{ d: string | null }>(
    "SELECT MAX(imported_at) AS d FROM import_files WHERE status = 'parsed'",
  );
  // imported_at is 'YYYY-MM-DD HH:MM:SS'; air dates are 'YYYY-MM-DD'.
  return (row?.d ?? item.added_at).slice(0, 10);
}

/** Never replace a good value with an empty one. */
function keep<T>(current: T | null, incoming: T | null): T | null {
  return incoming ?? current;
}

/**
 * Enriches one show: media fields + full episode catalog with progress
 * reconciliation. Returns true when the derived watched count disagrees
 * with the imported one (needs review).
 */
async function enrichShow(db: SQLiteDatabase, item: MediaItem): Promise<{ needsReview: boolean }> {
  const info = await fetchSeries(db, item.tvdb_id);
  const catalog = await fetchSeriesEpisodes(db, item.tvdb_id);
  const unwatchedSet = importedUnwatchedSet(item);
  const cutoff = await importCutoffDate(db, item);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE media_items SET
         poster_url = COALESCE(?, poster_url),
         overview   = COALESCE(?, overview),
         year       = COALESCE(year, ?),
         status     = COALESCE(status, ?),
         metadata_fetched_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
      info.posterUrl,
      info.overview,
      info.year,
      info.status,
      item.id,
    );

    const upsert = await db.prepareAsync(
      `INSERT INTO episodes (
         media_item_id, tvdb_episode_id, season_number, episode_number,
         title, overview, air_date, runtime_minutes, is_special, is_watched, watched_at
       ) VALUES ($id, $tvdbEp, $season, $episode, $title, $overview, $aired, $runtime, $special, $watched, NULL)
       ON CONFLICT(media_item_id, season_number, episode_number) DO UPDATE SET
         tvdb_episode_id = COALESCE(excluded.tvdb_episode_id, tvdb_episode_id),
         title           = COALESCE(excluded.title, title),
         overview        = COALESCE(excluded.overview, overview),
         air_date        = COALESCE(excluded.air_date, air_date),
         runtime_minutes = COALESCE(excluded.runtime_minutes, runtime_minutes)`,
      // Note: is_watched / watched_at / raw_json are deliberately absent
      // from the UPDATE clause — user and imported state is preserved.
    );
    try {
      for (const ep of catalog) {
        // Specials are ignored by default unless the row already exists
        // (the conflict clause would then only update metadata).
        if (ep.seasonNumber === 0) {
          const existing = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM episodes WHERE media_item_id = ? AND season_number = 0 AND episode_number = ?',
            item.id,
            ep.episodeNumber,
          );
          if (!existing) continue;
        }
        // Watched-from-import: a regular episode the export did not list as
        // unwatched and that had aired by the import date. watched_at stays
        // NULL — the export carries no per-episode dates.
        const key = `${ep.seasonNumber}:${ep.episodeNumber}`;
        const knownWatched =
          ep.seasonNumber > 0 &&
          !unwatchedSet.has(key) &&
          ep.airDate !== null &&
          ep.airDate <= cutoff;
        await upsert.executeAsync({
          $id: item.id,
          $tvdbEp: ep.tvdbEpisodeId,
          $season: ep.seasonNumber,
          $episode: ep.episodeNumber,
          $title: ep.title,
          $overview: ep.overview,
          $aired: ep.airDate,
          $runtime: ep.runtimeMinutes,
          $special: ep.seasonNumber === 0 ? 1 : 0,
          $watched: knownWatched ? 1 : 0,
        });
      }
    } finally {
      await upsert.finalizeAsync();
    }

    // With a full catalog the show's counts derive from episode rows:
    // total = regular episodes known, watched = those marked watched.
    // The imported counts remain untouched inside raw_json.
    await db.runAsync(
      `UPDATE media_items SET
         watched_count = (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0 AND e.is_watched = 1),
         total_count   = (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0),
         progress_percent = CASE
           WHEN (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0) > 0
           THEN ROUND(100.0 * (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0 AND e.is_watched = 1)
                / (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0), 1)
           ELSE progress_percent END,
         is_watched = CASE
           WHEN (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0) > 0
            AND (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0 AND e.is_watched = 0) = 0
           THEN 1 ELSE is_watched END,
         updated_at = datetime('now')
       WHERE id = ?`,
      item.id,
    );
  });

  // Flag disagreements between derived and imported watched counts so the
  // user knows this show deserves a look (e.g. TVDB renumbered episodes).
  const imported = importedWatchedCount(item);
  if (imported !== null) {
    const derived = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM episodes WHERE media_item_id = ? AND is_special = 0 AND is_watched = 1',
      item.id,
    );
    if ((derived?.n ?? 0) !== imported) return { needsReview: true };
  }
  return { needsReview: false };
}

async function enrichMovie(db: SQLiteDatabase, item: MediaItem): Promise<void> {
  const info = await fetchMovie(db, item.tvdb_id);
  await db.runAsync(
    `UPDATE media_items SET
       poster_url = COALESCE(?, poster_url),
       overview   = COALESCE(?, overview),
       year       = COALESCE(year, ?),
       status     = COALESCE(status, ?),
       metadata_fetched_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`,
    info.posterUrl,
    info.overview,
    info.year,
    info.status,
    item.id,
  );
}

/**
 * Processes every item that still needs metadata, sequentially, reporting
 * progress after each item. Individual failures never abort the run —
 * failed items stay eligible for the next run (retry = tap again).
 */
export async function enrichMissingMetadata(
  db: SQLiteDatabase,
  { onProgress, shouldCancel }: EnrichOptions = {},
): Promise<EnrichProgress> {
  const items = await listItemsNeedingMetadata(db);
  const progress: EnrichProgress = {
    total: items.length,
    processed: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    needsReview: 0,
    currentTitle: null,
    done: false,
  };
  onProgress?.({ ...progress });

  for (const item of items) {
    if (shouldCancel?.()) break;
    progress.currentTitle = item.title;
    onProgress?.({ ...progress });
    try {
      if (item.media_type === 'show') {
        const { needsReview } = await enrichShow(db, item);
        if (needsReview) progress.needsReview++;
      } else {
        await enrichMovie(db, item);
      }
      progress.updated++;
    } catch (err) {
      if (err instanceof TvdbError && err.kind === 'not_found') {
        // No TVDB record — mark fetched so it isn't retried forever.
        await db.runAsync(
          "UPDATE media_items SET metadata_fetched_at = datetime('now') WHERE id = ?",
          item.id,
        );
        progress.skipped++;
      } else if (err instanceof TvdbError && (err.kind === 'missing_key' || err.kind === 'invalid_key')) {
        throw err; // configuration problem — stop the whole run with a clear message
      } else {
        progress.failed++;
      }
    }
    progress.processed++;
    onProgress?.({ ...progress });
  }

  progress.currentTitle = null;
  progress.done = true;
  onProgress?.({ ...progress });
  return progress;
}

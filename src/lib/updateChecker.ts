import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from './db';
import { fetchSeriesEpisodes, TvdbError } from './tvdb';
import type { MediaItem } from '@/src/types';

/**
 * Show-update checker: re-fetches the TVDB episode list for shows whose
 * catalog has already been fetched (Fetch Missing Metadata handles the
 * initial catalog) and inserts anything new.
 *
 * Safety rules:
 * - new episodes are always inserted unwatched, never marked watched;
 * - existing rows keep is_watched / watched_at / raw_json untouched —
 *   only missing/changed metadata (title, air date, ids) is refreshed;
 * - episodes are never deleted;
 * - failures on one show never abort the run.
 *
 * Shows are processed oldest-checked-first (last_checked_at rotation), so
 * capped background runs still cycle through the whole library over time.
 */

export const LAST_CHECK_KEY = 'last_update_check';
export const LAST_CHECK_NEW_COUNT_KEY = 'last_update_new_count';

export interface UpdateCheckProgress {
  totalShows: number;
  checkedShows: number;
  newEpisodes: number;
  failedShows: number;
  currentTitle: string | null;
  done: boolean;
}

export interface UpdateCheckOptions {
  /** Max shows per run (background runs use a small cap; manual runs all). */
  limit?: number;
  onProgress?: (progress: UpdateCheckProgress) => void;
  shouldCancel?: () => boolean;
}

async function checkOneShow(db: SQLiteDatabase, show: MediaItem): Promise<number> {
  const catalog = await fetchSeriesEpisodes(db, show.tvdb_id);
  let newEpisodes = 0;

  await db.withTransactionAsync(async () => {
    const existing = await db.getAllAsync<{ season_number: number; episode_number: number }>(
      'SELECT season_number, episode_number FROM episodes WHERE media_item_id = ?',
      show.id,
    );
    const known = new Set(existing.map((e) => `${e.season_number}:${e.episode_number}`));

    const insert = await db.prepareAsync(
      `INSERT INTO episodes (
         media_item_id, tvdb_episode_id, season_number, episode_number,
         title, overview, air_date, runtime_minutes, is_special,
         is_watched, watched_at, added_at
       ) VALUES ($id, $tvdbEp, $season, $episode, $title, $overview, $aired, $runtime, $special, 0, NULL, datetime('now'))`,
    );
    const refresh = await db.prepareAsync(
      `UPDATE episodes SET
         tvdb_episode_id = COALESCE($tvdbEp, tvdb_episode_id),
         title           = COALESCE($title, title),
         overview        = COALESCE($overview, overview),
         air_date        = COALESCE($aired, air_date),
         runtime_minutes = COALESCE($runtime, runtime_minutes)
       WHERE media_item_id = $id AND season_number = $season AND episode_number = $episode`,
    );
    try {
      for (const ep of catalog) {
        const key = `${ep.seasonNumber}:${ep.episodeNumber}`;
        if (known.has(key)) {
          await refresh.executeAsync({
            $id: show.id,
            $tvdbEp: ep.tvdbEpisodeId,
            $season: ep.seasonNumber,
            $episode: ep.episodeNumber,
            $title: ep.title,
            $overview: ep.overview,
            $aired: ep.airDate,
            $runtime: ep.runtimeMinutes,
          });
        } else {
          // Specials stay opt-in: skip season 0 unless already tracked.
          if (ep.seasonNumber === 0) continue;
          await insert.executeAsync({
            $id: show.id,
            $tvdbEp: ep.tvdbEpisodeId,
            $season: ep.seasonNumber,
            $episode: ep.episodeNumber,
            $title: ep.title,
            $overview: ep.overview,
            $aired: ep.airDate,
            $runtime: ep.runtimeMinutes,
            $special: 0,
          });
          newEpisodes++;
        }
      }
    } finally {
      await insert.finalizeAsync();
      await refresh.finalizeAsync();
    }

    // New rows change the totals; watched counts derive from rows and are
    // untouched by inserts (new rows are unwatched).
    if (newEpisodes > 0) {
      await db.runAsync(
        `UPDATE media_items SET
           total_count = (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0),
           watched_count = (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0 AND e.is_watched = 1),
           progress_percent = CASE
             WHEN (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0) > 0
             THEN ROUND(100.0 * (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0 AND e.is_watched = 1)
                  / (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0), 1)
             ELSE progress_percent END,
           is_watched = CASE WHEN ? > 0 THEN 0 ELSE is_watched END,
           updated_at = datetime('now')
         WHERE id = ?`,
        newEpisodes,
        show.id,
      );
    }
    await db.runAsync(
      "UPDATE media_items SET last_checked_at = datetime('now') WHERE id = ?",
      show.id,
    );
  });

  return newEpisodes;
}

export async function checkForShowUpdates(
  db: SQLiteDatabase,
  { limit, onProgress, shouldCancel }: UpdateCheckOptions = {},
): Promise<UpdateCheckProgress> {
  // Only shows with a fetched catalog are compared — Fetch Missing Metadata
  // owns the initial catalog (and its careful import reconciliation).
  const shows = await db.getAllAsync<MediaItem>(
    `SELECT * FROM media_items
     WHERE media_type = 'show' AND on_watchlist = 1 AND metadata_fetched_at IS NOT NULL
     ORDER BY last_checked_at IS NOT NULL, last_checked_at ASC
     ${limit ? 'LIMIT ' + Math.floor(limit) : ''}`,
  );

  const progress: UpdateCheckProgress = {
    totalShows: shows.length,
    checkedShows: 0,
    newEpisodes: 0,
    failedShows: 0,
    currentTitle: null,
    done: false,
  };
  onProgress?.({ ...progress });

  for (const show of shows) {
    if (shouldCancel?.()) break;
    progress.currentTitle = show.title;
    onProgress?.({ ...progress });
    try {
      progress.newEpisodes += await checkOneShow(db, show);
    } catch (err) {
      // A configuration problem stops the run with a clear message;
      // anything else (network blip, missing record) just counts as failed.
      if (err instanceof TvdbError && (err.kind === 'missing_key' || err.kind === 'invalid_key')) {
        throw err;
      }
      progress.failedShows++;
    }
    progress.checkedShows++;
    onProgress?.({ ...progress });
  }

  await setSetting(db, LAST_CHECK_KEY, new Date().toISOString());
  await setSetting(db, LAST_CHECK_NEW_COUNT_KEY, String(progress.newEpisodes));

  progress.currentTitle = null;
  progress.done = true;
  onProgress?.({ ...progress });
  return progress;
}

export interface UpdateCheckStatusInfo {
  lastCheckAt: string | null;
  lastCheckNewEpisodes: number;
}

export async function getUpdateCheckStatus(db: SQLiteDatabase): Promise<UpdateCheckStatusInfo> {
  const [lastCheckAt, lastNew] = await Promise.all([
    getSetting(db, LAST_CHECK_KEY),
    getSetting(db, LAST_CHECK_NEW_COUNT_KEY),
  ]);
  return {
    lastCheckAt,
    lastCheckNewEpisodes: lastNew ? Number(lastNew) || 0 : 0,
  };
}

/** True when the last check is older than ~12h (the twice-daily cadence). */
export async function isCheckStale(db: SQLiteDatabase): Promise<boolean> {
  const last = await getSetting(db, LAST_CHECK_KEY);
  if (!last) return true;
  const age = Date.now() - new Date(last).getTime();
  return Number.isNaN(age) || age > 12 * 60 * 60 * 1000;
}

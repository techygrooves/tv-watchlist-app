import type { SQLiteDatabase } from 'expo-sqlite';

import type { ParsedTvTimeExport, TvTimeMovie, TvTimeShow } from './tvtimeParser';

export interface ImportFileMeta {
  name: string;
  uri: string | null;
  size: number | null;
}

export interface ImportResult {
  showsSaved: number;
  moviesSaved: number;
  episodesSaved: number;
  watchEventsSaved: number;
  importFileId: number;
}

const UPSERT_MEDIA_ITEM = `
INSERT INTO media_items (
  id, media_type, tvdb_id, imdb_id, tvtime_uuid, title, year, status,
  is_favorite, is_watched, watched_count, total_count, progress_percent,
  watched_at, rewatch_count, raw_json, updated_at
) VALUES (
  $id, $media_type, $tvdb_id, $imdb_id, $tvtime_uuid, $title, $year, $status,
  $is_favorite, $is_watched, $watched_count, $total_count, $progress_percent,
  $watched_at, $rewatch_count, $raw_json, datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
  imdb_id          = excluded.imdb_id,
  tvtime_uuid      = excluded.tvtime_uuid,
  title            = excluded.title,
  year             = excluded.year,
  status           = excluded.status,
  is_favorite      = excluded.is_favorite,
  is_watched       = excluded.is_watched,
  watched_count    = excluded.watched_count,
  total_count      = excluded.total_count,
  progress_percent = excluded.progress_percent,
  watched_at       = excluded.watched_at,
  rewatch_count    = excluded.rewatch_count,
  raw_json         = excluded.raw_json,
  updated_at       = datetime('now');
`;

function showIsWatched(show: TvTimeShow): boolean {
  // Watched only when TV Time reports 100% or every episode seen.
  // The total > 0 guard keeps shows with no episode data from counting.
  return show.pct === 100 || (show.total > 0 && show.watched === show.total);
}

/**
 * Saves a parsed TV Time export. Runs inside one transaction so a failure
 * mid-import rolls back and leaves the database untouched.
 * (withTransactionAsync, not withExclusiveTransactionAsync — the exclusive
 * variant is unsupported on web.) Re-importing is safe: media items upsert
 * on their id, and each item's imported episodes/watch events are replaced
 * rather than duplicated.
 */
export async function saveTvTimeImport(
  db: SQLiteDatabase,
  parsed: ParsedTvTimeExport,
  file: ImportFileMeta,
): Promise<ImportResult> {
  const result: ImportResult = {
    showsSaved: 0,
    moviesSaved: 0,
    episodesSaved: 0,
    watchEventsSaved: 0,
    importFileId: 0,
  };

  await db.withTransactionAsync(async () => {
    const upsertItem = await db.prepareAsync(UPSERT_MEDIA_ITEM);
    // Only unwatched imported rows are replaced — episodes the user marked
    // watched in the app survive re-imports (INSERT OR IGNORE skips them
    // via the (media_item_id, season, episode) unique constraint).
    const clearEpisodes = await db.prepareAsync(
      'DELETE FROM episodes WHERE media_item_id = $id AND is_watched = 0',
    );
    const insertEpisode = await db.prepareAsync(
      'INSERT OR IGNORE INTO episodes (media_item_id, season_number, episode_number, is_special, raw_json) VALUES ($id, $season, $episode, 0, $raw)',
    );
    const clearImportedEvents = await db.prepareAsync(
      "DELETE FROM watch_events WHERE media_item_id = $id AND source = 'imported_watched'",
    );
    const insertWatchEvent = await db.prepareAsync(
      "INSERT INTO watch_events (media_item_id, action, watched_at, source) VALUES ($id, 'watched', $watched_at, 'imported_watched')",
    );

    try {
      for (const show of parsed.shows) {
        const id = `show:${show.tvdbId}`;
        await upsertItem.executeAsync({
          $id: id,
          $media_type: 'show',
          $tvdb_id: show.tvdbId,
          $imdb_id: show.imdbId ?? null,
          $tvtime_uuid: null,
          $title: show.title,
          $year: null,
          $status: show.status ?? null,
          $is_favorite: show.isFavorite ? 1 : 0,
          $is_watched: showIsWatched(show) ? 1 : 0,
          $watched_count: show.watched ?? null,
          $total_count: show.total ?? null,
          $progress_percent: show.pct ?? null,
          $watched_at: null,
          $rewatch_count: 0,
          $raw_json: JSON.stringify(show),
        });
        result.showsSaved++;

        // Placeholder unwatched episodes only — the export has no
        // per-episode watch dates, so none are invented.
        await clearEpisodes.executeAsync({ $id: id });
        for (const ep of show.unwatchedRegularEps ?? []) {
          if (typeof ep?.season !== 'number' || typeof ep?.episode !== 'number') continue;
          await insertEpisode.executeAsync({
            $id: id,
            $season: ep.season,
            $episode: ep.episode,
            $raw: JSON.stringify(ep),
          });
          result.episodesSaved++;
        }
      }

      for (const movie of parsed.movies) {
        const id = `movie:${movie.tvdbId}`;
        await upsertItem.executeAsync({
          $id: id,
          $media_type: 'movie',
          $tvdb_id: movie.tvdbId,
          $imdb_id: movie.imdbId ?? null,
          $tvtime_uuid: movie.uuid ?? null,
          $title: movie.title,
          $year: movie.year ?? null,
          $status: null,
          $is_favorite: movie.isFavorite ? 1 : 0,
          $is_watched: movie.isWatched ? 1 : 0,
          $watched_count: null,
          $total_count: null,
          $progress_percent: null,
          $watched_at: movie.watchedAt ?? null,
          $rewatch_count: movie.rewatchCount ?? 0,
          $raw_json: JSON.stringify(movie),
        });
        result.moviesSaved++;

        await clearImportedEvents.executeAsync({ $id: id });
        if (movie.isWatched && movie.watchedAt) {
          await insertWatchEvent.executeAsync({ $id: id, $watched_at: movie.watchedAt });
          result.watchEventsSaved++;
        }
      }
    } finally {
      await upsertItem.finalizeAsync();
      await clearEpisodes.finalizeAsync();
      await insertEpisode.finalizeAsync();
      await clearImportedEvents.finalizeAsync();
      await insertWatchEvent.finalizeAsync();
    }

    // Re-import reconciliation: the upsert above wrote the file's counts,
    // but user changes survive on episode rows (watched rows are kept and
    // enriched catalogs aren't re-imported). Bring show-level counts back
    // in line with the rows so the header never contradicts the checklist.
    // - enriched shows (full TVDB catalog): totals derive entirely from rows;
    // - import-only shows: total stays the file's value, watched = total
    //   minus the remaining unwatched rows (rows cover exactly that set).
    await db.execAsync(`
      UPDATE media_items SET
        total_count = CASE
          WHEN metadata_fetched_at IS NOT NULL
            THEN (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0)
          ELSE total_count END,
        watched_count = CASE
          WHEN metadata_fetched_at IS NOT NULL
            THEN (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0 AND e.is_watched = 1)
          ELSE MAX(0, COALESCE(total_count, 0) - (SELECT COUNT(*) FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_special = 0 AND e.is_watched = 0))
          END,
        updated_at = datetime('now')
      WHERE media_type = 'show'
        AND (metadata_fetched_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_watched = 1));
      UPDATE media_items SET
        progress_percent = CASE WHEN COALESCE(total_count, 0) > 0
          THEN ROUND(100.0 * watched_count / total_count, 1) ELSE progress_percent END,
        is_watched = CASE WHEN COALESCE(total_count, 0) > 0 AND watched_count >= total_count THEN 1 ELSE 0 END
      WHERE media_type = 'show'
        AND (metadata_fetched_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM episodes e WHERE e.media_item_id = media_items.id AND e.is_watched = 1));
    `);

    const record = await db.runAsync(
      `INSERT INTO import_files (file_name, file_uri, file_size, status, shows_count, movies_count, raw_summary)
       VALUES (?, ?, ?, 'parsed', ?, ?, ?)`,
      file.name,
      file.uri,
      file.size,
      result.showsSaved,
      result.moviesSaved,
      JSON.stringify(parsed.summary),
    );
    result.importFileId = record.lastInsertRowId;
  });

  return result;
}

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
    const clearEpisodes = await db.prepareAsync(
      'DELETE FROM episodes WHERE media_item_id = $id',
    );
    const insertEpisode = await db.prepareAsync(
      'INSERT OR IGNORE INTO episodes (media_item_id, season_number, episode_number) VALUES ($id, $season, $episode)',
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

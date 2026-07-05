import type { SQLiteDatabase } from 'expo-sqlite';

import type { Episode, ImportFile, MediaItem } from '@/src/types';

// Title search uses instr(lower(title), lower(?)) — a literal, case-
// insensitive substring match. LIKE-with-bound-parameter misbehaves on the
// wa-sqlite web driver, and instr needs no wildcard escaping at all.
const TITLE_MATCH_SQL = 'AND instr(lower(title), lower(?)) > 0';

export type ShowFilter =
  | 'all'
  | 'in_progress'
  | 'completed'
  | 'favorites'
  | 'not_started'
  | 'continuing';

const SHOW_FILTER_SQL: Record<ShowFilter, string> = {
  all: '',
  in_progress:
    'AND COALESCE(watched_count, 0) > 0 AND COALESCE(progress_percent, 0) < 100 AND is_watched = 0',
  completed: 'AND (is_watched = 1 OR COALESCE(progress_percent, 0) >= 100)',
  favorites: 'AND is_favorite = 1',
  not_started: 'AND COALESCE(watched_count, 0) = 0 AND is_watched = 0',
  continuing: "AND status = 'continuing'",
};

/**
 * Shows for the Shows tab: in-progress first (some episodes watched but not
 * all), then favorites, then title.
 */
export async function listShows(
  db: SQLiteDatabase,
  filter: ShowFilter = 'all',
  search = '',
): Promise<MediaItem[]> {
  const term = search.trim();
  const params: string[] = term ? [term] : [];
  return db.getAllAsync<MediaItem>(
    `SELECT * FROM media_items
     WHERE media_type = 'show' AND on_watchlist = 1 ${SHOW_FILTER_SQL[filter]} ${term ? TITLE_MATCH_SQL : ''}
     ORDER BY
       (COALESCE(watched_count, 0) > 0 AND COALESCE(progress_percent, 0) < 100 AND is_watched = 0) DESC,
       is_favorite DESC,
       title COLLATE NOCASE ASC`,
    ...params,
  );
}

export type MovieFilter = 'all' | 'watched' | 'unwatched' | 'favorites';

const MOVIE_FILTER_SQL: Record<MovieFilter, string> = {
  all: '',
  watched: 'AND is_watched = 1',
  unwatched: 'AND is_watched = 0',
  favorites: 'AND is_favorite = 1',
};

/** Movies: favorites first, then most recently watched, then title. */
export async function listMovies(
  db: SQLiteDatabase,
  filter: MovieFilter = 'all',
  search = '',
): Promise<MediaItem[]> {
  const term = search.trim();
  const params: string[] = term ? [term] : [];
  return db.getAllAsync<MediaItem>(
    `SELECT * FROM media_items
     WHERE media_type = 'movie' AND on_watchlist = 1 ${MOVIE_FILTER_SQL[filter]} ${term ? TITLE_MATCH_SQL : ''}
     ORDER BY
       is_favorite DESC,
       (watched_at IS NULL) ASC,
       watched_at DESC,
       title COLLATE NOCASE ASC`,
    ...params,
  );
}

export async function getMediaItem(db: SQLiteDatabase, id: string): Promise<MediaItem | null> {
  return db.getFirstAsync<MediaItem>('SELECT * FROM media_items WHERE id = ?', id);
}

/** All known episode rows for a show, ordered for a season-grouped checklist. */
export async function listEpisodes(db: SQLiteDatabase, mediaItemId: string): Promise<Episode[]> {
  return db.getAllAsync<Episode>(
    'SELECT * FROM episodes WHERE media_item_id = ? ORDER BY season_number, episode_number',
    mediaItemId,
  );
}

export interface EpisodeStats {
  episodeRows: number;
  watchedEpisodes: number;
  unwatchedEpisodes: number;
}

export async function getEpisodeStats(db: SQLiteDatabase): Promise<EpisodeStats> {
  const row = await db.getFirstAsync<EpisodeStats>(
    `SELECT
       COUNT(*) AS episodeRows,
       SUM(is_watched = 1) AS watchedEpisodes,
       SUM(is_watched = 0) AS unwatchedEpisodes
     FROM episodes`,
  );
  return {
    episodeRows: row?.episodeRows ?? 0,
    watchedEpisodes: row?.watchedEpisodes ?? 0,
    unwatchedEpisodes: row?.unwatchedEpisodes ?? 0,
  };
}

export async function listImportFiles(db: SQLiteDatabase, limit = 10): Promise<ImportFile[]> {
  return db.getAllAsync<ImportFile>(
    'SELECT * FROM import_files ORDER BY imported_at DESC, id DESC LIMIT ?',
    limit,
  );
}

export interface AppStats {
  totalShows: number;
  totalMovies: number;
  watchedMovies: number;
  unwatchedMovies: number;
  favoriteShows: number;
  favoriteMovies: number;
  completedShows: number;
  inProgressShows: number;
  notStartedShows: number;
  watchEventsCount: number;
  lastImportDate: string | null;
}

export async function getAppStats(db: SQLiteDatabase): Promise<AppStats> {
  const media = await db.getFirstAsync<Omit<AppStats, 'watchEventsCount' | 'lastImportDate'>>(
    `SELECT
       SUM(media_type = 'show')  AS totalShows,
       SUM(media_type = 'movie') AS totalMovies,
       SUM(media_type = 'movie' AND is_watched = 1) AS watchedMovies,
       SUM(media_type = 'movie' AND is_watched = 0) AS unwatchedMovies,
       SUM(media_type = 'show'  AND is_favorite = 1) AS favoriteShows,
       SUM(media_type = 'movie' AND is_favorite = 1) AS favoriteMovies,
       SUM(media_type = 'show'  AND (is_watched = 1 OR COALESCE(progress_percent, 0) >= 100)) AS completedShows,
       SUM(media_type = 'show'  AND COALESCE(watched_count, 0) > 0 AND COALESCE(progress_percent, 0) < 100 AND is_watched = 0) AS inProgressShows,
       SUM(media_type = 'show'  AND COALESCE(watched_count, 0) = 0 AND is_watched = 0) AS notStartedShows
     FROM media_items WHERE on_watchlist = 1`,
  );
  const events = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM watch_events');
  const lastImport = await db.getFirstAsync<{ d: string | null }>(
    "SELECT MAX(imported_at) AS d FROM import_files WHERE status = 'parsed'",
  );
  return {
    totalShows: media?.totalShows ?? 0,
    totalMovies: media?.totalMovies ?? 0,
    watchedMovies: media?.watchedMovies ?? 0,
    unwatchedMovies: media?.unwatchedMovies ?? 0,
    favoriteShows: media?.favoriteShows ?? 0,
    favoriteMovies: media?.favoriteMovies ?? 0,
    completedShows: media?.completedShows ?? 0,
    inProgressShows: media?.inProgressShows ?? 0,
    notStartedShows: media?.notStartedShows ?? 0,
    watchEventsCount: events?.n ?? 0,
    lastImportDate: lastImport?.d ?? null,
  };
}

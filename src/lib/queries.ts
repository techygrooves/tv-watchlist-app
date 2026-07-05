import type { SQLiteDatabase } from 'expo-sqlite';

import type { ImportFile, MediaItem } from '@/src/types';

/**
 * Shows for the Shows tab: in-progress first (some episodes watched but not
 * all), then favorites, then title.
 */
export async function listShows(db: SQLiteDatabase): Promise<MediaItem[]> {
  return db.getAllAsync<MediaItem>(
    `SELECT * FROM media_items
     WHERE media_type = 'show' AND on_watchlist = 1
     ORDER BY
       (COALESCE(watched_count, 0) > 0 AND COALESCE(progress_percent, 0) < 100) DESC,
       is_favorite DESC,
       title COLLATE NOCASE ASC`,
  );
}

export type MovieFilter = 'all' | 'watched' | 'unwatched' | 'favorites';

export async function listMovies(
  db: SQLiteDatabase,
  filter: MovieFilter,
): Promise<MediaItem[]> {
  const where =
    filter === 'watched'
      ? 'AND is_watched = 1'
      : filter === 'unwatched'
        ? 'AND is_watched = 0'
        : filter === 'favorites'
          ? 'AND is_favorite = 1'
          : '';
  return db.getAllAsync<MediaItem>(
    `SELECT * FROM media_items
     WHERE media_type = 'movie' AND on_watchlist = 1 ${where}
     ORDER BY is_favorite DESC, title COLLATE NOCASE ASC`,
  );
}

export async function listImportFiles(db: SQLiteDatabase, limit = 10): Promise<ImportFile[]> {
  return db.getAllAsync<ImportFile>(
    'SELECT * FROM import_files ORDER BY imported_at DESC, id DESC LIMIT ?',
    limit,
  );
}

/**
 * Shared domain types. These mirror the SQLite schema in src/lib/db.ts.
 *
 * Media rows are keyed as "show:{tvdbId}" / "movie:{tvdbId}" — the TVDB
 * numeric ID is the canonical external identifier, never the title.
 */

export type MediaType = 'show' | 'movie';

export interface MediaItem {
  id: string;
  media_type: MediaType;
  tvdb_id: number;
  imdb_id: string | null;
  tvtime_uuid: string | null;
  title: string;
  year: number | null;
  status: string | null;
  overview: string | null;
  poster_url: string | null;
  is_favorite: 0 | 1;
  is_watched: 0 | 1;
  watched_count: number | null;
  total_count: number | null;
  progress_percent: number | null;
  watched_at: string | null;
  rewatch_count: number;
  on_watchlist: 0 | 1;
  raw_json: string | null;
  metadata_fetched_at: string | null;
  added_at: string;
  updated_at: string;
}

export interface Episode {
  id: number;
  media_item_id: string;
  tvdb_episode_id: number | null;
  season_number: number;
  episode_number: number;
  title: string | null;
  overview: string | null;
  air_date: string | null;
  runtime_minutes: number | null;
  is_special: 0 | 1;
  is_watched: 0 | 1;
  watched_at: string | null;
  raw_json: string | null;
}

export type WatchSource = 'manual' | 'imported_watched';

export interface WatchEvent {
  id: number;
  media_item_id: string;
  episode_id: number | null;
  watched_at: string;
  source: WatchSource;
  created_at: string;
}

export type ImportStatus = 'pending' | 'parsed' | 'failed';

export interface ImportFile {
  id: number;
  file_name: string;
  file_uri: string | null;
  file_size: number | null;
  status: ImportStatus;
  shows_count: number | null;
  movies_count: number | null;
  raw_summary: string | null;
  error: string | null;
  imported_at: string;
}

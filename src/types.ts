/**
 * Shared domain types. These mirror the SQLite schema in src/lib/db.ts.
 *
 * The TVDB numeric ID is the canonical *external* identifier for every show
 * and movie (never the title). The local `id` column is an internal
 * auto-increment key; rows are unique on (tvdb_id, media_type).
 */

export type MediaType = 'show' | 'movie';

export interface MediaItem {
  id: number;
  tvdb_id: number;
  media_type: MediaType;
  title: string;
  year: number | null;
  overview: string | null;
  poster_url: string | null;
  imdb_id: string | null;
  tvtime_uuid: string | null;
  status: string | null;
  is_favorite: 0 | 1;
  on_watchlist: 0 | 1;
  rewatch_count: number;
  added_at: string;
  updated_at: string;
}

export interface Episode {
  id: number;
  media_item_id: number;
  tvdb_episode_id: number | null;
  season_number: number;
  episode_number: number;
  title: string | null;
  overview: string | null;
  air_date: string | null;
  runtime_minutes: number | null;
}

export type WatchSource = 'manual' | 'import';

export interface WatchEvent {
  id: number;
  media_item_id: number;
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
  item_count: number | null;
  error: string | null;
  imported_at: string;
}

/**
 * SQLite schema, versioned with PRAGMA user_version.
 *
 * Design notes:
 * - media_items holds both shows and movies, discriminated by media_type.
 *   The TVDB numeric ID is the canonical external identifier — rows are
 *   unique on (tvdb_id, media_type), never on title.
 * - episodes belong to a show-type media_item (populated in a later phase
 *   from TVDB metadata / import data).
 * - watch_events is an append-only log: marking something watched inserts a
 *   row, "undo" deletes the most recent row. episode_id is NULL for movies
 *   and for whole-show events.
 * - import_files records every TV Time HTML file the user has imported.
 * - app_settings is a simple key/value store (last update check, etc).
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS media_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tvdb_id       INTEGER NOT NULL,
  media_type    TEXT    NOT NULL CHECK (media_type IN ('show', 'movie')),
  title         TEXT    NOT NULL,
  year          INTEGER,
  overview      TEXT,
  poster_url    TEXT,
  imdb_id       TEXT,
  tvtime_uuid   TEXT,
  status        TEXT,
  is_favorite   INTEGER NOT NULL DEFAULT 0,
  on_watchlist  INTEGER NOT NULL DEFAULT 1,
  rewatch_count INTEGER NOT NULL DEFAULT 0,
  added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tvdb_id, media_type)
);

CREATE TABLE IF NOT EXISTS episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id   INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tvdb_episode_id INTEGER,
  season_number   INTEGER NOT NULL,
  episode_number  INTEGER NOT NULL,
  title           TEXT,
  overview        TEXT,
  air_date        TEXT,
  runtime_minutes INTEGER,
  UNIQUE (media_item_id, season_number, episode_number)
);

CREATE TABLE IF NOT EXISTS watch_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  episode_id    INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  watched_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  source        TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name   TEXT    NOT NULL,
  file_uri    TEXT,
  file_size   INTEGER,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'parsed', 'failed')),
  item_count  INTEGER,
  error       TEXT,
  imported_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_items_type     ON media_items (media_type, on_watchlist);
CREATE INDEX IF NOT EXISTS idx_episodes_media       ON episodes (media_item_id, season_number, episode_number);
CREATE INDEX IF NOT EXISTS idx_watch_events_media   ON watch_events (media_item_id, watched_at);
CREATE INDEX IF NOT EXISTS idx_watch_events_episode ON watch_events (episode_id);
`;

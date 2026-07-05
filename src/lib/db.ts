import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'tv-watchlist.db';

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

/**
 * Runs on app start via <SQLiteProvider onInit={migrateDb}>. Creates the
 * schema on first launch and applies stepwise migrations on upgrades,
 * tracked with PRAGMA user_version.
 */
export async function migrateDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;
  if (currentVersion >= SCHEMA_VERSION) return;

  if (currentVersion < 1) {
    await db.execAsync(SCHEMA_SQL);
  }
  // Future migrations: if (currentVersion < 2) { ... }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** Simple key/value helpers backed by the app_settings table. */
export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/** Records a picked TV Time export file; parsing happens in a later phase. */
export async function recordImportFile(
  db: SQLiteDatabase,
  file: { name: string; uri: string | null; size: number | null },
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO import_files (file_name, file_uri, file_size) VALUES (?, ?, ?)',
    file.name,
    file.uri,
    file.size,
  );
  return result.lastInsertRowId;
}

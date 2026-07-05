import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'tv-watchlist.db';

/**
 * SQLite schema, versioned with PRAGMA user_version.
 *
 * Design notes:
 * - media_items holds both shows and movies, discriminated by media_type.
 *   The row id is "show:{tvdbId}" / "movie:{tvdbId}" — the TVDB numeric ID
 *   is the canonical external identifier, never the title.
 * - episodes: for imported shows these are the *unwatched* regular episodes
 *   reported by TV Time (placeholders; no titles/dates until a later phase).
 * - watch_events is an append-only log. Movie imports create
 *   'imported_watched' events carrying the original TV Time watchedAt
 *   timestamp; manual toggles (Phase 3) will create 'manual' events and
 *   undo deletes the most recent row. Show episode dates are NOT invented —
 *   the TV Time export does not include per-episode watch dates.
 * - import_files records every parsed TV Time HTML import with counts and
 *   a JSON summary snapshot.
 * - app_settings is a simple key/value store.
 */
export const SCHEMA_VERSION = 3;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS media_items (
  id               TEXT    PRIMARY KEY,
  media_type       TEXT    NOT NULL CHECK (media_type IN ('show', 'movie')),
  tvdb_id          INTEGER NOT NULL,
  imdb_id          TEXT,
  tvtime_uuid      TEXT,
  title            TEXT    NOT NULL,
  year             INTEGER,
  status           TEXT,
  overview         TEXT,
  poster_url       TEXT,
  is_favorite      INTEGER NOT NULL DEFAULT 0,
  is_watched       INTEGER NOT NULL DEFAULT 0,
  watched_count    INTEGER,
  total_count      INTEGER,
  progress_percent REAL,
  watched_at       TEXT,
  rewatch_count    INTEGER NOT NULL DEFAULT 0,
  on_watchlist     INTEGER NOT NULL DEFAULT 1,
  raw_json         TEXT,
  added_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tvdb_id, media_type)
);

CREATE TABLE IF NOT EXISTS episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id   TEXT    NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
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
  media_item_id TEXT    NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  episode_id    INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  action        TEXT    NOT NULL DEFAULT 'watched'
                CHECK (action IN ('watched', 'unwatched')),
  watched_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  source        TEXT    NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual', 'imported_watched')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name    TEXT    NOT NULL,
  file_uri     TEXT,
  file_size    INTEGER,
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'parsed', 'failed')),
  shows_count  INTEGER,
  movies_count INTEGER,
  raw_summary  TEXT,
  error        TEXT,
  imported_at  TEXT    NOT NULL DEFAULT (datetime('now'))
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

  if (currentVersion < 2) {
    // v1 (Phase 1) never held imported data — only placeholder UI ran against
    // it — so upgrading recreates the tables with the import-ready columns.
    await db.execAsync(`
      DROP TABLE IF EXISTS watch_events;
      DROP TABLE IF EXISTS episodes;
      DROP TABLE IF EXISTS media_items;
      DROP TABLE IF EXISTS import_files;
    `);
    await db.execAsync(SCHEMA_SQL);
  } else if (currentVersion < 3) {
    // v2 → v3: watch_events gains the action column. Existing rows are all
    // imported movie watches, so the 'watched' default is correct for them.
    await db.execAsync(
      "ALTER TABLE watch_events ADD COLUMN action TEXT NOT NULL DEFAULT 'watched' CHECK (action IN ('watched', 'unwatched'))",
    );
  }
  // Future migrations: if (currentVersion < 4) { ... }

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

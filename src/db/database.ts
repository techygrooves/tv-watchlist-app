import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export const DATABASE_NAME = 'tv-watchlist.db';

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

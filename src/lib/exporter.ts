import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getAppStats, getEpisodeStats, type AppStats } from './queries';
import type { MediaItem } from '@/src/types';

/**
 * CSV / TXT export helpers. Everything is generated locally from SQLite —
 * no network. Files are written with expo-file-system and handed to the
 * system share sheet via expo-sharing on native; on web they download
 * directly (expo-sharing is unavailable there).
 */

/** RFC 4180-style escaping: quote fields containing commas, quotes, or newlines. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\r\n') + '\r\n';
}

const MEDIA_CSV_HEADERS = [
  'id',
  'media_type',
  'tvdb_id',
  'imdb_id',
  'tvtime_uuid',
  'title',
  'year',
  'status',
  'is_favorite',
  'is_watched',
  'watched_count',
  'total_count',
  'progress_percent',
  'watched_at',
  'rewatch_count',
  'created_at',
  'updated_at',
];

export async function buildMediaItemsCsv(db: SQLiteDatabase): Promise<string> {
  const items = await db.getAllAsync<MediaItem>(
    'SELECT * FROM media_items ORDER BY media_type, title COLLATE NOCASE',
  );
  return toCsv(
    MEDIA_CSV_HEADERS,
    items.map((m) => [
      m.id,
      m.media_type,
      m.tvdb_id,
      m.imdb_id,
      m.tvtime_uuid,
      m.title,
      m.year,
      m.status,
      m.is_favorite,
      m.is_watched,
      m.watched_count,
      m.total_count,
      m.progress_percent,
      m.watched_at,
      m.rewatch_count,
      m.added_at,
      m.updated_at,
    ]),
  );
}

const EPISODE_CSV_HEADERS = [
  'id',
  'show_tvdb_id',
  'season_number',
  'episode_number',
  'title',
  'air_date',
  'is_special',
  'is_watched',
  'watched_at',
];

interface EpisodeCsvRow {
  id: number;
  show_tvdb_id: number;
  season_number: number;
  episode_number: number;
  title: string | null;
  air_date: string | null;
  is_special: number;
  is_watched: number;
  watched_at: string | null;
}

/** Episode rows, or null when no episodes exist. */
export async function buildEpisodesCsv(db: SQLiteDatabase): Promise<string | null> {
  const rows = await db.getAllAsync<EpisodeCsvRow>(
    `SELECT
       e.id,
       m.tvdb_id AS show_tvdb_id,
       e.season_number,
       e.episode_number,
       e.title,
       e.air_date,
       e.is_special,
       e.is_watched,
       e.watched_at
     FROM episodes e
     JOIN media_items m ON m.id = e.media_item_id
     ORDER BY m.tvdb_id, e.season_number, e.episode_number`,
  );
  if (rows.length === 0) return null;
  return toCsv(
    EPISODE_CSV_HEADERS,
    rows.map((e) => [
      e.id,
      e.show_tvdb_id,
      e.season_number,
      e.episode_number,
      e.title,
      e.air_date,
      e.is_special,
      e.is_watched,
      e.watched_at,
    ]),
  );
}

export async function buildTxtSummary(db: SQLiteDatabase): Promise<string> {
  const stats = await getAppStats(db);
  const episodeStats = await getEpisodeStats(db);
  const recent = await db.getAllAsync<{ title: string; year: number | null; watched_at: string }>(
    `SELECT title, year, watched_at FROM media_items
     WHERE media_type = 'movie' AND is_watched = 1 AND watched_at IS NOT NULL
     ORDER BY watched_at DESC LIMIT 10`,
  );

  const lines = [
    'TV Watchlist — Summary',
    `Export date: ${new Date().toISOString()}`,
    '',
    `Total shows: ${stats.totalShows}`,
    `Total movies: ${stats.totalMovies}`,
    `Watched movies: ${stats.watchedMovies}`,
    `Unwatched movies: ${stats.unwatchedMovies}`,
    `Favorite shows: ${stats.favoriteShows}`,
    `Favorite movies: ${stats.favoriteMovies}`,
    `Completed shows: ${stats.completedShows}`,
    `In-progress shows: ${stats.inProgressShows}`,
    `Not started shows: ${stats.notStartedShows}`,
    '',
    `Episode rows tracked: ${episodeStats.episodeRows}`,
    `Watched episodes (tracked): ${episodeStats.watchedEpisodes}`,
    `Unwatched episodes (tracked): ${episodeStats.unwatchedEpisodes}`,
  ];
  if (recent.length > 0) {
    lines.push('', 'Recently watched movies:');
    for (const m of recent) {
      const when = m.watched_at.slice(0, 10);
      lines.push(`  - ${m.title}${m.year ? ` (${m.year})` : ''} — ${when}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function exportFilename(kind: 'export' | 'export-episodes' | 'summary', ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `tv-watchlist-${kind}-${date}.${ext}`;
}

/**
 * Delivers a generated file to the user: system share sheet on Android/iOS,
 * direct download on web.
 */
export async function deliverFile(
  filename: string,
  content: string,
  mimeType: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
}

export type { AppStats };

import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from './db';

/**
 * TVDB v4 API service (official API, no scraping).
 *
 * The API key comes exclusively from EXPO_PUBLIC_TVDB_API_KEY in .env —
 * never hardcoded. Login exchanges the key for a bearer token that TVDB
 * keeps valid for ~1 month; the token and its expiry are persisted in
 * app_settings so the app doesn't re-login on every launch. Authenticated
 * requests retry once with a fresh login on 401.
 */

const BASE_URL = 'https://api4.thetvdb.com/v4';
const TOKEN_KEY = 'tvdb_token';
const TOKEN_EXPIRY_KEY = 'tvdb_token_expiry';
// TVDB tokens last ~1 month; refresh after 25 days to stay clear of expiry.
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;

export type TvdbErrorKind =
  | 'missing_key'
  | 'invalid_key'
  | 'network'
  | 'not_found'
  | 'api';

export class TvdbError extends Error {
  kind: TvdbErrorKind;
  constructor(kind: TvdbErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export function getTvdbApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_TVDB_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new TvdbError(
      'network',
      `Could not reach TVDB (${err instanceof Error ? err.message : 'network error'}). Check your connection and try again.`,
    );
  }
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body; leave null and let status handling speak.
  }
  return { status: response.status, body };
}

/** Logs in with the API key and persists the token. */
export async function tvdbLogin(db: SQLiteDatabase): Promise<string> {
  const apiKey = getTvdbApiKey();
  if (!apiKey) {
    throw new TvdbError(
      'missing_key',
      'No TVDB API key found. Add EXPO_PUBLIC_TVDB_API_KEY to your .env file and restart the dev server.',
    );
  }
  const { status, body } = await fetchJson(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: apiKey }),
  });
  if (status === 401 || status === 403) {
    throw new TvdbError('invalid_key', 'TVDB rejected the API key. Check EXPO_PUBLIC_TVDB_API_KEY in your .env file.');
  }
  const token = body?.data?.token;
  if (status !== 200 || typeof token !== 'string') {
    throw new TvdbError('api', `TVDB login failed (HTTP ${status}).`);
  }
  await setSetting(db, TOKEN_KEY, token);
  await setSetting(db, TOKEN_EXPIRY_KEY, String(Date.now() + TOKEN_TTL_MS));
  return token;
}

async function getToken(db: SQLiteDatabase): Promise<string> {
  const [token, expiry] = await Promise.all([
    getSetting(db, TOKEN_KEY),
    getSetting(db, TOKEN_EXPIRY_KEY),
  ]);
  if (token && expiry && Date.now() < Number(expiry)) return token;
  return tvdbLogin(db);
}

/** GET an authenticated TVDB endpoint; retries once with a fresh login on 401. */
export async function tvdbGet(db: SQLiteDatabase, path: string): Promise<any> {
  let token = await getToken(db);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { status, body } = await fetchJson(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (status === 200) return body?.data ?? null;
    if (status === 401 && attempt === 0) {
      token = await tvdbLogin(db); // expired token — re-login once
      continue;
    }
    if (status === 404) throw new TvdbError('not_found', `TVDB has no record for ${path}.`);
    throw new TvdbError('api', `TVDB request failed (HTTP ${status}) for ${path}.`);
  }
  throw new TvdbError('api', `TVDB request failed for ${path}.`);
}

/** TVDB image paths can be relative; normalize to a full URL. */
export function tvdbImageUrl(image: unknown): string | null {
  if (typeof image !== 'string' || image.length === 0) return null;
  if (image.startsWith('http://') || image.startsWith('https://')) return image;
  return `https://artworks.thetvdb.com${image.startsWith('/') ? '' : '/'}${image}`;
}

function englishOverview(translations: any): string | null {
  const list = translations?.overviewTranslations;
  if (!Array.isArray(list)) return null;
  const eng = list.find((t: any) => t?.language === 'eng' && typeof t.overview === 'string');
  if (eng) return eng.overview;
  const any = list.find((t: any) => typeof t?.overview === 'string');
  return any ? any.overview : null;
}

export interface TvdbSeriesInfo {
  name: string | null;
  posterUrl: string | null;
  overview: string | null;
  year: number | null;
  status: string | null;
}

export async function fetchSeries(db: SQLiteDatabase, tvdbId: number): Promise<TvdbSeriesInfo> {
  const data = await tvdbGet(db, `/series/${tvdbId}/extended?meta=translations&short=true`);
  return {
    name: typeof data?.name === 'string' ? data.name : null,
    posterUrl: tvdbImageUrl(data?.image),
    overview: englishOverview(data?.translations) ?? (typeof data?.overview === 'string' ? data.overview : null),
    year: data?.year ? Number(data.year) || null : null,
    status: typeof data?.status?.name === 'string' ? data.status.name : null,
  };
}

export interface TvdbEpisode {
  tvdbEpisodeId: number | null;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  airDate: string | null;
  overview: string | null;
  runtimeMinutes: number | null;
}

/** Full episode list for a series (default season order), following pagination. */
export async function fetchSeriesEpisodes(
  db: SQLiteDatabase,
  tvdbId: number,
): Promise<TvdbEpisode[]> {
  const episodes: TvdbEpisode[] = [];
  for (let page = 0; page < 40; page++) {
    let data: any;
    try {
      data = await tvdbGet(db, `/series/${tvdbId}/episodes/default?page=${page}`);
    } catch (err) {
      // Some TVDB deployments 404 past the last page instead of returning
      // an empty list — treat that as end-of-catalog, not an error.
      if (err instanceof TvdbError && err.kind === 'not_found' && page > 0) break;
      throw err;
    }
    const batch = Array.isArray(data?.episodes) ? data.episodes : [];
    for (const ep of batch) {
      if (typeof ep?.seasonNumber !== 'number' || typeof ep?.number !== 'number') continue;
      episodes.push({
        tvdbEpisodeId: typeof ep.id === 'number' ? ep.id : null,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.number,
        title: typeof ep.name === 'string' && ep.name.length > 0 ? ep.name : null,
        airDate: typeof ep.aired === 'string' && ep.aired.length > 0 ? ep.aired : null,
        overview: typeof ep.overview === 'string' && ep.overview.length > 0 ? ep.overview : null,
        runtimeMinutes: typeof ep.runtime === 'number' ? ep.runtime : null,
      });
    }
    if (batch.length === 0) break;
  }
  return episodes;
}

export interface TvdbSearchResult {
  tvdbId: number;
  mediaType: 'show' | 'movie';
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  raw: unknown;
}

/** Searches TVDB for series and movies (min 2 characters). */
export async function searchTvdb(
  db: SQLiteDatabase,
  query: string,
  limit = 20,
): Promise<TvdbSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const data = await tvdbGet(db, `/search?query=${encodeURIComponent(q)}&limit=${limit}`);
  if (!Array.isArray(data)) return [];
  const results: TvdbSearchResult[] = [];
  for (const r of data) {
    const type = r?.type === 'series' ? 'show' : r?.type === 'movie' ? 'movie' : null;
    const tvdbId = Number(r?.tvdb_id);
    const title = typeof r?.name === 'string' ? r.name : null;
    if (!type || !Number.isInteger(tvdbId) || tvdbId <= 0 || !title) continue;
    results.push({
      tvdbId,
      mediaType: type,
      title,
      year: r?.year ? Number(r.year) || null : null,
      posterUrl: tvdbImageUrl(r?.image_url ?? r?.thumbnail),
      overview: typeof r?.overview === 'string' && r.overview.length > 0 ? r.overview : null,
      raw: r,
    });
  }
  return results;
}

export interface TvdbMovieInfo {
  name: string | null;
  posterUrl: string | null;
  overview: string | null;
  year: number | null;
  status: string | null;
}

export async function fetchMovie(db: SQLiteDatabase, tvdbId: number): Promise<TvdbMovieInfo> {
  const data = await tvdbGet(db, `/movies/${tvdbId}/extended?meta=translations&short=true`);
  return {
    name: typeof data?.name === 'string' ? data.name : null,
    posterUrl: tvdbImageUrl(data?.image),
    overview: englishOverview(data?.translations) ?? (typeof data?.overview === 'string' ? data.overview : null),
    year: data?.year ? Number(data.year) || null : null,
    status: typeof data?.status?.name === 'string' ? data.status.name : null,
  };
}

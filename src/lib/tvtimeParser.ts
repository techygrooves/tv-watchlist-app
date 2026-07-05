/**
 * Parser for "TV Time Out" HTML exports.
 *
 * The export embeds two JavaScript arrays:
 *   var SHOWS  = [ ... ];
 *   var MOVIES = [ ... ];
 * Both are JSON-serialized, so after locating each array with a
 * string-aware bracket matcher (titles may contain "[" or "]"), the slice
 * parses with JSON.parse. The visual HTML table is never scraped.
 *
 * Shows and movies have different fields — do not share a type between them.
 */

export interface TvTimeShow {
  title: string;
  tvdbId: number;
  imdbId: string | null;
  /** 'continuing' | 'up_to_date' | 'stopped' | 'not_started_yet' */
  status: string;
  isFavorite: boolean;
  watched: number;
  total: number;
  pct: number;
  unwatchedRegularEps: { season: number; episode: number }[];
  // Extra export fields (totalSpecials, ghostEntry, …) ride along untyped
  // and are preserved verbatim in raw_json.
  [key: string]: unknown;
}

export interface TvTimeMovie {
  title: string;
  tvdbId: number;
  imdbId: string | null;
  uuid: string | null;
  year: number | null;
  isWatched: boolean;
  isFavorite: boolean;
  watchedAt: string | null;
  rewatchCount: number;
  [key: string]: unknown;
}

export interface ImportSummary {
  totalShows: number;
  totalMovies: number;
  watchedMovies: number;
  favoriteShows: number;
  favoriteMovies: number;
  continuingShows: number;
  upToDateShows: number;
  stoppedShows: number;
  notStartedShows: number;
  skippedEntries: number;
}

export interface ParsedTvTimeExport {
  shows: TvTimeShow[];
  movies: TvTimeMovie[];
  summary: ImportSummary;
}

export class TvTimeParseError extends Error {}

/**
 * Returns the JSON text of `var <name> = [ ... ]` from the HTML, or null if
 * the declaration is missing. Scans character-by-character so it stays
 * correct for large arrays and for strings containing brackets/escapes.
 */
function extractArraySource(html: string, name: string): string | null {
  const decl = new RegExp(`var\\s+${name}\\s*=\\s*`).exec(html);
  if (!decl) return null;

  const start = decl.index + decl[0].length;
  if (html[start] !== '[') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null; // truncated file — closing bracket never found
}

function isValidShow(entry: unknown): entry is TvTimeShow {
  const s = entry as Record<string, unknown>;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.tvdbId === 'number' &&
    typeof s.title === 'string'
  );
}

function isValidMovie(entry: unknown): entry is TvTimeMovie {
  const m = entry as Record<string, unknown>;
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.tvdbId === 'number' &&
    typeof m.title === 'string'
  );
}

/** Parses a TV Time export HTML string. Throws TvTimeParseError with a clear message. */
export function parseTvTimeExport(html: string): ParsedTvTimeExport {
  if (!html || html.length === 0) {
    throw new TvTimeParseError('The selected file is empty.');
  }

  const showsSource = extractArraySource(html, 'SHOWS');
  const moviesSource = extractArraySource(html, 'MOVIES');
  if (!showsSource && !moviesSource) {
    throw new TvTimeParseError(
      'No SHOWS or MOVIES data found. Make sure this is a TV Time Out HTML export — the file must contain the embedded SHOWS and MOVIES arrays.',
    );
  }
  if (!showsSource) {
    throw new TvTimeParseError(
      'The SHOWS array is missing or incomplete in this file. Re-export from TV Time Out and try again.',
    );
  }
  if (!moviesSource) {
    throw new TvTimeParseError(
      'The MOVIES array is missing or incomplete in this file. Re-export from TV Time Out and try again.',
    );
  }

  let rawShows: unknown;
  let rawMovies: unknown;
  try {
    rawShows = JSON.parse(showsSource);
  } catch {
    throw new TvTimeParseError('The SHOWS data is present but could not be parsed (corrupt JSON).');
  }
  try {
    rawMovies = JSON.parse(moviesSource);
  } catch {
    throw new TvTimeParseError('The MOVIES data is present but could not be parsed (corrupt JSON).');
  }
  if (!Array.isArray(rawShows) || !Array.isArray(rawMovies)) {
    throw new TvTimeParseError('SHOWS/MOVIES data has an unexpected format (not arrays).');
  }

  let skippedEntries = 0;
  const shows: TvTimeShow[] = [];
  for (const entry of rawShows) {
    if (isValidShow(entry)) shows.push(entry);
    else skippedEntries++;
  }
  const movies: TvTimeMovie[] = [];
  for (const entry of rawMovies) {
    if (isValidMovie(entry)) movies.push(entry);
    else skippedEntries++;
  }

  return { shows, movies, summary: summarize(shows, movies, skippedEntries) };
}

function summarize(
  shows: TvTimeShow[],
  movies: TvTimeMovie[],
  skippedEntries: number,
): ImportSummary {
  const byStatus = (status: string) => shows.filter((s) => s.status === status).length;
  return {
    totalShows: shows.length,
    totalMovies: movies.length,
    watchedMovies: movies.filter((m) => m.isWatched === true).length,
    favoriteShows: shows.filter((s) => s.isFavorite === true).length,
    favoriteMovies: movies.filter((m) => m.isFavorite === true).length,
    continuingShows: byStatus('continuing'),
    upToDateShows: byStatus('up_to_date'),
    stoppedShows: byStatus('stopped'),
    notStartedShows: byStatus('not_started_yet'),
    skippedEntries,
  };
}

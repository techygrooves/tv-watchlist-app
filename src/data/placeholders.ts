import type { PosterCardItem } from '@/src/components/PosterCard';

/**
 * Static placeholder data so the Phase 1 UI has something to render.
 * Replaced by real SQLite queries once the TV Time import lands.
 * TVDB IDs are real so the placeholder posters look plausible.
 */

export const PLACEHOLDER_SHOWS: PosterCardItem[] = [
  { tvdbId: 121361, title: 'Game of Thrones', year: 2011, detail: 'S08E06 · Finished', progress: 1, isFavorite: true, isWatched: true },
  { tvdbId: 81189, title: 'Breaking Bad', year: 2008, detail: 'S04E07 · 19 left', progress: 0.68, isFavorite: true },
  { tvdbId: 371572, title: 'Severance', year: 2022, detail: 'S02E03 · 7 left', progress: 0.63 },
  { tvdbId: 361753, title: 'The Bear', year: 2022, detail: 'S01E01 · 27 left', progress: 0.04 },
  { tvdbId: 305288, title: 'Stranger Things', year: 2016, detail: 'Up next: S05E01', progress: 0.82 },
];

export const PLACEHOLDER_MOVIES: PosterCardItem[] = [
  { tvdbId: 998, title: 'Armageddon', year: 1998, detail: 'Watched May 2025', isWatched: true },
  { tvdbId: 362928, title: 'Exterritorial', year: 2025, detail: 'Watched Dec 2025', isWatched: true },
  { tvdbId: 99236, title: 'The Deep House', year: 2021, detail: 'On watchlist' },
  { tvdbId: 9846, title: 'Ambulance', year: 2022, detail: 'Watched Apr 2022', isWatched: true, isFavorite: true },
];

export const PLACEHOLDER_UPCOMING: PosterCardItem[] = [
  { tvdbId: 371572, title: 'Severance', year: 2022, detail: 'S02E08 · airs Fri' },
  { tvdbId: 305288, title: 'Stranger Things', year: 2016, detail: 'S05E02 · airs in 3 days' },
  { tvdbId: 361753, title: 'The Bear', year: 2022, detail: 'S04 · date TBA' },
];

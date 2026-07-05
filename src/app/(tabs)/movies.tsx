import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { FlatList } from 'react-native';

import { EmptyState } from '@/src/components/EmptyState';
import { FilterChips } from '@/src/components/FilterChips';
import { PosterCard } from '@/src/components/PosterCard';
import { Screen } from '@/src/components/Screen';
import { SearchBar } from '@/src/components/SearchBar';
import { SectionHeader } from '@/src/components/SectionHeader';
import { Snackbar } from '@/src/components/Snackbar';
import { listMovies, type MovieFilter } from '@/src/lib/queries';
import {
  markMovieUnwatched,
  markMovieWatched,
  restoreSnapshot,
  type MediaSnapshot,
} from '@/src/lib/watchActions';
import type { MediaItem } from '@/src/types';

const FILTERS: { key: MovieFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'watched', label: 'Watched' },
  { key: 'unwatched', label: 'Unwatched' },
  { key: 'favorites', label: 'Favorites' },
];

function formatWatchedDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function movieDetail(item: MediaItem): string {
  const parts: string[] = [];
  if (item.year) parts.push(String(item.year));
  if (item.is_watched === 1) {
    const when = formatWatchedDate(item.watched_at);
    parts.push(when ? `Watched ${when}` : 'Watched');
  } else {
    parts.push('Not watched');
  }
  if (item.rewatch_count > 0) parts.push(`${item.rewatch_count}× rewatched`);
  return parts.join(' · ');
}

export default function MoviesScreen() {
  const db = useSQLiteContext();
  const [filter, setFilter] = useState<MovieFilter>('all');
  const [search, setSearch] = useState('');
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [undo, setUndo] = useState<{ message: string; snapshot: MediaSnapshot } | null>(null);

  const refresh = useCallback(async () => {
    setMovies(await listMovies(db, filter, search));
    setLoaded(true);
  }, [db, filter, search]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  const onToggle = useCallback(
    async (item: MediaItem) => {
      const snapshot =
        item.is_watched === 1
          ? await markMovieUnwatched(db, item)
          : await markMovieWatched(db, item);
      setUndo({
        message:
          item.is_watched === 1
            ? `"${item.title}" marked unwatched`
            : `"${item.title}" marked watched`,
        snapshot,
      });
      await refresh();
    },
    [db, refresh],
  );

  const onUndo = useCallback(async () => {
    if (!undo) return;
    await restoreSnapshot(db, undo.snapshot);
    setUndo(null);
    await refresh();
  }, [db, undo, refresh]);

  return (
    <Screen
      title="Movies"
      subtitle={loaded && movies.length > 0 ? `${movies.length} movies` : undefined}
    >
      <SearchBar value={search} onChange={setSearch} />
      <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />

      {loaded && movies.length === 0 ? (
        <EmptyState
          icon="film"
          title={filter === 'all' && search === '' ? 'No movies yet' : 'No matches'}
          message={
            filter === 'all' && search === ''
              ? 'Import your TV Time HTML export from the Profile tab and your movies will appear here.'
              : 'No movies match the current search and filter.'
          }
        />
      ) : (
        <FlatList
          data={movies}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <SectionHeader
              label={FILTERS.find((f) => f.key === filter)?.label ?? 'All'}
              count={movies.length}
            />
          }
          renderItem={({ item }) => (
            <PosterCard
              item={{
                tvdbId: item.tvdb_id,
                title: item.title,
                detail: movieDetail(item),
                isFavorite: item.is_favorite === 1,
                isWatched: item.is_watched === 1,
              }}
              onToggleWatched={() => onToggle(item)}
            />
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}

      {undo ? (
        <Snackbar
          message={undo.message}
          actionLabel="Undo"
          onAction={onUndo}
          onDismiss={() => setUndo(null)}
        />
      ) : null}
    </Screen>
  );
}

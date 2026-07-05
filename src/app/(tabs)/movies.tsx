import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/src/components/EmptyState';
import { PosterCard } from '@/src/components/PosterCard';
import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import { listMovies, type MovieFilter } from '@/src/lib/queries';
import { colors, radius, spacing, typography } from '@/src/theme';
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
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listMovies(db, filter).then((rows) => {
        if (active) {
          setMovies(rows);
          setLoaded(true);
        }
      });
      return () => {
        active = false;
      };
    }, [db, filter]),
  );

  const emptyBecauseNoData = loaded && movies.length === 0 && filter === 'all';

  return (
    <Screen title="Movies" subtitle={movies.length > 0 ? `${movies.length} movies` : undefined}>
      <View style={styles.filterRow}>
        {FILTERS.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={[styles.chip, filter === key && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === key && styles.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {emptyBecauseNoData ? (
        <EmptyState
          icon="film"
          title="No movies yet"
          message="Import your TV Time HTML export from the Profile tab and your movies will appear here."
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
            />
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    ...typography.caption,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.onAccent,
  },
});

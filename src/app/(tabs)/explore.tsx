import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState } from '@/src/components/EmptyState';
import { Screen } from '@/src/components/Screen';
import { SearchBar } from '@/src/components/SearchBar';
import { searchTvdb, TvdbError, type TvdbSearchResult } from '@/src/lib/tvdb';
import { addMediaItemFromTvdb, mediaItemIdFor } from '@/src/lib/watchlist';
import { colors, radius, spacing, typography } from '@/src/theme';

const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

export default function ExploreScreen() {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TvdbSearchResult[]>([]);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Debounced TVDB search: waits for a typing pause and drops stale
  // responses so fast typing can't interleave results.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    setSearching(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const found = await searchTvdb(db, q);
        if (seq !== requestSeq.current) return;
        const ids = new Set<string>();
        for (const r of found) {
          const id = mediaItemIdFor(r);
          const row = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM media_items WHERE id = ?',
            id,
          );
          if (row) ids.add(id);
        }
        if (seq !== requestSeq.current) return;
        setResults(found);
        setExistingIds(ids);
        setSearched(true);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setResults([]);
        setSearched(true);
        setError(
          err instanceof TvdbError
            ? err.message
            : `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [db, query]);

  const onAdd = useCallback(
    async (result: TvdbSearchResult) => {
      const id = mediaItemIdFor(result);
      setAddingId(id);
      setError(null);
      try {
        await addMediaItemFromTvdb(db, result);
        setExistingIds((prev) => new Set(prev).add(id));
      } catch (err) {
        setError(
          `Could not add "${result.title}": ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setAddingId(null);
      }
    },
    [db],
  );

  return (
    <Screen title="Explore" subtitle="Search TVDB and add to your watchlist">
      <SearchBar value={query} onChange={setQuery} placeholder="Search shows & movies…" />

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {searching ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>Searching TVDB…</Text>
        </View>
      ) : null}

      {query.trim().length < MIN_QUERY_LENGTH ? (
        <EmptyState
          icon="compass"
          title="Find something to watch"
          message="Type at least two characters to search TVDB for shows and movies, then add them to your watchlist."
        />
      ) : searched && results.length === 0 && !searching && !error ? (
        <EmptyState
          icon="search"
          title="No results"
          message={`TVDB has no shows or movies matching “${query.trim()}”.`}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => mediaItemIdFor(r)}
          renderItem={({ item }) => (
            <SearchResultCard
              result={item}
              added={existingIds.has(mediaItemIdFor(item))}
              adding={addingId === mediaItemIdFor(item)}
              onAdd={() => onAdd(item)}
            />
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </Screen>
  );
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function SearchResultCard({
  result,
  added,
  adding,
  onAdd,
}: {
  result: TvdbSearchResult;
  added: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  return (
    <View style={styles.card}>
      {result.posterUrl ? (
        <Image source={{ uri: result.posterUrl }} style={styles.poster} />
      ) : (
        <View style={[styles.poster, styles.posterFallback]}>
          <Text style={styles.posterInitials}>{initials(result.title)}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {result.title}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, result.mediaType === 'movie' && styles.badgeMovie]}>
            <Text
              style={[styles.badgeText, result.mediaType === 'movie' && styles.badgeTextMovie]}
            >
              {result.mediaType === 'show' ? 'Show' : 'Movie'}
            </Text>
          </View>
          {result.year ? <Text style={styles.year}>{result.year}</Text> : null}
        </View>
        {result.overview ? (
          <Text style={styles.overview} numberOfLines={2}>
            {result.overview}
          </Text>
        ) : null}
        <Pressable
          onPress={onAdd}
          disabled={added || adding}
          style={({ pressed }) => [
            styles.addButton,
            added && styles.addButtonAdded,
            pressed && !added && { backgroundColor: colors.accentDim },
          ]}
          accessibilityLabel={
            added ? `${result.title} already added` : `Add ${result.title} to watchlist`
          }
        >
          {adding ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : added ? (
            <>
              <Ionicons name="checkmark" size={14} color={colors.watched} />
              <Text style={[styles.addButtonText, styles.addButtonTextAdded]}>Already Added</Text>
            </>
          ) : (
            <>
              <Ionicons name="add" size={14} color={colors.onAccent} />
              <Text style={styles.addButtonText}>Add to Watchlist</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(229,72,77,0.12)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
    lineHeight: 17,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    ...typography.caption,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  poster: {
    width: 64,
    height: 96,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterInitials: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  info: {
    flex: 1,
  },
  title: {
    ...typography.heading,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeMovie: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onAccent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
  badgeTextMovie: {
    color: colors.accent,
  },
  year: {
    ...typography.caption,
  },
  overview: {
    ...typography.caption,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    minHeight: 32,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  addButtonAdded: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onAccent,
    includeFontPadding: false,
  },
  addButtonTextAdded: {
    color: colors.textSecondary,
  },
});

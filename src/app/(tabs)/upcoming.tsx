import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/src/components/EmptyState';
import { FilterChips } from '@/src/components/FilterChips';
import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import {
  listEpisodeFeed,
  type EpisodeFeedFilter,
  type UpcomingEpisode,
} from '@/src/lib/queries';
import { colors, radius, spacing, typography } from '@/src/theme';

const FILTERS: { key: EpisodeFeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'aired_unwatched', label: 'Aired but unwatched' },
  { key: 'recently_added', label: 'Recently added' },
];

const EMPTY_MESSAGES: Record<EpisodeFeedFilter, string> = {
  all: 'No unwatched episodes. Import your TV Time data, then use Fetch Missing Metadata in Profile to load episode catalogs.',
  upcoming:
    'No unwatched episodes with future air dates. Air dates arrive with TVDB metadata — try Fetch Missing Metadata or Check for Updates Now in Profile.',
  aired_unwatched: 'Nothing aired and unwatched — you are caught up.',
  recently_added: 'No newly discovered episodes yet. New episodes found by update checks appear here.',
};

function formatAirDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UpcomingScreen() {
  const db = useSQLiteContext();
  const [filter, setFilter] = useState<EpisodeFeedFilter>('upcoming');
  const [episodes, setEpisodes] = useState<UpcomingEpisode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [autoPicked, setAutoPicked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        let rows = await listEpisodeFeed(db, filter);
        // First visit convenience: if Upcoming is empty (no air dates yet),
        // fall back to All so the tab isn't blank.
        if (!autoPicked && filter === 'upcoming' && rows.length === 0) {
          const all = await listEpisodeFeed(db, 'all');
          if (all.length > 0) {
            if (!active) return;
            setFilter('all');
            setAutoPicked(true);
            return; // effect re-runs with the new filter
          }
        }
        if (!active) return;
        setEpisodes(rows);
        setLoaded(true);
      })();
      return () => {
        active = false;
      };
    }, [db, filter, autoPicked]),
  );

  return (
    <Screen
      title="Upcoming"
      subtitle={loaded && episodes.length > 0 ? `${episodes.length} episodes` : undefined}
    >
      <FilterChips
        options={FILTERS}
        selected={filter}
        onSelect={(key) => {
          setAutoPicked(true);
          setFilter(key);
        }}
      />

      {loaded && episodes.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing here" message={EMPTY_MESSAGES[filter]} />
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(ep) => String(ep.id)}
          ListHeaderComponent={
            <SectionHeader
              label={FILTERS.find((f) => f.key === filter)?.label ?? 'All'}
              count={episodes.length}
            />
          }
          renderItem={({ item: ep }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/show/[id]', params: { id: ep.show_id } })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              android_ripple={{ color: colors.border }}
            >
              {ep.show_poster ? (
                <Image source={{ uri: ep.show_poster }} style={styles.poster} />
              ) : (
                <View style={[styles.poster, styles.posterFallback]}>
                  <Ionicons name="tv" size={16} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.info}>
                <Text style={styles.showTitle} numberOfLines={1}>
                  {ep.show_title}
                </Text>
                <Text style={styles.episodeLine} numberOfLines={1}>
                  S{String(ep.season_number).padStart(2, '0')}E
                  {String(ep.episode_number).padStart(2, '0')}
                  {ep.title ? ` · ${ep.title}` : ''}
                </Text>
                <Text style={styles.airDate}>
                  {ep.air_date ? formatAirDate(ep.air_date) : 'Air date TBA'}
                </Text>
              </View>
              {ep.is_watched === 1 ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.watched} />
              ) : (
                <Ionicons name="ellipse-outline" size={20} color={colors.textMuted} />
              )}
            </Pressable>
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.cardPressed,
  },
  poster: {
    width: 36,
    height: 54,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  showTitle: {
    ...typography.body,
    fontWeight: '600',
  },
  episodeLine: {
    ...typography.caption,
    marginTop: 1,
  },
  airDate: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
    marginTop: 1,
  },
});

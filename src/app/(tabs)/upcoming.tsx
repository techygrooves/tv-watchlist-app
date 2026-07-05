import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/src/components/EmptyState';
import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import {
  listNextUnwatchedEpisodes,
  listUpcomingEpisodes,
  type UpcomingEpisode,
} from '@/src/lib/queries';
import { colors, radius, spacing, typography } from '@/src/theme';

function formatAirDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function UpcomingScreen() {
  const db = useSQLiteContext();
  const [episodes, setEpisodes] = useState<UpcomingEpisode[]>([]);
  const [mode, setMode] = useState<'upcoming' | 'next_up'>('upcoming');
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        // Prefer real future air dates (available once TVDB metadata is
        // fetched); otherwise fall back to each show's next unwatched episode.
        const upcoming = await listUpcomingEpisodes(db);
        const rows = upcoming.length > 0 ? upcoming : await listNextUnwatchedEpisodes(db);
        if (!active) return;
        setEpisodes(rows);
        setMode(upcoming.length > 0 ? 'upcoming' : 'next_up');
        setLoaded(true);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  return (
    <Screen
      title="Upcoming"
      subtitle={
        loaded && episodes.length > 0
          ? mode === 'upcoming'
            ? 'Unwatched episodes with future air dates'
            : 'No future air dates yet — showing each show’s next unwatched episode'
          : undefined
      }
    >
      {loaded && episodes.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing upcoming"
          message="Import your TV Time data, then use Fetch Missing Metadata in Profile to load air dates from TVDB."
        />
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(ep) => String(ep.id)}
          ListHeaderComponent={
            <SectionHeader
              label={mode === 'upcoming' ? 'Airing soon' : 'Next up'}
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
              </View>
              <Text style={styles.airDate}>
                {ep.air_date ? formatAirDate(ep.air_date) : 'TBA'}
              </Text>
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
  },
});

import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgressBar } from '@/src/components/ProgressBar';
import { Snackbar } from '@/src/components/Snackbar';
import { getMediaItem, listEpisodes } from '@/src/lib/queries';
import {
  markEpisodeUnwatched,
  markEpisodeWatched,
  restoreEpisodeSnapshot,
  type EpisodeSnapshot,
} from '@/src/lib/watchActions';
import { colors, radius, spacing, typography } from '@/src/theme';
import type { Episode, MediaItem } from '@/src/types';

const STATUS_LABELS: Record<string, string> = {
  continuing: 'Continuing',
  up_to_date: 'Up to date',
  stopped: 'Stopped',
  not_started_yet: 'Not started',
};

interface SeasonSection {
  title: string;
  data: Episode[];
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [show, setShow] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [undo, setUndo] = useState<{ message: string; snapshot: EpisodeSnapshot } | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [item, eps] = await Promise.all([getMediaItem(db, id), listEpisodes(db, id)]);
    setShow(item);
    setEpisodes(eps);
    setLoaded(true);
  }, [db, id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sections = useMemo<SeasonSection[]>(() => {
    const bySeason = new Map<number, Episode[]>();
    for (const ep of episodes) {
      const list = bySeason.get(ep.season_number) ?? [];
      list.push(ep);
      bySeason.set(ep.season_number, list);
    }
    return [...bySeason.entries()]
      .sort(([a], [b]) => a - b)
      .map(([season, data]) => ({
        title: season === 0 ? 'Specials' : `Season ${season}`,
        data,
      }));
  }, [episodes]);

  const onToggle = useCallback(
    async (episode: Episode) => {
      if (!show) return;
      const label = `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}`;
      const snapshot =
        episode.is_watched === 1
          ? await markEpisodeUnwatched(db, show, episode)
          : await markEpisodeWatched(db, show, episode);
      setUndo({
        message: `${label} marked ${episode.is_watched === 1 ? 'unwatched' : 'watched'}`,
        snapshot,
      });
      await refresh();
    },
    [db, show, refresh],
  );

  const onUndo = useCallback(async () => {
    if (!undo) return;
    await restoreEpisodeSnapshot(db, undo.snapshot);
    setUndo(null);
    await refresh();
  }, [db, undo, refresh]);

  // Before TVDB metadata is fetched, the checklist can only list the
  // imported unwatched rows and must say so instead of pretending it's
  // complete. After enrichment the catalog is full and the banner goes away.
  const knownRows = episodes.filter((e) => e.is_special === 0).length;
  const totalCount = show?.total_count ?? null;
  const missingRows = totalCount !== null ? Math.max(0, totalCount - knownRows) : null;
  // Episodes watched per the import carry no dates — TV Time's export
  // doesn't include per-episode history.
  const hasDatelessWatched = episodes.some((e) => e.is_watched === 1 && e.watched_at === null);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      {show ? (
        <>
          <View style={styles.header}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/shows'))}
              hitSlop={8}
              style={styles.backButton}
              accessibilityLabel="Back to shows"
            >
              <Ionicons name="arrow-back" size={20} color={colors.text} />
              <Text style={styles.backText}>Shows</Text>
            </Pressable>
            <View style={styles.headerRow}>
              {show.poster_url ? (
                <Image source={{ uri: show.poster_url }} style={styles.headerPoster} />
              ) : null}
              <View style={styles.headerInfo}>
                <Text style={styles.title} numberOfLines={2}>
                  {show.title}
                  {show.is_favorite === 1 ? (
                    <Text>
                      {'  '}
                      <Ionicons name="star" size={16} color={colors.favorite} />
                    </Text>
                  ) : null}
                </Text>
                <Text style={styles.meta}>
                  {[
                    show.status ? (STATUS_LABELS[show.status] ?? show.status) : null,
                    show.watched_count !== null && show.total_count !== null
                      ? `${show.watched_count} / ${show.total_count} eps`
                      : null,
                    show.progress_percent !== null
                      ? `${Math.round(show.progress_percent)}%`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={styles.meta}>TVDB ID: {show.tvdb_id}</Text>
              </View>
            </View>
            {show.overview ? (
              <Text style={styles.overview} numberOfLines={4}>
                {show.overview}
              </Text>
            ) : null}
            <View style={styles.progressWrap}>
              <ProgressBar
                progress={show.progress_percent !== null ? show.progress_percent / 100 : 0}
                height={6}
              />
            </View>
          </View>

          {hasDatelessWatched ? (
            <View style={styles.notice}>
              <Ionicons name="time" size={16} color={colors.accent} />
              <Text style={styles.noticeText}>
                Imported progress available, but full historical episode watched dates were not
                included in the export.
              </Text>
            </View>
          ) : null}

          {missingRows !== null && missingRows > 0 ? (
            <View style={styles.notice}>
              <Ionicons name="information-circle" size={16} color={colors.accent} />
              <Text style={styles.noticeText}>
                The TV Time export only lists unwatched episodes, so {missingRows} watched{' '}
                {missingRows === 1 ? 'episode is' : 'episodes are'} counted but not shown here.
                Full episode lists arrive with show metadata in a later update.
              </Text>
            </View>
          ) : null}

          {loaded && episodes.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-done-circle" size={40} color={colors.watched} />
              <Text style={styles.emptyTitle}>
                {show.is_watched === 1 || (show.progress_percent ?? 0) >= 100
                  ? 'All caught up'
                  : 'No episode list yet'}
              </Text>
              <Text style={styles.emptyText}>
                {show.is_watched === 1 || (show.progress_percent ?? 0) >= 100
                  ? 'Every episode TV Time knows about is watched.'
                  : 'This show has no episode data in the import. Episode lists arrive with show metadata in a later update.'}
              </Text>
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(ep) => String(ep.id)}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionCount}>
                    {section.data.filter((e) => e.is_watched === 1).length} /{' '}
                    {section.data.length}
                  </Text>
                </View>
              )}
              renderItem={({ item: ep }) => (
                <Pressable
                  onPress={() => onToggle(ep)}
                  style={({ pressed }) => [styles.episodeRow, pressed && styles.episodeRowPressed]}
                  android_ripple={{ color: colors.border }}
                  accessibilityLabel={`${ep.is_watched === 1 ? 'Mark unwatched' : 'Mark watched'} S${ep.season_number}E${ep.episode_number}`}
                >
                  <Text style={styles.episodeCode}>
                    S{String(ep.season_number).padStart(2, '0')}E
                    {String(ep.episode_number).padStart(2, '0')}
                  </Text>
                  <View style={styles.episodeInfo}>
                    <Text style={styles.episodeTitle} numberOfLines={1}>
                      {ep.title ?? `Episode ${ep.episode_number}`}
                    </Text>
                    <Text style={styles.episodeMeta}>
                      {ep.is_watched === 1
                        ? `Watched${formatDate(ep.watched_at) ? ` · ${formatDate(ep.watched_at)}` : ''}`
                        : (ep.air_date ?? 'Not watched')}
                    </Text>
                  </View>
                  {ep.is_watched === 1 ? (
                    <Ionicons name="checkmark-circle" size={24} color={colors.watched} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={24} color={colors.textMuted} />
                  )}
                </Pressable>
              )}
              contentContainerStyle={{ paddingBottom: spacing.xxl }}
              stickySectionHeadersEnabled={false}
            />
          )}
        </>
      ) : loaded ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Show not found</Text>
        </View>
      ) : null}

      {undo ? (
        <Snackbar
          message={undo.message}
          actionLabel="Undo"
          onAction={onUndo}
          onDismiss={() => setUndo(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  backText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  headerRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerPoster: {
    width: 72,
    height: 108,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  overview: {
    ...typography.caption,
    lineHeight: 18,
    marginTop: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.accent,
  },
  meta: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  progressWrap: {
    marginTop: spacing.md,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  noticeText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 17,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.accent,
  },
  sectionCount: {
    ...typography.label,
  },
  episodeRow: {
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
    paddingVertical: spacing.sm + 2,
  },
  episodeRowPressed: {
    backgroundColor: colors.cardPressed,
  },
  episodeCode: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    width: 56,
  },
  episodeInfo: {
    flex: 1,
  },
  episodeTitle: {
    ...typography.body,
  },
  episodeMeta: {
    ...typography.caption,
    marginTop: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.heading,
  },
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 17,
  },
});

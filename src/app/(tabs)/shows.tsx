import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { FlatList } from 'react-native';

import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { EmptyState } from '@/src/components/EmptyState';
import { FilterChips } from '@/src/components/FilterChips';
import { PosterCard } from '@/src/components/PosterCard';
import { Screen } from '@/src/components/Screen';
import { SearchBar } from '@/src/components/SearchBar';
import { SectionHeader } from '@/src/components/SectionHeader';
import { Snackbar } from '@/src/components/Snackbar';
import { listShows, type ShowFilter } from '@/src/lib/queries';
import {
  markShowUnwatched,
  markShowWatched,
  restoreSnapshot,
  type MediaSnapshot,
} from '@/src/lib/watchActions';
import type { MediaItem } from '@/src/types';

const FILTERS: { key: ShowFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'not_started', label: 'Not Started' },
  { key: 'continuing', label: 'Continuing' },
];

const STATUS_LABELS: Record<string, string> = {
  continuing: 'Continuing',
  up_to_date: 'Up to date',
  stopped: 'Stopped',
  not_started_yet: 'Not started',
};

function showDetail(item: MediaItem): string {
  const parts: string[] = [];
  if (item.status) parts.push(STATUS_LABELS[item.status] ?? item.status);
  if (item.watched_count !== null && item.total_count !== null) {
    parts.push(`${item.watched_count} / ${item.total_count} eps`);
  }
  if (item.progress_percent !== null) parts.push(`${Math.round(item.progress_percent)}%`);
  return parts.join(' · ');
}

export default function ShowsScreen() {
  const db = useSQLiteContext();
  const [shows, setShows] = useState<MediaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<ShowFilter>('all');
  const [search, setSearch] = useState('');
  const [confirmItem, setConfirmItem] = useState<MediaItem | null>(null);
  const [undo, setUndo] = useState<{ message: string; snapshot: MediaSnapshot } | null>(null);

  const refresh = useCallback(async () => {
    setShows(await listShows(db, filter, search));
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

  const applyToggle = useCallback(
    async (item: MediaItem) => {
      const snapshot =
        item.is_watched === 1
          ? await markShowUnwatched(db, item)
          : await markShowWatched(db, item);
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

  const onToggle = useCallback(
    (item: MediaItem) => {
      // Marking a fully-unwatched show watched affects every episode at
      // once, so it gets an explicit confirmation.
      if (item.is_watched === 0 && (item.watched_count ?? 0) === 0) {
        setConfirmItem(item);
      } else {
        applyToggle(item);
      }
    },
    [applyToggle],
  );

  const onUndo = useCallback(async () => {
    if (!undo) return;
    await restoreSnapshot(db, undo.snapshot);
    setUndo(null);
    await refresh();
  }, [db, undo, refresh]);

  return (
    <Screen
      title="Shows"
      subtitle={loaded && shows.length > 0 ? `${shows.length} shows` : undefined}
    >
      <SearchBar value={search} onChange={setSearch} />
      <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />

      {loaded && shows.length === 0 ? (
        <EmptyState
          icon="tv"
          title={filter === 'all' && search === '' ? 'No shows yet' : 'No matches'}
          message={
            filter === 'all' && search === ''
              ? 'Import your TV Time HTML export from the Profile tab and your shows will appear here.'
              : 'No shows match the current search and filter.'
          }
        />
      ) : (
        <FlatList
          data={shows}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <SectionHeader
              label={FILTERS.find((f) => f.key === filter)?.label ?? 'All'}
              count={shows.length}
            />
          }
          renderItem={({ item }) => (
            <PosterCard
              item={{
                tvdbId: item.tvdb_id,
                title: item.title,
                posterUrl: item.poster_url,
                detail: showDetail(item),
                progress:
                  item.progress_percent !== null ? item.progress_percent / 100 : undefined,
                isFavorite: item.is_favorite === 1,
                isWatched: item.is_watched === 1,
              }}
              onPress={() =>
                router.push({ pathname: '/show/[id]', params: { id: item.id } })
              }
              onToggleWatched={() => onToggle(item)}
            />
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}

      <ConfirmDialog
        visible={confirmItem !== null}
        title="Mark whole show watched?"
        message={
          confirmItem
            ? `"${confirmItem.title}" has ${confirmItem.total_count ?? 'multiple'} episodes and none are watched yet. This marks the entire show as watched. You can undo right after.`
            : ''
        }
        confirmLabel="Mark watched"
        onConfirm={() => {
          const item = confirmItem;
          setConfirmItem(null);
          if (item) applyToggle(item);
        }}
        onCancel={() => setConfirmItem(null)}
      />

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

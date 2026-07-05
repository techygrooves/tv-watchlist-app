import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList } from 'react-native';

import { EmptyState } from '@/src/components/EmptyState';
import { PosterCard } from '@/src/components/PosterCard';
import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import { listShows } from '@/src/lib/queries';
import type { MediaItem } from '@/src/types';

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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listShows(db).then((rows) => {
        if (active) setShows(rows);
      });
      return () => {
        active = false;
      };
    }, [db]),
  );

  return (
    <Screen
      title="Shows"
      subtitle={shows.length > 0 ? `${shows.length} shows in your library` : undefined}
    >
      {shows.length === 0 ? (
        <EmptyState
          icon="tv"
          title="No shows yet"
          message="Import your TV Time HTML export from the Profile tab and your shows will appear here."
        />
      ) : (
        <FlatList
          data={shows}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={<SectionHeader label="Library" count={shows.length} />}
          renderItem={({ item }) => (
            <PosterCard
              item={{
                tvdbId: item.tvdb_id,
                title: item.title,
                detail: showDetail(item),
                progress:
                  item.progress_percent !== null ? item.progress_percent / 100 : undefined,
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

import { FlatList } from 'react-native';

import { PosterCard } from '@/src/components/PosterCard';
import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import { PLACEHOLDER_MOVIES } from '@/src/data/placeholders';

export default function MoviesScreen() {
  return (
    <Screen title="Movies" subtitle="Placeholder data — your TV Time import will appear here">
      <FlatList
        data={PLACEHOLDER_MOVIES}
        keyExtractor={(item) => String(item.tvdbId)}
        ListHeaderComponent={<SectionHeader label="Watchlist" count={PLACEHOLDER_MOVIES.length} />}
        renderItem={({ item }) => <PosterCard item={item} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </Screen>
  );
}

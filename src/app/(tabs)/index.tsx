import { FlatList } from 'react-native';

import { PosterCard } from '@/src/components/PosterCard';
import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import { PLACEHOLDER_SHOWS } from '@/src/data/placeholders';

export default function ShowsScreen() {
  return (
    <Screen title="Shows" subtitle="Placeholder data — your TV Time import will appear here">
      <FlatList
        data={PLACEHOLDER_SHOWS}
        keyExtractor={(item) => String(item.tvdbId)}
        ListHeaderComponent={<SectionHeader label="Watching" count={PLACEHOLDER_SHOWS.length} />}
        renderItem={({ item }) => <PosterCard item={item} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </Screen>
  );
}

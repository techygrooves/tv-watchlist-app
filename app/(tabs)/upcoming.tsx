import { FlatList } from 'react-native';

import { PosterCard } from '@/src/components/PosterCard';
import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import { PLACEHOLDER_UPCOMING } from '@/src/data/placeholders';

export default function UpcomingScreen() {
  return (
    <Screen
      title="Upcoming"
      subtitle="Placeholder data — twice-daily release checks arrive in a later phase"
    >
      <FlatList
        data={PLACEHOLDER_UPCOMING}
        keyExtractor={(item) => String(item.tvdbId)}
        ListHeaderComponent={<SectionHeader label="Airing soon" />}
        renderItem={({ item }) => <PosterCard item={item} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </Screen>
  );
}

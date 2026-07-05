import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/src/components/EmptyState';
import { Screen } from '@/src/components/Screen';
import { colors, radius, spacing, typography } from '@/src/theme';

export default function ExploreScreen() {
  return (
    <Screen title="Explore">
      {/* Non-functional search bar placeholder — wired to TVDB search in a later phase */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <Text style={styles.searchHint}>Search shows &amp; movies…</Text>
      </View>
      <EmptyState
        icon="compass"
        title="Search coming soon"
        message="A later phase adds TVDB search here, so you can find any show or movie and add it to your watchlist."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  searchHint: {
    ...typography.body,
    color: colors.textMuted,
  },
});

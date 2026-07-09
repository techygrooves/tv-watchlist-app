import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/theme';

interface FilterChipsProps<T extends string> {
  options: { key: T; label: string }[];
  selected: T;
  onSelect: (key: T) => void;
}

export function FilterChips<T extends string>({
  options,
  selected,
  onSelect,
}: FilterChipsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Android: a horizontal ScrollView inside a flex column collapses and
      // clips its children unless it is exempted from flex shrinking.
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {options.map(({ key, label }) => (
        <Pressable
          key={key}
          onPress={() => onSelect(key)}
          style={[styles.chip, selected === key && styles.chipActive]}
        >
          <Text
            style={[styles.chipText, selected === key && styles.chipTextActive]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    ...typography.caption,
    fontWeight: '600',
    lineHeight: 16,
    // Android adds invisible font padding that pushes text out of small
    // containers and clips it; centering must be explicit.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  chipTextActive: {
    color: colors.onAccent,
  },
});

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
      contentContainerStyle={styles.row}
    >
      {options.map(({ key, label }) => (
        <Pressable
          key={key}
          onPress={() => onSelect(key)}
          style={[styles.chip, selected === key && styles.chipActive]}
        >
          <Text style={[styles.chipText, selected === key && styles.chipTextActive]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
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
  },
  chipTextActive: {
    color: colors.onAccent,
  },
});

import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/src/theme';

export function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  label: {
    ...typography.label,
  },
  count: {
    ...typography.label,
    color: colors.accent,
  },
});

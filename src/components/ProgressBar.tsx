import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/src/theme';

interface ProgressBarProps {
  /** 0..1 */
  progress: number;
  height?: number;
}

export function ProgressBar({ progress, height = 4 }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.track, { height }]}>
      <View
        style={[
          styles.fill,
          { width: `${clamped * 100}%` },
          clamped >= 1 && styles.fillComplete,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  fillComplete: {
    backgroundColor: colors.watched,
  },
});

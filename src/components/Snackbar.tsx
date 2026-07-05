import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/theme';

interface SnackbarProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. */
  duration?: number;
}

/** Bottom toast with an optional action (used for one-tap Undo). */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = 5000,
}: SnackbarProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8}>
            <Text style={styles.action}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.md,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    maxWidth: 420,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.cardPressed,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  message: {
    ...typography.body,
    flexShrink: 1,
  },
  action: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

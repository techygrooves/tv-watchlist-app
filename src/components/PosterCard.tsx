import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/src/components/ProgressBar';
import { colors, radius, spacing, typography } from '@/src/theme';

export interface PosterCardItem {
  tvdbId: number;
  title: string;
  year?: number;
  /** e.g. "S03E04 · 12 left" or "Watched Mar 2025" */
  detail?: string;
  /** 0..1 — omit to hide the progress bar */
  progress?: number;
  isFavorite?: boolean;
  isWatched?: boolean;
}

/**
 * Watchlist row with a placeholder poster (real artwork arrives with TVDB
 * metadata in a later phase). The poster shows the title's initials on a
 * hue derived from the TVDB ID so rows are visually distinct.
 */
export function PosterCard({ item, onPress }: { item: PosterCardItem; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      android_ripple={{ color: colors.border }}
    >
      <View style={[styles.poster, { backgroundColor: posterColor(item.tvdbId) }]}>
        <Text style={styles.posterInitials}>{initials(item.title)}</Text>
        {item.isFavorite ? (
          <View style={styles.favoriteBadge}>
            <Ionicons name="star" size={12} color={colors.favorite} />
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.year ? `${item.year}` : 'Year unknown'}
          {item.detail ? `  ·  ${item.detail}` : ''}
        </Text>
        {item.progress !== undefined ? (
          <View style={styles.progressWrap}>
            <ProgressBar progress={item.progress} />
          </View>
        ) : null}
      </View>

      <View style={styles.trailing}>
        {item.isWatched ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.watched} />
        ) : (
          <Ionicons name="ellipse-outline" size={22} color={colors.textMuted} />
        )}
      </View>
    </Pressable>
  );
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** Deterministic dark hue per TVDB ID so placeholder posters vary. */
function posterColor(tvdbId: number): string {
  const hue = (tvdbId * 137) % 360;
  return `hsl(${hue}, 35%, 24%)`;
}

const POSTER_WIDTH = 56;
const POSTER_HEIGHT = 84;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardPressed: {
    backgroundColor: colors.cardPressed,
  },
  poster: {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterInitials: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },
  favoriteBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.pill,
    padding: 3,
  },
  info: {
    flex: 1,
    marginLeft: spacing.md,
  },
  title: {
    ...typography.heading,
  },
  meta: {
    ...typography.caption,
    marginTop: 2,
  },
  progressWrap: {
    marginTop: spacing.sm,
  },
  trailing: {
    marginLeft: spacing.md,
  },
});

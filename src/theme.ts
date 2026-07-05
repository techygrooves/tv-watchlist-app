/**
 * Dark theme with a yellow/gold accent, used across every screen.
 * Import from here instead of hard-coding colors so the palette
 * stays consistent as the app grows.
 */
export const colors = {
  // Backgrounds, darkest to lightest
  background: '#0D0D10',
  surface: '#17171C',
  card: '#1E1E24',
  cardPressed: '#26262E',
  border: '#2A2A32',

  // Accent
  accent: '#F5C518',
  accentDim: '#B8940F',
  onAccent: '#151300',

  // Text
  text: '#F2F2F2',
  textSecondary: '#A9A9B2',
  textMuted: '#6E6E78',

  // Semantic
  watched: '#3DD07E',
  danger: '#E5484D',
  favorite: '#F5C518',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 17, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 14, fontWeight: '400' as const, color: colors.text },
  caption: { fontSize: 12, fontWeight: '400' as const, color: colors.textSecondary },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
} as const;

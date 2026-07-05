/**
 * Dark theme palette with a yellow/gold accent, used across every screen.
 * Import from here (or via src/theme) instead of hard-coding colors so the
 * palette stays consistent as the app grows.
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

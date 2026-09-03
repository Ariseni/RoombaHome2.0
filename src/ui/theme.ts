export const colors = {
  bg: '#0F172A',
  surface: '#1E293B',
  surfaceAlt: '#273449',
  border: '#334155',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  accent: '#38BDF8',
  accentDark: '#0EA5E9',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  mop: '#60A5FA',
  vacuum: '#A78BFA',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

export const font = {
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textMuted },
  mono: { fontFamily: 'monospace', fontSize: 12, color: colors.textMuted },
};

/** Distinct, readable room colours for the map (cycled by index). */
export const roomPalette = [
  '#38BDF8',
  '#A78BFA',
  '#34D399',
  '#FBBF24',
  '#F472B6',
  '#FB923C',
  '#2DD4BF',
  '#818CF8',
  '#A3E635',
  '#F87171',
  '#22D3EE',
  '#C084FC',
];

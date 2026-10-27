import { useColorScheme } from 'react-native';

const palette = {
  light: {
    background: '#FFFFFF',
    surface: '#F5F5F4',
    border: '#E7E5E4',
    text: '#0A0A0A',
    textMuted: '#78716C',
    primary: '#0A0A0A',
    onPrimary: '#FFFFFF',
    success: '#15803D',
    warning: '#B45309',
    danger: '#DC2626',
  },
  dark: {
    background: '#0A0A0A',
    surface: '#1C1917',
    border: '#292524',
    text: '#FAFAF9',
    textMuted: '#A8A29E',
    primary: '#FAFAF9',
    onPrimary: '#0A0A0A',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
  },
} as const;

export type Colors = { [K in keyof typeof palette.light]: string };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const type = {
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6, lineHeight: 38 },
  heading: { fontSize: 20, fontWeight: '600', letterSpacing: -0.3 },
  body: { fontSize: 16, lineHeight: 23 },
  label: { fontSize: 15, fontWeight: '500' },
  caption: { fontSize: 13, lineHeight: 18 },
} as const;

/** Content never grows wider than this (keeps the web preview phone-shaped). */
export const maxContentWidth = 520;

export function useColors(): Colors {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

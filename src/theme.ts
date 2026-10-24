import { useColorScheme } from 'react-native';

// White and navy. Status colors keep their hue so low and out stock still stand out.
const light = {
  bg: '#f4f6fa',
  surface: '#ffffff',
  ink: '#14213d',
  muted: '#5b6478',
  line: '#d9dee8',
  accent: '#1b2a4a',
  accentSoft: '#e3e8f2',
  ok: '#2e7d4f',
  okSoft: '#e2f0e4',
  warn: '#9a6200',
  warnSoft: '#f6ebcf',
  bad: '#b23a3a',
  badSoft: '#f5e0dc',
  // Liquid glass: panels are see-through over a soft gradient.
  glass: 'rgba(255,255,255,0.55)',
  glassBorder: 'rgba(255,255,255,0.85)',
  gradientTop: '#e9eff9',
  gradientBottom: '#b8c7e4',
};

// Dark mode flips it: navy background, white text and buttons.
const dark: typeof light = {
  bg: '#0d1526',
  surface: '#16213a',
  ink: '#ffffff',
  muted: '#a9b3c7',
  line: '#263354',
  accent: '#ffffff',
  accentSoft: '#2a3a5e',
  ok: '#7cc79a',
  okSoft: '#1b3328',
  warn: '#e8b565',
  warnSoft: '#3a3020',
  bad: '#f08a8a',
  badSoft: '#3f2230',
  glass: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.18)',
  gradientTop: '#0d1526',
  gradientBottom: '#22396e',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const fmtBottles = (n: number) => (Math.round(n * 100) / 100).toString();
export const fmtMoney = (cents: number) =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

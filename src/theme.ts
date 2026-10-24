import { useColorScheme } from 'react-native';

// "Salt and pepper": white #FFFFFF, light gray #D4D4D4, mid gray #B3B3B3, near-black #2B2B2B.
// Status colors keep a little hue so low and out stock still stand out.
const light = {
  bg: '#f5f5f5',
  surface: '#ffffff',
  ink: '#2b2b2b',
  muted: '#6b6b6b',
  line: '#d4d4d4',
  accent: '#2b2b2b',
  accentSoft: '#d4d4d4',
  ok: '#3f7a57',
  okSoft: '#e3efe5',
  warn: '#9a6200',
  warnSoft: '#f6ebcf',
  bad: '#b23a3a',
  badSoft: '#f5e0dc',
};

const dark: typeof light = {
  bg: '#1f1f1f',
  surface: '#2b2b2b',
  ink: '#ffffff',
  muted: '#b3b3b3',
  line: '#444444',
  accent: '#ffffff',
  accentSoft: '#4a4a4a',
  ok: '#7cc79a',
  okSoft: '#24352b',
  warn: '#e8b565',
  warnSoft: '#3d3220',
  bad: '#f08a8a',
  badSoft: '#432828',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const fmtBottles = (n: number) => (Math.round(n * 100) / 100).toString();
export const fmtMoney = (cents: number) =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

import { useColorScheme } from 'react-native';

// Matches the Stocked B logo: oxblood on cream. Status colors stay distinct from the accent.
const light = {
  bg: '#f6efe3',
  surface: '#fffbf4',
  ink: '#2a1418',
  muted: '#74605f',
  line: '#e6d9c6',
  accent: '#6e1e2b',
  accentSoft: '#f1ddd9',
  ok: '#2e7d4f',
  okSoft: '#e2f0e4',
  warn: '#a35a00',
  warnSoft: '#f8e7cc',
  bad: '#c62828',
  badSoft: '#f9dedb',
};

const dark: typeof light = {
  bg: '#170d0f',
  surface: '#22151a',
  ink: '#f3e9d2',
  muted: '#b7a39a',
  line: '#3a272c',
  accent: '#e5949c',
  accentSoft: '#4a1f27',
  ok: '#6ccb94',
  okSoft: '#17301f',
  warn: '#f0b05c',
  warnSoft: '#3a2a12',
  bad: '#ff7a6e',
  badSoft: '#44191a',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const fmtBottles = (n: number) => (Math.round(n * 100) / 100).toString();
export const fmtMoney = (cents: number) =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

import { useColorScheme } from 'react-native';

// "Ink wash": charcoal #4A4A4A, cool gray #CBCBCB, soft ivory #FFFFE3, slate blue #6D8196.
// The slate is a shade darker on buttons so white text stays readable.
const light = {
  bg: '#ffffe3',
  surface: '#fffff6',
  ink: '#4a4a4a',
  muted: '#6e6e6e',
  line: '#cbcbcb',
  accent: '#5e7287',
  accentSoft: '#e4e9ee',
  ok: '#3f7a57',
  okSoft: '#e3efe5',
  warn: '#9a6200',
  warnSoft: '#f6ebcf',
  bad: '#b23a3a',
  badSoft: '#f5e0dc',
};

const dark: typeof light = {
  bg: '#2e2e2e',
  surface: '#3a3a3a',
  ink: '#ffffe3',
  muted: '#cbcbcb',
  line: '#4a4a4a',
  accent: '#a3b4c6',
  accentSoft: '#3b4652',
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

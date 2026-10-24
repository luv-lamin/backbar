import { useColorScheme } from 'react-native';

const light = {
  bg: '#f3f4f6',
  surface: '#ffffff',
  ink: '#1c2230',
  muted: '#5d6677',
  line: '#dde1e8',
  brass: '#a8660f',
  brassSoft: '#f6ead6',
  ok: '#1f7a4d',
  okSoft: '#e1f2e8',
  warn: '#a35a00',
  warnSoft: '#fbecd5',
  bad: '#b42335',
  badSoft: '#fbe3e6',
};

const dark: typeof light = {
  bg: '#12151c',
  surface: '#1b202a',
  ink: '#e8ebf1',
  muted: '#9aa3b4',
  line: '#2c3340',
  brass: '#e2a24a',
  brassSoft: '#3a2c17',
  ok: '#5cc98f',
  okSoft: '#173326',
  warn: '#f0b05c',
  warnSoft: '#3a2a12',
  bad: '#f2788a',
  badSoft: '#3d1a21',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const fmtBottles = (n: number) => (Math.round(n * 100) / 100).toString();
export const fmtMoney = (cents: number) =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

import { useColorScheme } from 'react-native';
import type { ThemePreference } from '../state/settings';

export interface Palette {
  dark: boolean;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  danger: string;
  warning: string;
  key: string;
  keyPressed: string;
}

const light: Palette = {
  dark: false,
  background: '#f6f7f9',
  surface: '#ffffff',
  surfaceAlt: '#eef0f4',
  border: '#d5d9e0',
  text: '#15181d',
  textMuted: '#5b6472',
  accent: '#2f6fed',
  accentText: '#ffffff',
  danger: '#c62828',
  warning: '#9a6700',
  key: '#e6e9ef',
  keyPressed: '#cdd3dd',
};

const dark: Palette = {
  dark: true,
  background: '#111418',
  surface: '#1b1f25',
  surfaceAlt: '#232831',
  border: '#343b46',
  text: '#eef1f5',
  textMuted: '#9aa4b2',
  accent: '#5b8dff',
  accentText: '#0b0e12',
  danger: '#ff6b6b',
  warning: '#f2c94c',
  key: '#2a303a',
  keyPressed: '#3a4250',
};

export function resolveDark(pref: ThemePreference, system: 'light' | 'dark' | null | undefined): boolean {
  if (pref === 'light') return false;
  if (pref === 'dark') return true;
  return system === 'dark';
}

export function usePalette(pref: ThemePreference): Palette {
  const system = useColorScheme();
  return resolveDark(pref, system === 'dark' ? 'dark' : system === 'light' ? 'light' : null) ? dark : light;
}

export const palettes = { light, dark };

/**
 * Last-visited lesson. Only a sanitised https://scrimba.com path is stored (no query or
 * fragment, which may carry tokens). Authentication itself stays in the WebView cookie
 * store and is never read or exported by the app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sanitizeResumeUrl } from '../webview/urlPolicy';

export const LAST_LOCATION_KEY = 'scrimba-companion.lastLocation.v1';

export interface LastLocation {
  url: string;
  title: string;
  at: number;
}

export async function loadLastLocation(): Promise<LastLocation | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastLocation>;
    const url = typeof parsed.url === 'string' ? sanitizeResumeUrl(parsed.url) : null;
    if (!url) return null;
    return { url, title: typeof parsed.title === 'string' ? parsed.title.slice(0, 200) : '', at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

export async function saveLastLocation(url: string, title: string): Promise<boolean> {
  const clean = sanitizeResumeUrl(url);
  if (!clean) return false;
  await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ url: clean, title: title.slice(0, 200), at: Date.now() }));
  return true;
}

export async function clearLastLocation(): Promise<void> {
  await AsyncStorage.removeItem(LAST_LOCATION_KEY);
}

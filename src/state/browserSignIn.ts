/**
 * GitHub sign-in through the system browser (Android).
 *
 * GitHub hides "Continue with Google/Apple" inside Android WebViews and Google blocks its
 * sign-in there, so the app opens GitHub's OAuth authorize step in a Chrome Custom Tab.
 * Scrimba binds the OAuth `state` to the WebView's own session, so GitHub's redirect back to
 * https://scrimba.com/auth/github/callback must be completed in the WebView: the app is
 * registered for exactly that path and loads it in the WebView.
 *
 * Only the OAuth `state` of the sign-in the app started is stored (never the `code`), so a
 * callback the app did not start (e.g. the user signing in to Scrimba in Chrome) can be
 * handed back to the browser instead of being swallowed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BROWSER_SIGN_IN_KEY = 'scrimba-companion.browserSignIn.v1';
/** A sign-in left unfinished for longer than this is treated as abandoned. */
export const PENDING_TTL_MS = 15 * 60 * 1000;

export interface PendingSignIn {
  state: string;
  at: number;
}

interface Stored {
  pending: PendingSignIn | null;
  /** Set once a callback came back into the app, i.e. Android link handling is enabled. */
  worked: boolean;
}

async function read(): Promise<Stored> {
  try {
    const raw = await AsyncStorage.getItem(BROWSER_SIGN_IN_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
    const pending =
      p.pending && typeof p.pending.state === 'string' && typeof p.pending.at === 'number' ? { state: p.pending.state.slice(0, 200), at: p.pending.at } : null;
    return { pending, worked: p.worked === true };
  } catch {
    return { pending: null, worked: false };
  }
}

async function write(s: Stored): Promise<void> {
  await AsyncStorage.setItem(BROWSER_SIGN_IN_KEY, JSON.stringify(s));
}

/** Forgets any unfinished browser sign-in (Settings → Sign out and clear data). */
export async function clearPendingSignIn(): Promise<void> {
  const s = await read();
  await write({ ...s, pending: null });
}

export async function hasBrowserSignInWorked(): Promise<boolean> {
  return (await read()).worked;
}

export async function startPendingSignIn(state: string, now = Date.now()): Promise<void> {
  const s = await read();
  await write({ ...s, pending: { state, at: now } });
}

export type CallbackRoute = 'webview' | 'browser';

/** Pure decision: does this callback belong to the sign-in the app started? */
export function routeCallback(callbackUrl: string, pending: PendingSignIn | null, now = Date.now()): CallbackRoute {
  if (!pending || now - pending.at > PENDING_TTL_MS || now < pending.at - 60_000) return 'browser';
  let state: string | null = null;
  try {
    state = new URL(callbackUrl).searchParams.get('state');
  } catch {
    return 'browser';
  }
  return state === pending.state ? 'webview' : 'browser';
}

/** Decides where a callback goes and consumes the pending sign-in if it matches. */
export async function takeCallback(callbackUrl: string, now = Date.now()): Promise<CallbackRoute> {
  const s = await read();
  const route = routeCallback(callbackUrl, s.pending, now);
  if (route === 'webview') await write({ pending: null, worked: true });
  return route;
}

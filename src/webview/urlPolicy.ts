import { AUTH_HOSTS, FRAME_HOST_SUFFIXES, SCRIMBA_HOSTS } from '../config/constants';

export type NavigationDecision = 'allow' | 'external' | 'block';

function hostMatches(host: string, list: readonly string[]): boolean {
  const h = host.toLowerCase();
  return list.some((d) => h === d || h.endsWith('.' + d));
}

export function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isScrimbaUrl(url: string): boolean {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && hostMatches(u.hostname, SCRIMBA_HOSTS);
}

/**
 * Decides what to do with a navigation request.
 * - Scrimba and sign-in providers stay in the WebView (top frame).
 * - Sub-frames Scrimba embeds (runner/preview) are allowed.
 * - Other http(s) links open in the system browser.
 * - Everything else (intent:, file:, javascript:, data:) is blocked in the top frame.
 */
export function classifyNavigation(url: string, isTopFrame: boolean): NavigationDecision {
  if (url === 'about:blank' || url.startsWith('about:srcdoc')) return 'allow';
  const u = parseUrl(url);
  if (!u) return 'block';
  if (!isTopFrame) {
    // Scrimba previews run user code in frames; allow web content but never local files.
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'blob:' || u.protocol === 'data:') return 'allow';
    return 'block';
  }
  if (u.protocol === 'blob:' || u.protocol === 'data:') return 'block';
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return u.protocol === 'mailto:' ? 'external' : 'block';
  }
  if (u.protocol === 'https:' && (hostMatches(u.hostname, SCRIMBA_HOSTS) || hostMatches(u.hostname, AUTH_HOSTS))) return 'allow';
  if (u.protocol === 'https:' && hostMatches(u.hostname, FRAME_HOST_SUFFIXES)) return 'allow';
  return 'external';
}

export function isGoogleOAuth(url: string): boolean {
  const u = parseUrl(url);
  return !!u && u.hostname === 'accounts.google.com' && /\/o\/oauth2|\/signin\/oauth/.test(u.pathname);
}

/**
 * GitHub's own sign-in form (not its OAuth consent page). Inside an Android WebView GitHub
 * hides "Continue with Google/Apple" and passkeys: it keys on the `X-Requested-With` header
 * the WebView adds (verified 2026-11-06; the user agent alone does not change it).
 */
export function isGitHubSignIn(url: string): boolean {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && u.hostname === 'github.com' && /^\/(login|session)\/?$/.test(u.pathname);
}

/** Scrimba's GitHub OAuth callback; the app is registered for exactly this path (app.json). */
export const SCRIMBA_GITHUB_CALLBACK = 'https://scrimba.com/auth/github/callback';

export function isScrimbaGitHubCallback(url: string): boolean {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && u.hostname === 'scrimba.com' && u.pathname === '/auth/github/callback';
}

/**
 * If `url` is GitHub's OAuth authorize step for Scrimba (directly, or GitHub's sign-in page
 * whose `return_to` leads there), returns the authorize URL and its `state`; otherwise null.
 * Only Scrimba's own callback is accepted as redirect_uri.
 */
export function scrimbaGitHubAuthorize(url: string): { url: string; state: string } | null {
  const u = parseUrl(url);
  if (!u || u.protocol !== 'https:' || u.hostname !== 'github.com') return null;
  let authorize: URL | null = null;
  if (u.pathname === '/login/oauth/authorize') authorize = u;
  else if (/^\/(login|session)\/?$/.test(u.pathname)) {
    const returnTo = u.searchParams.get('return_to');
    if (returnTo && returnTo.startsWith('/login/oauth/authorize')) authorize = parseUrl(`https://github.com${returnTo}`);
  }
  if (!authorize || authorize.pathname !== '/login/oauth/authorize') return null;
  const redirect = authorize.searchParams.get('redirect_uri');
  const state = authorize.searchParams.get('state');
  if (!redirect || !state || !isScrimbaGitHubCallback(redirect)) return null;
  return { url: authorize.toString(), state };
}

/** Where a GitHub user without a password (signed up with Google/Apple) can set one. */
export const GITHUB_SET_PASSWORD_URL = 'https://github.com/password_reset';

const NON_RESUMABLE = /^\/(login|log-in|signin|sign-in|signup|sign-up|register|logout|log-out|reset|forgot|oauth|auth|verify|checkout|billing|pricing|settings|account)(\/|$)/i;

/** Strips query and fragment; returns null for URLs that should not be resumed. */
export function sanitizeResumeUrl(url: string): string | null {
  const u = parseUrl(url);
  if (!u || u.protocol !== 'https:' || !hostMatches(u.hostname, SCRIMBA_HOSTS)) return null;
  if (NON_RESUMABLE.test(u.pathname)) return null;
  return `${u.origin}${u.pathname}`;
}

/** Heuristic: a URL that looks like a lesson/scrim rather than a catalogue page. */
export function looksLikeLesson(url: string): boolean {
  const u = parseUrl(url);
  if (!u || !hostMatches(u.hostname, SCRIMBA_HOSTS)) return false;
  // Scrim ids look like /s0v687325e; course lessons are nested under a course slug.
  return /\/s0[a-z0-9]{6,}/i.test(u.pathname) || /~[0-9a-z]+/i.test(u.pathname) || /\/(learn|scrim|lesson)\//i.test(u.pathname);
}

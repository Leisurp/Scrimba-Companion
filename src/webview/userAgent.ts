import type { CompatMode } from '../state/settings';

export type ResolvedMode = 'mobile' | 'desktop';

/**
 * Default per platform, based on the investigation in docs/COMPATIBILITY_FINDINGS.md:
 * Scrimba serves the same IDE to mobile and desktop user agents, and the keyboard bug is
 * caused by a touch-capability rule rather than user-agent detection. The mobile UA is
 * therefore the safer default on both platforms (it keeps sign-in providers and the
 * site's touch affordances working); Desktop remains available as a manual override.
 */
export function resolveMode(mode: CompatMode): ResolvedMode {
  return mode === 'desktop' ? 'desktop' : 'mobile';
}

/** A current desktop Chrome UA. Chrome major updated with app releases. */
export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

export const APP_UA_TOKEN = 'ScrimbaCompanion/1.0';

/**
 * Returns the WebView user-agent props for a mode.
 * Mobile keeps the platform's real WebView UA (only appending an honest app token);
 * Desktop replaces it entirely, which is what "Request desktop site" does in browsers.
 */
export function userAgentProps(mode: ResolvedMode): { userAgent?: string; applicationNameForUserAgent?: string } {
  if (mode === 'desktop') return { userAgent: DESKTOP_USER_AGENT };
  return { applicationNameForUserAgent: APP_UA_TOKEN };
}

export const APP_NAME = 'Scrimba Companion';
export const SCRIMBA_ORIGIN = 'https://scrimba.com';
export const SCRIMBA_HOME = 'https://scrimba.com/home';

/** Hosts that belong to the Scrimba session and stay inside the WebView. */
export const SCRIMBA_HOSTS = ['scrimba.com'];

/**
 * Hosts used by sign-in flows that must stay inside the WebView so the resulting
 * session cookie lands in the WebView's cookie store.
 * Note: Google blocks OAuth inside embedded WebViews (disallowed_useragent); see README.
 */
export const AUTH_HOSTS = ['github.com', 'accounts.google.com', 'appleid.apple.com', 'discord.com', 'login.microsoftonline.com'];

/** Sub-resources Scrimba embeds (runner, previews); allowed in sub-frames only. */
export const FRAME_HOST_SUFFIXES = ['stackblitz.com', 'webcontainer-api.io', 'webcontainer.io', 'scrimba.com', 'scrimbausercontent.com'];

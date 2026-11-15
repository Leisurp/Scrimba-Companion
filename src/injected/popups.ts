/**
 * Single-window popups (iOS).
 *
 * Scrimba's "Continue with GitHub/Google" opens an empty popup and points it somewhere
 * afterwards (traced 2026-11-15 on the live site):
 *
 *   const w = window.open('about:blank', '_blank', 'popup,left=…');
 *   w.addEventListener('message', …); w.addEventListener('load', …);
 *   w.closed; w.location = '/auth/github';
 *
 * The app has one WebView and no second window. On iOS react-native-webview then loads
 * 'about:blank' into the main WebView and hands the page `null`, which left users on a blank
 * page. For empty popups we return a stand-in instead: setting its location navigates this
 * window, the same thing Android's WebView does with multiple windows turned off. Popups
 * opened with a real URL are left to the WebView.
 */
type Href = string | URL;

export function isBlankPopupUrl(url: unknown): boolean {
  if (url === undefined || url === null) return true;
  const s = String(url).trim();
  return s === '' || s === 'about:blank';
}

export function createStandInPopup(win: Window): Window {
  let closed = false;
  const go = (href: unknown) => {
    if (closed) return;
    let target: URL;
    try {
      target = new URL(String(href), win.location.href);
    } catch {
      return;
    }
    // Only web pages; the app's navigation policy still decides what may load.
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return;
    win.location.assign(target.href);
  };
  const location = {
    get href(): string {
      return 'about:blank';
    },
    set href(v: unknown) {
      go(v);
    },
    assign: (v: Href) => go(v),
    replace: (v: Href) => go(v),
    reload: () => undefined,
    toString: () => 'about:blank',
  };
  const noop = () => undefined;
  const popup = {
    get closed() {
      return closed;
    },
    get location(): object {
      return location;
    },
    set location(v: unknown) {
      go(v);
    },
    opener: win,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
    postMessage: noop,
    focus: noop,
    blur: noop,
    close() {
      closed = true;
    },
  };
  return popup as unknown as Window;
}

export function installSingleWindowPopups(win: Window): void {
  const orig = win.open;
  if (typeof orig !== 'function') return;
  win.open = function patchedOpen(this: Window, ...args: Parameters<Window['open']>) {
    if (isBlankPopupUrl(args[0])) return createStandInPopup(win);
    return orig.apply(this, args);
  } as Window['open'];
}

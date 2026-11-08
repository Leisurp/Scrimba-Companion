/**
 * Early hooks, injected before page scripts run (injectedJavaScriptBeforeContentLoaded).
 * Kept tiny and side-effect-light:
 *  - tracks media elements, including detached `new Audio()` instances Scrimba uses,
 *    and records play() rejections (e.g. autoplay policy) for diagnostics;
 *  - emits `sc:locationchange` on History API navigation;
 *  - records uncaught error *messages* (no stacks, no URLs) for diagnostics.
 */
import { PAGE_EARLY_GLOBAL } from '../shared/protocol';

export function installEarlyHooks(win: Window): void {
  const w = win as unknown as Record<string, unknown>;
  if (w[PAGE_EARLY_GLOBAL]) return;
  const state = { media: [] as WeakRef<HTMLMediaElement>[], mediaErrors: [] as string[], errors: [] as string[] };
  w[PAGE_EARLY_GLOBAL] = state;

  const push = (arr: string[], msg: string) => {
    arr.push(msg.slice(0, 200));
    if (arr.length > 30) arr.shift();
  };

  try {
    const proto = (win as unknown as typeof globalThis).HTMLMediaElement?.prototype;
    const WR = (win as unknown as typeof globalThis).WeakRef;
    if (proto && typeof proto.play === 'function') {
      const origPlay = proto.play;
      const seen = new WeakSet<HTMLMediaElement>();
      proto.play = function patchedPlay(this: HTMLMediaElement) {
        if (!seen.has(this)) {
          seen.add(this);
          if (typeof WR === 'function') {
            state.media.push(new WR(this));
            if (state.media.length > 50) state.media.shift();
          }
        }
        const result = origPlay.apply(this, arguments as unknown as []);
        if (result && typeof result.catch === 'function') {
          result.catch((e: unknown) => {
            push(state.mediaErrors, `play() rejected: ${e instanceof Error ? e.name : String(e)}`);
          });
        }
        return result;
      };
    }
  } catch {
    /* ignore */
  }

  try {
    const h = win.history;
    (['pushState', 'replaceState'] as const).forEach((fn) => {
      const orig = h[fn];
      h[fn] = function patched(this: History, ...args: Parameters<History['pushState']>) {
        const r = orig.apply(this, args);
        try {
          win.dispatchEvent(new Event('sc:locationchange'));
        } catch {
          /* ignore */
        }
        return r;
      } as History['pushState'];
    });
  } catch {
    /* ignore */
  }

  win.addEventListener('error', (e) => {
    const ev = e as ErrorEvent;
    if (ev && ev.message) push(state.errors, ev.message);
  });
  win.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    push(state.errors, `unhandled rejection: ${r instanceof Error ? r.name + ': ' + r.message : typeof r}`);
  });
}

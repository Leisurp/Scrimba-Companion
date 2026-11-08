/**
 * Navigation module: reports SPA location changes (Scrimba navigates with the History
 * API, which the native WebView does not always surface) so the app can remember the
 * last lesson. Only origin + pathname are sent; queries and fragments never leave the page.
 */
import { safeLocation, statusOf, type CompatModule, type Context } from '../core';

const NAME = 'navigation';

export function createNavigationModule(): CompatModule {
  let last = '';
  function check(ctx: Context) {
    const loc = safeLocation(ctx.win);
    if (loc && loc !== last) {
      last = loc;
      ctx.bridge.post({ kind: 'location', location: loc, title: (ctx.doc.title || '').slice(0, 200) });
    }
  }
  return {
    name: NAME,
    init(ctx) {
      // Fired by the early script's History API hooks, plus native popstate.
      ctx.listen(ctx.win, 'sc:locationchange', () => ctx.guard(NAME, () => check(ctx)));
      ctx.listen(ctx.win, 'popstate', () => ctx.guard(NAME, () => check(ctx)));
      check(ctx);
    },
    tick(ctx) {
      check(ctx);
    },
    status(ctx) {
      return statusOf(ctx, NAME, true, true, `location=${last}`);
    },
  };
}

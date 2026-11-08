/**
 * Execution capability module.
 *
 * Evidence (docs/COMPATIBILITY_FINDINGS.md): Scrimba runs lesson code in a StackBlitz
 * WebContainer (even HTML lessons start `npx servor` in the runner). WebContainers need
 * SharedArrayBuffer, which browsers only expose to cross-origin-isolated pages.
 * Desktop Chromium: crossOriginIsolated=true. Android System WebView 133:
 * crossOriginIsolated=false and SharedArrayBuffer undefined, so the runner cannot boot
 * and edits never reach the preview. This cannot be fixed from page scripts, so the
 * module only *detects and reports* it; the app offers to open the lesson in a browser.
 *
 * When the runner fails, Scrimba also pops an error toast (`op-toast.error`) reading
 * "DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer
 * requires self.crossOriginIsolated" (reproduced in Chromium with COOP/COEP stripped).
 * The app's own notice already explains this, so in non-isolated pages that one toast is
 * hidden (other Scrimba toasts are untouched) and the event is logged for diagnostics.
 */
import { statusOf, type CompatModule, type Context } from '../core';

const NAME = 'execution';

export interface ExecutionCapability {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  webContainerExpected: boolean;
}

export function detectExecution(win: Window): ExecutionCapability {
  const doc = win.document;
  const w = win as unknown as { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown };
  const webContainerExpected =
    !!doc.querySelector('iframe[src*="stackblitz.com/headless"], iframe[src*="webcontainer"]') ||
    !!doc.querySelector('si-runner-view');
  return {
    crossOriginIsolated: w.crossOriginIsolated === true,
    sharedArrayBuffer: typeof w.SharedArrayBuffer === 'function',
    webContainerExpected,
  };
}

export function executionBlocked(c: ExecutionCapability): boolean {
  return c.webContainerExpected && (!c.crossOriginIsolated || !c.sharedArrayBuffer);
}

const HIDDEN_ATTR = 'data-sc-hidden';

/** Scrimba's toast for the runner failing to share memory with its worker (no cross-origin isolation). */
export function isRunnerIsolationToast(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'op-toast') return false;
  const text = el.textContent || '';
  return /DataCloneError/.test(text) && /postMessage|SharedArrayBuffer|crossOriginIsolated/i.test(text);
}

/** Hides matching toasts; returns how many were newly hidden. */
export function hideRunnerIsolationToasts(doc: Document): number {
  let hidden = 0;
  doc.querySelectorAll('op-toast').forEach((el) => {
    if (el.hasAttribute(HIDDEN_ATTR) || !isRunnerIsolationToast(el)) return;
    el.setAttribute(HIDDEN_ATTR, 'runner-isolation');
    (el as HTMLElement).style.setProperty('display', 'none', 'important');
    hidden++;
  });
  return hidden;
}

export function createExecutionModule(): CompatModule {
  let last = '';
  let toastsHidden = 0;

  function sweep(ctx: Context) {
    const n = hideRunnerIsolationToasts(ctx.doc);
    if (n) {
      toastsHidden += n;
      if (toastsHidden === n) ctx.logger.log('warn', NAME, "hid Scrimba's DataCloneError toast (runner needs cross-origin isolation)");
    }
  }

  return {
    name: NAME,
    init(ctx) {
      // Only where the runner cannot work; with isolation a DataCloneError would be a real bug.
      if ((ctx.win as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true) return;
      const MO = (ctx.win as unknown as typeof globalThis).MutationObserver;
      sweep(ctx);
      if (typeof MO !== 'function') return;
      // MutationObserver callbacks run before the next paint, so the toast never flashes.
      const mo = new MO((records) => {
        if (records.some((r) => r.addedNodes.length > 0 || r.type === 'characterData')) ctx.guard(NAME, () => sweep(ctx));
      });
      const observe = () => ctx.doc.body && mo.observe(ctx.doc.body, { childList: true, subtree: true, characterData: true });
      if (ctx.doc.body) observe();
      else ctx.listen(ctx.doc, 'DOMContentLoaded', observe);
      ctx.onDispose(() => mo.disconnect());
    },
    tick(ctx: Context) {
      const c = detectExecution(ctx.win);
      if (!c.crossOriginIsolated) sweep(ctx);
      const key = JSON.stringify(c);
      if (key !== last) {
        last = key;
        ctx.bridge.post({ kind: 'execution', ...c, blocked: executionBlocked(c) });
        if (executionBlocked(c)) ctx.logger.log('warn', NAME, 'code runner needs cross-origin isolation (SharedArrayBuffer), unavailable in this WebView');
      }
    },
    onConfig() {
      // Native sends config right after each (re)load handshake: re-announce our state.
      last = '';
    },
    status(ctx) {
      const c = detectExecution(ctx.win);
      return statusOf(ctx, NAME, c.webContainerExpected, !executionBlocked(c), `coi=${c.crossOriginIsolated} sab=${c.sharedArrayBuffer} runner=${c.webContainerExpected} toastsHidden=${toastsHidden}`);
    },
  };
}

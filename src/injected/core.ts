/**
 * Core of the injected page runtime: message bridge, logger and module context.
 *
 * Everything here runs inside the Scrimba page (Android System WebView / WKWebView),
 * so it must be defensive: never throw into the page, never touch unrelated DOM.
 */
import type {
  LogLevel,
  ModuleStatus,
  PageToNative,
  RuntimeConfig,
  InputCounters,
} from '../shared/protocol';

export interface LogEntry {
  t: number;
  level: LogLevel;
  module: string;
  message: string;
}

export interface Bridge {
  post(msg: PageToNative): void;
}

interface RNWindow {
  ReactNativeWebView?: { postMessage(data: string): void };
  __SC_OUTBOX__?: PageToNative[];
}

/**
 * Bridge to the native app. Falls back to an in-page outbox for tests and fixtures.
 *
 * Every message is wrapped as `{ t: token, m: message }`. On Android the
 * `ReactNativeWebView` interface is visible to all frames, including the iframe that
 * runs the learner's code; the token (only present in the main frame) lets the native
 * side discard anything not sent by this runtime.
 */
export function createBridge(win: Window, token = ''): Bridge {
  return {
    post(msg) {
      const w = win as unknown as RNWindow;
      try {
        if (w.ReactNativeWebView && typeof w.ReactNativeWebView.postMessage === 'function') {
          w.ReactNativeWebView.postMessage(JSON.stringify({ t: token, m: msg }));
        } else {
          (w.__SC_OUTBOX__ = w.__SC_OUTBOX__ || []).push(msg);
          if (w.__SC_OUTBOX__.length > 500) w.__SC_OUTBOX__.splice(0, 100);
        }
      } catch {
        /* never throw into the page */
      }
    },
  };
}

export class Logger {
  readonly entries: LogEntry[] = [];
  constructor(
    private bridge: Bridge,
    private isDebug: () => boolean,
    private max = 200,
  ) {}

  log(level: LogLevel, module: string, message: string): void {
    const entry: LogEntry = { t: Date.now(), level, module, message: String(message).slice(0, 500) };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
    if (level === 'warn' || level === 'error' || this.isDebug()) {
      this.bridge.post({ kind: 'log', level, module, message: entry.message });
    }
  }
}

export type RuntimeEvent =
  | 'editingChanged'
  | 'editorsChanged'
  | 'playbackChanged'
  | 'configChanged'
  | 'viewportChanged';

export interface Context {
  win: Window;
  doc: Document;
  bridge: Bridge;
  logger: Logger;
  config(): RuntimeConfig;
  /** Shared state between modules. */
  state: SharedState;
  /** Cross-module services, wired by the runtime. */
  services: Services;
  on(event: RuntimeEvent, fn: () => void): void;
  emit(event: RuntimeEvent): void;
  /** Run fn, logging (not throwing) errors for a module. */
  guard<T>(module: string, fn: () => T, fallback?: T): T | undefined;
  errorCount(module: string): number;
  /** addEventListener that is undone by dispose(). */
  listen(target: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions | boolean): void;
  /** Register cleanup (observers, timers) that dispose() runs. */
  onDispose(fn: () => void): void;
  dispose(): void;
}

export interface Services {
  /** Pause Scrimba playback if it is playing. Returns true if a pause was issued. */
  pausePlayback(reason: string): boolean;
  /** The editor the user is (or was last) working in. */
  activeEditor(): import('./monacoTypes').ICodeEditor | null;
}

export interface SharedState {
  editing: boolean;
  playback: 'playing' | 'paused' | 'unknown';
  softKeyboardVisible: boolean;
  softKeyboardHeight: number;
  input: InputCounters;
  pointerEventsFix: string[];
  /** When the app toolbar last changed the selection (touch selection shows handles for it). */
  selectionArmedAt: number;
}

export function newInputCounters(): InputCounters {
  return {
    keydown: 0,
    keydownIme229: 0,
    beforeinput: {},
    input: 0,
    compositionstart: 0,
    compositionend: 0,
    focus: 0,
    blur: 0,
    tapAssistFocus: 0,
    touchFixApplied: 0,
  };
}

export function createContext(win: Window, bridge: Bridge, getConfig: () => RuntimeConfig): Context {
  const listeners = new Map<RuntimeEvent, Set<() => void>>();
  const errors = new Map<string, number>();
  const logger = new Logger(bridge, () => getConfig().debug);
  const disposers: (() => void)[] = [];
  const ctx: Context = {
    win,
    doc: win.document,
    bridge,
    logger,
    config: getConfig,
    state: {
      editing: false,
      playback: 'unknown',
      softKeyboardVisible: false,
      softKeyboardHeight: 0,
      input: newInputCounters(),
      pointerEventsFix: [],
      selectionArmedAt: 0,
    },
    services: {
      pausePlayback: () => false,
      activeEditor: () => null,
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    emit(event) {
      listeners.get(event)?.forEach((fn) => ctx.guard('events', fn));
    },
    guard(module, fn, fallback) {
      try {
        return fn();
      } catch (e) {
        errors.set(module, (errors.get(module) || 0) + 1);
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        logger.log('error', module, msg);
        return fallback;
      }
    },
    errorCount(module) {
      return errors.get(module) || 0;
    },
    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      disposers.push(() => target.removeEventListener(type, fn, opts));
    },
    onDispose(fn) {
      disposers.push(fn);
    },
    dispose() {
      while (disposers.length) disposers.pop()!();
    },
  };
  return ctx;
}

/**
 * A compatibility module. Each module detects whether it applies, fails safely and
 * reports a status for diagnostics. `tick` is called periodically because Scrimba is
 * a single-page app that creates and destroys editors while navigating.
 */
export interface CompatModule {
  readonly name: string;
  init(ctx: Context): void;
  tick(ctx: Context): void;
  status(ctx: Context): ModuleStatus;
  onConfig?(ctx: Context): void;
}

export function statusOf(
  ctx: Context,
  name: string,
  applicable: boolean,
  active: boolean,
  detail: string,
): ModuleStatus {
  return { name, applicable, active, detail, errorCount: ctx.errorCount(name) };
}

/** Shared <style> element owned by the runtime. Recreated if the page removes it. */
const STYLE_ID = 'sc-companion-style';
const styleParts = new Map<string, string>();

export function setStyle(doc: Document, key: string, css: string): void {
  if (css) styleParts.set(key, css);
  else styleParts.delete(key);
  flushStyle(doc);
}

export function flushStyle(doc: Document): void {
  let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const text = Array.from(styleParts.values()).join('\n');
  if (!el) {
    if (!text) return;
    el = doc.createElement('style');
    el.id = STYLE_ID;
    (doc.head || doc.documentElement).appendChild(el);
  }
  if (el.textContent !== text) el.textContent = text;
}

export function resetStylesForTests(): void {
  styleParts.clear();
}

/** Dispatch a full synthetic pointer + mouse click sequence (Imba/op-ui listens to pointer events). */
export function activateElement(win: Window, el: Element): void {
  const rect = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  };
  const W = win as unknown as typeof globalThis;
  if (typeof W.PointerEvent === 'function') {
    el.dispatchEvent(new W.PointerEvent('pointerdown', { ...base, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new W.PointerEvent('pointerup', { ...base, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }
  el.dispatchEvent(new W.MouseEvent('click', { ...base, buttons: 0 }));
}

/** origin + pathname only; never forward query strings or fragments (may carry tokens). */
export function safeLocation(win: Window): string {
  try {
    return win.location.origin + win.location.pathname;
  } catch {
    return '';
  }
}

export function isTouchDevice(win: Window): boolean {
  try {
    const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
    const html = win.document.documentElement;
    return coarse || html.classList.contains('touch-interface') || (win.navigator.maxTouchPoints || 0) > 0;
  } catch {
    return false;
  }
}

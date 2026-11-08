/**
 * Page runtime entry: wires the compatibility modules, receives native commands and
 * answers diagnostics requests. Exposed as `window.__SC__`.
 */
import {
  DEFAULT_RUNTIME_CONFIG,
  PAGE_BOOT_CONFIG,
  PAGE_GLOBAL,
  PAGE_TOKEN,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
  type NativeToPage,
  type PageDiagnostics,
  type RuntimeConfig,
} from '../shared/protocol';
import { createBridge, createContext, flushStyle, isTouchDevice, safeLocation, type Bridge, type CompatModule, type Context } from './core';
import { createEditorModule } from './modules/editor';
import { createKeyboardModule, setSoftKeyboard } from './modules/keyboard';
import { createPlaybackModule, getEarly, playbackDiagnostics } from './modules/playback';
import { captionsDiagnostics, createSubtitlesModule } from './modules/subtitles';
import { createFullscreenModule, findPreview } from './modules/fullscreen';
import { createLayoutModule } from './modules/layout';
import { createNavigationModule } from './modules/navigation';
import { createExecutionModule } from './modules/execution';
import { createSelectionModule } from './modules/selection';
import { getMonaco, readOption } from './monacoTypes';

export interface Runtime {
  version: string;
  receive(msg: NativeToPage | string): void;
  diagnostics(): PageDiagnostics;
  tick(): void;
  config(): RuntimeConfig;
  ctx: Context;
  stop(): void;
}

export function mergeConfig(base: RuntimeConfig, patch: Partial<RuntimeConfig> | undefined | null): RuntimeConfig {
  if (!patch || typeof patch !== 'object') return base;
  return { ...base, ...patch, captions: { ...base.captions, ...(patch.captions || {}) } };
}

/** Runtimes by window. The page only sees a narrow facade (see `startRuntime`). */
const runtimes = new WeakMap<Window, Runtime>();

export function startRuntime(win: Window, options: { bridge?: Bridge; tickMs?: number } = {}): Runtime {
  const w = win as unknown as Record<string, unknown>;
  const existing = runtimes.get(win);
  if (existing) {
    existing.tick();
    return existing;
  }

  let config = mergeConfig(DEFAULT_RUNTIME_CONFIG, w[PAGE_BOOT_CONFIG] as Partial<RuntimeConfig>);
  const token = typeof w[PAGE_TOKEN] === 'string' ? (w[PAGE_TOKEN] as string) : '';
  try {
    delete w[PAGE_TOKEN];
  } catch {
    /* ignore */
  }
  const bridge = options.bridge || createBridge(win, token);
  const ctx = createContext(win, bridge, () => config);

  const editor = createEditorModule();
  const keyboard = createKeyboardModule();
  const playback = createPlaybackModule();
  const subtitles = createSubtitlesModule();
  const fullscreen = createFullscreenModule();
  const layout = createLayoutModule(() => fullscreen.current());
  const navigation = createNavigationModule();
  const execution = createExecutionModule();
  const selection = createSelectionModule();
  const modules: CompatModule[] = [navigation, playback, editor, keyboard, selection, subtitles, fullscreen, layout, execution];

  modules.forEach((m) => ctx.guard(m.name, () => m.init(ctx)));

  let lastModulesKey = '';
  function tick() {
    modules.forEach((m) => ctx.guard(m.name, () => m.tick(ctx)));
    flushStyle(ctx.doc);
    const statuses = modules.map((m) => ctx.guard(m.name, () => m.status(ctx))!).filter(Boolean);
    const key = JSON.stringify(statuses);
    if (key !== lastModulesKey) {
      lastModulesKey = key;
      bridge.post({ kind: 'modules', modules: statuses });
    }
  }

  function diagnostics(): PageDiagnostics {
    const m = getMonaco(win);
    const eds = m ? m.editor.getEditors() : [];
    const html = win.document.documentElement;
    const early = getEarly(win);
    const logs = ctx.logger.entries.slice(-60).map((e) => ({ ...e }));
    early?.errors.slice(-10).forEach((msg) => logs.push({ t: 0, level: 'error', module: 'page', message: msg }));
    const fs = fullscreen.current();
    return {
      runtimeVersion: RUNTIME_VERSION,
      userAgent: win.navigator.userAgent,
      viewport: {
        width: win.innerWidth,
        height: win.innerHeight,
        dpr: win.devicePixelRatio || 1,
        visualHeight: win.visualViewport ? Math.round(win.visualViewport.height) : null,
      },
      touch: {
        maxTouchPoints: win.navigator.maxTouchPoints || 0,
        coarsePointer: typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches,
        touchInterfaceClass: html.classList.contains('touch-interface'),
      },
      monaco: {
        present: !!m,
        editors: eds.length,
        editContextSupported: typeof (win as unknown as Record<string, unknown>).EditContext === 'function',
        editContextEnabled: m && eds[0] ? !!readOption(m, eds[0], 'editContext') : null,
      },
      pointerEventsFix: ctx.state.pointerEventsFix.slice(),
      modules: modules.map((mod) => mod.status(ctx)),
      input: JSON.parse(JSON.stringify(ctx.state.input)),
      playback: playbackDiagnostics(ctx),
      captions: captionsDiagnostics(win.document),
      layout: { ...fs, previewAvailable: !!findPreview(win.document) },
      logs,
      location: safeLocation(win),
    };
  }

  function receive(raw: NativeToPage | string) {
    ctx.guard('runtime', () => {
      const msg: NativeToPage = typeof raw === 'string' ? JSON.parse(raw) : raw;
      switch (msg.kind) {
        case 'config':
          config = mergeConfig(DEFAULT_RUNTIME_CONFIG, msg.config);
          modules.forEach((m) => m.onConfig && ctx.guard(m.name, () => m.onConfig!(ctx)));
          ctx.emit('configChanged');
          tick();
          break;
        case 'editor': {
          const result = editor.api.run(msg.command);
          bridge.post({ kind: 'commandResult', id: msg.id, ...result });
          break;
        }
        case 'playback':
          if (msg.action === 'pause') playback.pause(ctx, 'native');
          else playback.play(ctx);
          break;
        case 'layout':
          fullscreen.set(ctx, msg);
          break;
        case 'requestDiagnostics':
          bridge.post({ kind: 'diagnostics', report: diagnostics() });
          break;
        case 'appState':
          if (msg.state === 'background') playback.pause(ctx, 'app-background');
          break;
        case 'softKeyboard':
          setSoftKeyboard(ctx, msg.visible, msg.height);
          ctx.emit('viewportChanged');
          break;
        default:
          ctx.logger.log('warn', 'runtime', 'unknown message');
      }
    });
  }

  const tickMs = options.tickMs ?? 1000;
  const interval = tickMs > 0 ? win.setInterval(tick, tickMs) : 0;
  let mo: MutationObserver | null = null;
  // React quickly when Scrimba mounts an editor after SPA navigation.
  if (typeof MutationObserver !== 'undefined' && tickMs > 0) {
    let pending = false;
    mo = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      win.setTimeout(() => {
        pending = false;
        tick();
      }, 250);
    });
    const startObserving = () => win.document.body && mo!.observe(win.document.body, { childList: true, subtree: true });
    if (win.document.body) startObserving();
    else win.addEventListener('DOMContentLoaded', startObserving);
  }

  const runtime: Runtime = {
    version: RUNTIME_VERSION,
    receive,
    diagnostics,
    tick,
    config: () => config,
    ctx,
    stop() {
      if (interval) win.clearInterval(interval);
      mo?.disconnect();
      ctx.dispose();
      runtimes.delete(win);
      delete w[PAGE_GLOBAL];
    },
  };
  runtimes.set(win, runtime);
  // What page scripts can reach: commands in (the native side delivers them through this),
  // diagnostics out. Never the context, so nothing on the page can use the app bridge
  // (clipboard, snapshots) directly.
  Object.defineProperty(win, PAGE_GLOBAL, {
    configurable: true, // stop() removes it
    enumerable: false,
    writable: false, // page scripts can't swap in their own receiver for app commands
    value: Object.freeze({
      version: runtime.version,
      receive: runtime.receive,
      diagnostics: runtime.diagnostics,
      tick: runtime.tick,
      config: runtime.config,
      stop: runtime.stop,
    }),
  });
  tick();
  bridge.post({ kind: 'ready', runtimeVersion: RUNTIME_VERSION, protocol: PROTOCOL_VERSION, location: safeLocation(win) });
  ctx.logger.log('info', 'runtime', `started; touch=${isTouchDevice(win)}`);
  return runtime;
}

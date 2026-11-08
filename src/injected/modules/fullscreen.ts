/**
 * Full-screen module: expands Scrimba's *real* editor (or mini-browser preview) to fill
 * the page using layout-only CSS. No second editor is created, so code, cursor,
 * selections, undo history and execution are untouched.
 *
 * Evidence: `app-ide` has a transform and `si-workspace-canvas` uses container-type:size,
 * so `position: fixed` resolves against them; ancestors also form stacking contexts, so
 * each ancestor of the expanded element is lifted with z-index. Verified visually on
 * scrimba.com in Chromium: the editor covers header, slides, preview and captions.
 */
import { setStyle, statusOf, type CompatModule, type Context } from '../core';
import { getMonaco } from '../monacoTypes';
import { findEditorHost } from './keyboard';

const NAME = 'fullscreen';
export const FS_ATTR = 'data-sc-fullscreen';
export const FS_CHAIN_ATTR = 'data-sc-fs-chain';

const CSS = [
  `[${FS_ATTR}]{position:fixed !important;inset:0 !important;width:auto !important;height:auto !important;max-width:none !important;max-height:none !important;z-index:2147483000 !important;margin:0 !important;background:var(--sc-fs-bg,#1e1e1e);}`,
  `[${FS_CHAIN_ATTR}]{z-index:2147483000 !important;}`,
  `html[data-sc-fs-active] body{overflow:hidden !important;}`,
].join('\n');

export function findEditorHostForFullscreen(doc: Document): Element | null {
  const monacoEl = doc.querySelector('.monaco-editor');
  if (!monacoEl) return null;
  return findEditorHost(monacoEl);
}

/** True for any computed colour with zero alpha (transparent, rgba(..,0), lch(.. / 0)). */
export function isTransparent(color: string | null | undefined): boolean {
  if (!color || color === 'transparent') return true;
  const rgba = /^rgba\([^)]*,\s*([0-9.]+)\s*\)$/.exec(color);
  if (rgba) return Number(rgba[1]) === 0;
  const slash = /\/\s*([0-9.]+%?)\s*\)$/.exec(color);
  if (slash) return parseFloat(slash[1]) === 0;
  return false;
}

/**
 * Background to paint behind the expanded element. Scrimba's Monaco theme is transparent
 * (verified on Android WebView: rgba(255,255,255,0)); the colour lives on an ancestor
 * (si-file-view). Use the first opaque background walking up from the element.
 */
export function opaqueBackground(win: Window, el: Element | null, fallback = '#1e1e1e'): string {
  let node: Element | null = el;
  while (node) {
    const bg = win.getComputedStyle(node).backgroundColor;
    if (!isTransparent(bg)) return bg;
    node = node.parentElement;
  }
  return fallback;
}

export function findPreview(doc: Document): Element | null {
  return doc.querySelector('si-browser-view') || doc.querySelector('si-webview-view');
}

export function expand(doc: Document, target: Element): void {
  target.setAttribute(FS_ATTR, '');
  let el = target.parentElement;
  while (el && el !== doc.body && el !== doc.documentElement) {
    el.setAttribute(FS_CHAIN_ATTR, '');
    el = el.parentElement;
  }
  doc.documentElement.setAttribute('data-sc-fs-active', '');
}

export function collapse(doc: Document): void {
  doc.querySelectorAll(`[${FS_ATTR}]`).forEach((e) => e.removeAttribute(FS_ATTR));
  doc.querySelectorAll(`[${FS_CHAIN_ATTR}]`).forEach((e) => e.removeAttribute(FS_CHAIN_ATTR));
  doc.documentElement.removeAttribute('data-sc-fs-active');
}

export function createFullscreenModule(): CompatModule & {
  set(ctx: Context, opts: { fullscreenEditor?: boolean; expandedPreview?: boolean }): void;
  current(): { fullscreenEditor: boolean; expandedPreview: boolean };
} {
  let fullscreenEditor = false;
  let expandedPreview = false;

  function relayout(ctx: Context) {
    const m = getMonaco(ctx.win);
    if (!m) return;
    ctx.win.requestAnimationFrame(() =>
      ctx.guard(NAME, () => m.editor.getEditors().forEach((e) => e.layout())),
    );
  }

  function postState(ctx: Context) {
    ctx.bridge.post({ kind: 'layoutState', fullscreenEditor, expandedPreview, previewAvailable: !!findPreview(ctx.doc) });
  }

  function apply(ctx: Context) {
    collapse(ctx.doc);
    if (fullscreenEditor) {
      const host = findEditorHostForFullscreen(ctx.doc);
      if (host) {
        const bgSource = ctx.doc.querySelector('.monaco-editor .monaco-editor-background') || host;
        ctx.doc.documentElement.style.setProperty('--sc-fs-bg', opaqueBackground(ctx.win, bgSource));
        expand(ctx.doc, host);
      } else {
        fullscreenEditor = false;
        ctx.logger.log('warn', NAME, 'no editor to expand');
      }
    } else if (expandedPreview) {
      const p = findPreview(ctx.doc);
      if (p) {
        ctx.doc.documentElement.style.setProperty('--sc-fs-bg', opaqueBackground(ctx.win, p, '#ffffff'));
        expand(ctx.doc, p);
      }
      else {
        expandedPreview = false;
        ctx.logger.log('warn', NAME, 'no preview to expand');
      }
    }
    relayout(ctx);
    postState(ctx);
  }

  return {
    name: NAME,
    set(ctx, opts) {
      if (typeof opts.fullscreenEditor === 'boolean') {
        fullscreenEditor = opts.fullscreenEditor;
        if (fullscreenEditor) expandedPreview = false;
      }
      if (typeof opts.expandedPreview === 'boolean') {
        expandedPreview = opts.expandedPreview;
        if (expandedPreview) fullscreenEditor = false;
      }
      apply(ctx);
    },
    current: () => ({ fullscreenEditor, expandedPreview }),
    init(ctx) {
      setStyle(ctx.doc, 'fullscreen', CSS);
      ctx.listen(ctx.win, 'resize', () => ctx.guard(NAME, () => {
        if (fullscreenEditor || expandedPreview) relayout(ctx);
      }));
      ctx.on('viewportChanged', () => {
        if (fullscreenEditor) relayout(ctx);
      });
    },
    tick(ctx) {
      // Scrimba may re-render the host (lesson navigation). Re-apply if our marker vanished.
      if ((fullscreenEditor || expandedPreview) && !ctx.doc.querySelector(`[${FS_ATTR}]`)) apply(ctx);
    },
    status(ctx) {
      const editorHost = !!findEditorHostForFullscreen(ctx.doc);
      return statusOf(ctx, NAME, editorHost || !!findPreview(ctx.doc), fullscreenEditor || expandedPreview,
        `editorHost=${editorHost} preview=${!!findPreview(ctx.doc)} fsEditor=${fullscreenEditor} fsPreview=${expandedPreview}`);
    },
  };
}

/**
 * Layout module: publishes the adaptive mode (watching / editing / previewing) as a
 * `data-sc-mode` attribute, reports preview availability, and re-lays out Monaco when
 * the viewport changes (rotation, soft keyboard, split screen).
 */
import { statusOf, type CompatModule, type Context } from '../core';
import { getMonaco } from '../monacoTypes';
import { findPreview } from './fullscreen';

const NAME = 'layout';
export type LayoutMode = 'watching' | 'editing' | 'previewing';

export function computeMode(editing: boolean, expandedPreview: boolean): LayoutMode {
  if (expandedPreview) return 'previewing';
  return editing ? 'editing' : 'watching';
}

export function createLayoutModule(getFs: () => { fullscreenEditor: boolean; expandedPreview: boolean }): CompatModule {
  let mode: LayoutMode = 'watching';
  let lastPreview: boolean | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  function update(ctx: Context) {
    const next = computeMode(ctx.state.editing, getFs().expandedPreview);
    if (next !== mode) {
      mode = next;
      ctx.doc.documentElement.setAttribute('data-sc-mode', mode);
    }
  }

  return {
    name: NAME,
    init(ctx) {
      ctx.doc.documentElement.setAttribute('data-sc-mode', mode);
      ctx.on('editingChanged', () => update(ctx));
      ctx.listen(ctx.win, 'orientationchange', () => ctx.emit('viewportChanged'));
      ctx.on('viewportChanged', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => ctx.guard(NAME, () => {
          const m = getMonaco(ctx.win);
          m?.editor.getEditors().forEach((e) => e.layout());
        }), 120);
      });
    },
    tick(ctx) {
      update(ctx);
      const preview = !!findPreview(ctx.doc);
      if (preview !== lastPreview) {
        lastPreview = preview;
        ctx.bridge.post({ kind: 'layoutState', ...getFs(), previewAvailable: preview });
      }
    },
    status(ctx) {
      return statusOf(ctx, NAME, true, true, `mode=${mode} preview=${!!findPreview(ctx.doc)}`);
    },
  };
}

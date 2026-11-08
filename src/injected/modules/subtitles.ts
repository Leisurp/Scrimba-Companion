/**
 * Subtitles module: restyles Scrimba's *own* caption element. Caption text and timing are
 * never read, copied or regenerated, so there is no synchronisation drift.
 *
 * Evidence: captions render in `<ide-clip-captions>` (absolute, bottom ~80px). Its first
 * child is a clipped background layer; Scrimba scrolls the text body with a pixel
 * `translate`, so we scale with the CSS `scale` property (layout-neutral) instead of
 * changing font-size, which would break Scrimba's line offsets.
 */
import { setStyle, statusOf, type CompatModule, type Context } from '../core';

const NAME = 'subtitles';
const KNOWN_TAGS = ['ide-clip-captions'];

export function findCaptionElement(doc: Document): Element | null {
  for (const tag of KNOWN_TAGS) {
    const el = doc.querySelector(tag);
    if (el) return el;
  }
  // Capability fallback: a custom element whose tag mentions captions/subtitles.
  const all = doc.body ? doc.body.getElementsByTagName('*') : [];
  for (let i = 0; i < all.length && i < 5000; i++) {
    const t = all[i].tagName.toLowerCase();
    if (t.includes('-') && /caption|subtitle/.test(t) && !/toggle|button|modal|settings/.test(t)) return all[i];
  }
  return null;
}

export function buildCaptionCss(tag: string): string {
  const t = tag;
  return [
    `html[data-sc-cap] ${t}{scale:var(--sc-cap-scale,1);transform-origin:50% 100%;transition:opacity .2s,translate .2s;}`,
    `html[data-sc-cap-pos="raised"] ${t}{translate:0 calc(-1 * var(--sc-cap-raise,64px));}`,
    `html[data-sc-cap-pos="top"] ${t}{top:calc(10px + env(safe-area-inset-top,0px)) !important;bottom:auto !important;transform-origin:50% 0;}`,
    `html[data-sc-cap-bg] ${t} > div:first-child{background-color:rgba(0,0,0,var(--sc-cap-bg)) !important;backdrop-filter:none !important;}`,
    `html[data-sc-editing][data-sc-cap-edit="dim"] ${t}{opacity:.35;}`,
    `html[data-sc-editing][data-sc-cap-edit="hide"] ${t}{visibility:hidden;}`,
  ].join('\n');
}

export function applyCaptionConfig(ctx: Context): void {
  const html = ctx.doc.documentElement;
  const c = ctx.config().captions;
  const scale = Math.min(2.5, Math.max(0.6, Number(c.scale) || 1));
  html.setAttribute('data-sc-cap', '');
  html.style.setProperty('--sc-cap-scale', String(scale));
  html.setAttribute('data-sc-cap-pos', c.position);
  html.setAttribute('data-sc-cap-edit', c.whileEditing);
  if (c.backgroundOpacity === null || c.backgroundOpacity === undefined) {
    html.removeAttribute('data-sc-cap-bg');
  } else {
    html.setAttribute('data-sc-cap-bg', '');
    html.style.setProperty('--sc-cap-bg', String(Math.min(1, Math.max(0, c.backgroundOpacity))));
  }
}

export function captionsDiagnostics(doc: Document) {
  const el = findCaptionElement(doc);
  const toggle = doc.querySelector('.caption-toggle');
  return {
    found: !!el,
    tag: el ? el.tagName.toLowerCase() : null,
    enabled: toggle ? toggle.classList.contains('active') : null,
  };
}

export function createSubtitlesModule(): CompatModule {
  let tag: string | null = null;
  return {
    name: NAME,
    init(ctx) {
      applyCaptionConfig(ctx);
    },
    tick(ctx) {
      const el = findCaptionElement(ctx.doc);
      const newTag = el ? el.tagName.toLowerCase() : null;
      if (newTag && newTag !== tag) {
        tag = newTag;
        setStyle(ctx.doc, 'captions', buildCaptionCss(tag));
        ctx.logger.log('info', NAME, `captions found <${tag}>`);
      }
    },
    onConfig(ctx) {
      applyCaptionConfig(ctx);
    },
    status(ctx) {
      const d = captionsDiagnostics(ctx.doc);
      return statusOf(ctx, NAME, d.found, d.found && !!tag, d.found ? `<${d.tag}> enabled=${d.enabled}` : 'no caption element on this page');
    },
  };
}

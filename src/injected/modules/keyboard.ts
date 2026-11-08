/**
 * Keyboard module: makes the soft keyboard appear when the user taps Scrimba's editor.
 *
 * Root cause (verified against scrimba.com, see docs/COMPATIBILITY_FINDINGS.md):
 * on touch devices Scrimba adds `html.touch-interface` and a stylesheet rule that sets
 * `pointer-events: none` on the editor host element (`si-monaco-editor`, or
 * `editor-widget` in a signed-in user's own copy of a scrim). Taps then hit
 * the parent file view instead of Monaco, so Monaco never focuses its hidden textarea
 * and no keyboard is requested. Desktop user agents do not help because the class is
 * keyed on touch capability, not on the user agent.
 *
 * Fix: locate the element *inside the editor host* where `pointer-events: none`
 * originates and mark it so a scoped rule restores `auto`. Monaco's own internal
 * `pointer-events: none` layers are untouched because they are descendants with their
 * own explicit rules. If pointer-events are disabled *outside* the host (e.g. while
 * Scrimba shows its start cover), nothing is changed.
 */
import { setStyle, statusOf, isTouchDevice, type CompatModule, type Context } from '../core';
import { getMonaco, type ICodeEditor } from '../monacoTypes';

const NAME = 'keyboard';
export const PE_FIX_ATTR = 'data-sc-pe-fix';
const TAP_MAX_MOVE = 12;
const TAP_MAX_MS = 650;

type StyleFn = (el: Element) => string;

/**
 * Custom elements that host Scrimba's Monaco editor: `si-monaco-editor` (course scrims
 * viewed signed out) and `editor-widget` (your own copy of a scrim, `/head` URLs, signed in).
 */
export function isEditorHostTag(tagName: string): boolean {
  const t = tagName.toLowerCase();
  return t.includes('-') && /(^|-)editor(-|$)/.test(t);
}

/** Closest ancestor that is the editor's host component (see `isEditorHostTag`). */
export function findEditorHost(monacoEl: Element): Element {
  let el: Element | null = monacoEl.parentElement;
  let depth = 0;
  while (el && depth < 6) {
    if (isEditorHostTag(el.tagName)) return el;
    el = el.parentElement;
    depth++;
  }
  return monacoEl.parentElement || monacoEl;
}

/**
 * Restores pointer events between the editor host and `.monaco-editor`.
 *
 * Walks top-down (host first). `pe` must read the *live* computed value, so after an
 * ancestor is marked its descendants re-inherit `auto`; only descendants with their own
 * `pointer-events: none` rule get marked too. Returns the marked elements.
 */
export function fixPointerEvents(monacoEl: Element, pe: StyleFn, mark: (el: Element) => void): Element[] {
  const host = findEditorHost(monacoEl);
  const chain: Element[] = [];
  let el: Element | null = monacoEl;
  while (el) {
    chain.push(el);
    if (el === host) break;
    el = el.parentElement;
  }
  if (chain[chain.length - 1] !== host) return [];
  // pointer-events disabled outside the host (e.g. Scrimba's start cover): leave it alone.
  const outside = host.parentElement;
  if (outside && pe(outside) === 'none') return [];
  const marked: Element[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    if (pe(node) === 'none') {
      mark(node);
      marked.push(node);
    }
  }
  return marked;
}

export function createKeyboardModule(): CompatModule {
  let touchStart: { x: number; y: number; t: number; editorEl: Element } | null = null;
  let physicalKeyboard = false;
  const hookedInputs = new WeakSet<Element>();
  let fixedCount = 0;
  let lastFixDetail = 'not applied';

  function applyTouchFix(ctx: Context) {
    if (!ctx.config().touchFix || !isTouchDevice(ctx.win)) {
      lastFixDetail = ctx.config().touchFix ? 'not a touch device' : 'disabled';
      return;
    }
    const monacoEls = Array.from(ctx.doc.querySelectorAll('.monaco-editor'));
    const pe: StyleFn = (el) => ctx.win.getComputedStyle(el).pointerEvents;
    const mark = (el: Element) => {
      el.setAttribute(PE_FIX_ATTR, '');
      fixedCount++;
      ctx.state.input.touchFixApplied++;
      ctx.logger.log('info', NAME, `restored pointer-events on <${el.tagName.toLowerCase()}>`);
    };
    for (const m of monacoEls) fixPointerEvents(m, pe, mark);
    // Remember what we fixed for diagnostics (tag names only).
    const marked = Array.from(ctx.doc.querySelectorAll(`[${PE_FIX_ATTR}]`)).map((e) => e.tagName.toLowerCase());
    ctx.state.pointerEventsFix = marked;
    lastFixDetail = marked.length ? `fixed: ${marked.join(',')}` : monacoEls.length ? 'editor not blocked' : 'no editor';
  }

  function editorForElement(ctx: Context, el: Element): ICodeEditor | null {
    const m = getMonaco(ctx.win);
    if (!m) return null;
    try {
      return m.editor.getEditors().find((e) => {
        const dom = e.getDomNode();
        return !!dom && dom.contains(el);
      }) || null;
    } catch {
      return null;
    }
  }

  function hookInputDiagnostics(ctx: Context) {
    const inputs = ctx.doc.querySelectorAll('.monaco-editor textarea, .monaco-editor .native-edit-context');
    inputs.forEach((input) => {
      if (hookedInputs.has(input)) return;
      hookedInputs.add(input);
      const c = ctx.state.input;
      // Counters only: never record key values or text (may contain private code).
      input.addEventListener('keydown', (e) => {
        c.keydown++;
        if ((e as KeyboardEvent).keyCode === 229) c.keydownIme229++;
      }, true);
      input.addEventListener('beforeinput', (e) => {
        const type = (e as InputEvent).inputType || 'unknown';
        c.beforeinput[type] = (c.beforeinput[type] || 0) + 1;
      }, true);
      input.addEventListener('input', () => c.input++, true);
      input.addEventListener('compositionstart', () => c.compositionstart++, true);
      input.addEventListener('compositionend', () => c.compositionend++, true);
    });
  }

  return {
    name: NAME,
    init(ctx) {
      setStyle(ctx.doc, 'pe-fix', `[${PE_FIX_ATTR}]{pointer-events:auto !important;}`);

      // Tap-focus assist. Runs in the bubble phase after Monaco's own gesture handler and
      // synchronously inside `touchend`, so focus() still carries user activation and the
      // platform shows the soft keyboard.
      ctx.listen(ctx.doc, 'touchstart', (e) => ctx.guard(NAME, () => {
        if (e.touches.length !== 1) { touchStart = null; return; }
        const target = e.target as Element | null;
        const editorEl = target?.closest?.('.monaco-editor');
        if (!editorEl || target?.closest('.scrollbar, .minimap, .monaco-scrollable-element > .scrollbar')) { touchStart = null; return; }
        const t = e.touches[0];
        touchStart = { x: t.clientX, y: t.clientY, t: Date.now(), editorEl };
      }), { capture: true, passive: true });

      ctx.listen(ctx.win, 'touchend', (e) => ctx.guard(NAME, () => {
        const start = touchStart;
        touchStart = null;
        if (!start || !ctx.config().tapFocusAssist) return;
        const t = e.changedTouches[0];
        if (!t) return;
        if (Math.abs(t.clientX - start.x) > TAP_MAX_MOVE || Math.abs(t.clientY - start.y) > TAP_MAX_MOVE) return;
        if (Date.now() - start.t > TAP_MAX_MS) return;
        const ed = editorForElement(ctx, start.editorEl);
        if (!ed || ed.hasTextFocus()) return;
        const target = ed.getTargetAtClientPoint(t.clientX, t.clientY);
        if (target?.position) ed.setPosition(target.position);
        ed.focus();
        ctx.state.input.tapAssistFocus++;
        ctx.logger.log('info', NAME, 'tap assist focused editor');
      }), { passive: true });

      // Physical keyboard heuristic: soft keyboards (Gboard etc.) report keyCode 229 for
      // characters; hardware keyboards report real key codes, arrows and modifier chords.
      ctx.listen(ctx.doc, 'keydown', (e) => {
        if (!e.isTrusted || physicalKeyboard) return;
        const hardware =
          (e.key && e.key.length === 1 && e.keyCode !== 229 && !ctx.state.softKeyboardVisible) ||
          ((e.ctrlKey || e.metaKey) && e.key && e.key.length === 1) ||
          (/^Arrow/.test(e.key) && !ctx.state.softKeyboardVisible);
        if (hardware) {
          physicalKeyboard = true;
          ctx.bridge.post({ kind: 'physicalKeyboard', detected: true });
          ctx.logger.log('info', NAME, 'physical keyboard detected');
        }
      }, true);

      // Keep the cursor visible when the soft keyboard resizes the viewport.
      const vv = ctx.win.visualViewport;
      if (vv) ctx.listen(vv, 'resize', () => ctx.guard(NAME, () => {
        ctx.emit('viewportChanged');
        const ed = ctx.services.activeEditor();
        if (!ed || !ed.hasTextFocus()) return;
        setTimeout(() => {
          const pos = ed.getPosition();
          if (pos) ed.revealPositionInCenterIfOutsideViewport(pos);
        }, 60);
      }));
    },
    tick(ctx) {
      applyTouchFix(ctx);
      hookInputDiagnostics(ctx);
    },
    onConfig(ctx) {
      if (!ctx.config().touchFix) {
        ctx.doc.querySelectorAll(`[${PE_FIX_ATTR}]`).forEach((el) => el.removeAttribute(PE_FIX_ATTR));
        ctx.state.pointerEventsFix = [];
      }
      applyTouchFix(ctx);
    },
    status(ctx) {
      return statusOf(ctx, NAME, isTouchDevice(ctx.win), ctx.state.pointerEventsFix.length > 0 || fixedCount > 0, `${lastFixDetail}; physicalKeyboard=${physicalKeyboard}`);
    },
  };
}

export function setSoftKeyboard(ctx: Context, visible: boolean, height: number): void {
  ctx.state.softKeyboardVisible = visible;
  ctx.state.softKeyboardHeight = height;
  ctx.doc.documentElement.style.setProperty('--sc-kb-height', `${Math.max(0, Math.round(height))}px`);
}

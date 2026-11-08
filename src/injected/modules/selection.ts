/**
 * Touch selection module: phone-style text selection for Scrimba's Monaco editor.
 *
 * Monaco's own touch support is thin. Its gesture recogniser turns two taps into a word
 * selection only when no "change" (pan) event fires in between, and it fires one for
 * almost any finger movement, so a double-tap selects the word only some of the time.
 * There are no selection handles and no Cut/Copy/Paste menu.
 *
 * This module adds, on touch devices:
 *  - double-tap and long-press select the word under the finger every time;
 *  - two draggable handles (Android-style) at the ends of the selection that extend or
 *    shrink it, auto-scrolling at the editor's top and bottom edges;
 *  - a floating Cut / Copy / Paste / Select all menu next to the selection. Clipboard
 *    access goes through the native app (`clipboard` / `pasteRequest` messages), because
 *    a WebView has no dependable clipboard API.
 *
 * Everything is an overlay outside Monaco's DOM; selections are set with Monaco's public
 * API (`getTargetAtClientPoint`, `setSelection`, `getScrolledVisiblePosition`), so undo,
 * Scrimba's recording and its editor state are unaffected.
 */
import { isTouchDevice, setStyle, statusOf, type CompatModule, type Context } from '../core';
import { getMonaco, readOption, type ICodeEditor, type IDisposable, type IPosition, type IRange, type ISelection, type ITextModel } from '../monacoTypes';

const NAME = 'selection';
const SOURCE = 'scrimba-companion-selection';
const ROOT_ID = 'sc-touch-selection';

/** Android's ViewConfiguration uses 300 ms; Monaco uses 400 ms. A busy page needs the slack. */
export const DOUBLE_TAP_MS = 400;
/** Max distance between the two taps of a double-tap (CSS px). */
export const DOUBLE_TAP_SLOP = 40;
/** Max finger movement for a tap or long press (CSS px). */
export const TAP_SLOP = 12;
/** Longest touch that still counts as a tap (ms). */
export const TAP_MAX_MS = 450;
export const LONG_PRESS_MS = 450;
/** A selection change this soon after a touch in the editor came from that touch. */
const TOUCH_ATTRIBUTION_MS = 800;
const EDGE_SCROLL_ZONE = 28;

export interface TapPoint {
  x: number;
  y: number;
  t: number;
}

/** `second` is the touchstart of the next tap; `first` is the touchend of the previous one. */
export function isDoubleTap(first: TapPoint | null, second: TapPoint): boolean {
  if (!first) return false;
  const dt = second.t - first.t;
  if (dt < 0 || dt > DOUBLE_TAP_MS) return false;
  return Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_TAP_SLOP;
}

export function comparePositions(a: IPosition, b: IPosition): number {
  return a.lineNumber - b.lineNumber || a.column - b.column;
}

/** Selection that keeps `anchor` fixed and puts the caret (active end) at `active`. */
export function selectionFromAnchor(anchor: IPosition, active: IPosition): ISelection {
  return {
    selectionStartLineNumber: anchor.lineNumber,
    selectionStartColumn: anchor.column,
    positionLineNumber: active.lineNumber,
    positionColumn: active.column,
  };
}

const isWordChar = (ch: string) => /[\p{L}\p{N}_$]/u.test(ch);
const isSymbolChar = (ch: string) => !!ch && !/\s/.test(ch) && !isWordChar(ch);

/**
 * Range to select for a double-tap or long press at `pos`: Monaco's word for the model's
 * language (`my-class` in CSS, `myLeads` in JS), else a run of operator characters such
 * as `=>` or `===` (at most 8), else null (whitespace).
 */
export function wordRangeAt(model: ITextModel, pos: IPosition): IRange | null {
  const line = model.getLineContent(pos.lineNumber);
  if (!line) return null;
  const w = typeof model.getWordAtPosition === 'function' ? model.getWordAtPosition(pos) : null;
  if (w && w.word) return { startLineNumber: pos.lineNumber, startColumn: w.startColumn, endLineNumber: pos.lineNumber, endColumn: w.endColumn };
  // Fallback when the model has no word API: word characters around the caret.
  const idx = pos.column - 1; // caret sits before line[idx]
  let s = idx;
  let e = idx;
  if (isWordChar(line[idx] ?? '') || isWordChar(line[idx - 1] ?? '')) {
    while (s > 0 && isWordChar(line[s - 1])) s--;
    while (e < line.length && isWordChar(line[e])) e++;
    if (e > s) return { startLineNumber: pos.lineNumber, startColumn: s + 1, endLineNumber: pos.lineNumber, endColumn: e + 1 };
  }
  // Operators / punctuation: prefer the character under the finger (after the caret).
  const at = isSymbolChar(line[idx] ?? '') ? idx : isSymbolChar(line[idx - 1] ?? '') ? idx - 1 : -1;
  if (at < 0) return null;
  s = at;
  e = at + 1;
  while (s > 0 && isSymbolChar(line[s - 1]) && e - s < 8) s--;
  while (e < line.length && isSymbolChar(line[e]) && e - s < 8) e++;
  return { startLineNumber: pos.lineNumber, startColumn: s + 1, endLineNumber: pos.lineNumber, endColumn: e + 1 };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where to put the floating menu: centred over the selection, above its first line, or
 * below the end handle when there is no room above. Clamped to the viewport.
 */
export function placeMenu(
  sel: { left: number; right: number; top: number; bottom: number },
  menu: { w: number; h: number },
  viewport: { w: number; h: number },
  gap = 10,
  handleDrop = 30,
): { x: number; y: number } {
  const cx = (sel.left + sel.right) / 2;
  const x = Math.max(8, Math.min(viewport.w - menu.w - 8, cx - menu.w / 2));
  let y = sel.top - menu.h - gap;
  if (y < 8) y = sel.bottom + handleDrop + gap;
  y = Math.max(8, Math.min(viewport.h - menu.h - 8, y));
  return { x, y };
}

type MenuAction = 'cut' | 'copy' | 'paste' | 'selectAll';

const CSS = `
#${ROOT_ID}{position:fixed;inset:0;pointer-events:none;z-index:2147483600;}
#${ROOT_ID} .sc-ts-handle{position:fixed;width:44px;height:44px;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;display:none;}
#${ROOT_ID} .sc-ts-handle.sc-on{display:block;}
#${ROOT_ID} .sc-ts-drop{position:absolute;left:12px;top:4px;width:20px;height:20px;background:#4c8dff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.35);}
#${ROOT_ID} .sc-ts-start .sc-ts-drop{border-top-right-radius:0;}
#${ROOT_ID} .sc-ts-end .sc-ts-drop{border-top-left-radius:0;}
#${ROOT_ID} .sc-ts-menu{position:fixed;display:none;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;background:#2b2d31;border-radius:22px;box-shadow:0 4px 14px rgba(0,0,0,.45);padding:0 4px;white-space:nowrap;font:500 14px/1 system-ui,-apple-system,Roboto,sans-serif;}
#${ROOT_ID} .sc-ts-menu.sc-on{display:flex;}
#${ROOT_ID} .sc-ts-menu button{all:unset;color:#f1f3f4;padding:0 13px;height:44px;line-height:44px;cursor:pointer;}
#${ROOT_ID} .sc-ts-menu button:active{background:rgba(255,255,255,.12);}
`;

interface Drag {
  editor: ICodeEditor;
  anchor: IPosition;
  /** Offset from the finger to the handle's tip (the selection edge, at the line bottom). */
  dx: number;
  dy: number;
  x: number;
  y: number;
  raf: number;
}

interface TouchInfo {
  editor: ICodeEditor;
  x: number;
  y: number;
  t: number;
  moved: boolean;
  double: TapPoint | null;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  longPressed: boolean;
  /** Selection the long press made; re-applied if Monaco collapses it on release. */
  applied: IRange | null;
}

export function createSelectionModule(): CompatModule {
  let current: ICodeEditor | null = null;
  let armed = false;
  let menuMode: 'selection' | 'caret' | null = null;
  let touch: TouchInfo | null = null;
  let lastTap: (TapPoint & { editor: ICodeEditor }) | null = null;
  let lastEditorTouchAt = 0;
  let drag: Drag | null = null;
  let raf = 0;
  let ctxRef: Context | null = null;
  const hooked = new WeakSet<ICodeEditor>();
  const disposables: IDisposable[] = [];
  const stats = { doubleTaps: 0, longPresses: 0, handleDrags: 0, menu: 0 };

  let root: HTMLElement | null = null;
  let startHandle: HTMLElement | null = null;
  let endHandle: HTMLElement | null = null;
  let menu: HTMLElement | null = null;
  let menuKey = '';

  const enabled = (ctx: Context) => ctx.config().touchSelection !== false && isTouchDevice(ctx.win);

  function editors(ctx: Context): ICodeEditor[] {
    const m = getMonaco(ctx.win);
    try {
      return m ? m.editor.getEditors() : [];
    } catch {
      return [];
    }
  }

  function editorForElement(ctx: Context, el: Element): ICodeEditor | null {
    return editors(ctx).find((e) => e.getDomNode()?.contains(el)) || null;
  }

  function readOnly(ctx: Context, ed: ICodeEditor): boolean {
    const m = getMonaco(ctx.win);
    return !!(m && readOption(m, ed, 'readOnly'));
  }

  // --- overlay DOM ------------------------------------------------------------------
  function ensureOverlay(ctx: Context) {
    const doc = ctx.doc;
    if (root && root.isConnected) return;
    if (!doc.body) return;
    root = doc.getElementById(ROOT_ID) || doc.createElement('div');
    root.id = ROOT_ID;
    root.textContent = '';
    startHandle = makeHandle(ctx, 'start');
    endHandle = makeHandle(ctx, 'end');
    menu = doc.createElement('div');
    menu.className = 'sc-ts-menu';
    menu.setAttribute('role', 'menu');
    menuKey = '';
    root.append(startHandle, endHandle, menu);
    doc.body.appendChild(root);
    // Keep focus (and the soft keyboard) in the editor: no compatibility mouse events,
    // no focus change, no page scroll from touches on our controls.
    const block = (e: Event) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };
    ctx.listen(menu, 'touchstart', block, { passive: false });
    ctx.listen(menu, 'mousedown', block);
    // Menu actions reach the app clipboard, so only real user input counts (`isTrusted`):
    // page scripts cannot trigger Copy/Paste with synthetic events.
    ctx.listen(menu, 'touchend', (e: TouchEvent) => ctx.guard(NAME, () => {
      block(e);
      if (!e.isTrusted) return;
      const t = e.changedTouches[0];
      const el = t ? ctx.doc.elementFromPoint(t.clientX, t.clientY) : null;
      const btn = el?.closest?.('button[data-sc-action]');
      if (btn && menu?.contains(btn)) runMenu(ctx, btn.getAttribute('data-sc-action') as MenuAction);
    }), { passive: false });
    ctx.listen(menu, 'click', (e: MouseEvent) => ctx.guard(NAME, () => {
      if (!e.isTrusted) return;
      const btn = (e.target as Element | null)?.closest?.('button[data-sc-action]');
      if (btn) runMenu(ctx, btn.getAttribute('data-sc-action') as MenuAction);
    }));
  }

  function makeHandle(ctx: Context, which: 'start' | 'end'): HTMLElement {
    const h = ctx.doc.createElement('div');
    h.className = `sc-ts-handle sc-ts-${which}`;
    h.setAttribute('aria-hidden', 'true');
    const drop = ctx.doc.createElement('div');
    drop.className = 'sc-ts-drop';
    h.appendChild(drop);
    ctx.listen(h, 'touchstart', (e: TouchEvent) => ctx.guard(NAME, () => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) startDrag(which, e.touches[0]);
    }), { passive: false });
    // Touch events keep going to the element the touch started on, even when the finger
    // leaves it, so the drag is tracked here (non-passive only on this small element).
    ctx.listen(h, 'touchmove', (e: TouchEvent) => ctx.guard(NAME, () => {
      if (!drag) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const t = e.touches[0];
      if (t) dragTo(ctx, t.clientX, t.clientY);
    }), { passive: false });
    const finish = (e: TouchEvent) => ctx.guard(NAME, () => {
      e.stopPropagation();
      endDrag();
    });
    ctx.listen(h, 'touchend', finish);
    ctx.listen(h, 'touchcancel', finish);
    ctx.listen(h, 'mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    });
    return h;
  }

  function setMenu(ctx: Context, actions: MenuAction[]) {
    if (!menu) return;
    const key = actions.join(',');
    if (key === menuKey) return;
    menuKey = key;
    menu.textContent = '';
    const labels: Record<MenuAction, string> = { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all' };
    for (const a of actions) {
      const b = ctx.doc.createElement('button');
      b.type = 'button';
      b.setAttribute('data-sc-action', a);
      b.setAttribute('role', 'menuitem');
      b.textContent = labels[a];
      menu.appendChild(b);
    }
  }

  function hideAll() {
    startHandle?.classList.remove('sc-on');
    endHandle?.classList.remove('sc-on');
    menu?.classList.remove('sc-on');
  }

  // --- geometry ---------------------------------------------------------------------
  function caretBox(ed: ICodeEditor, pos: IPosition): { x: number; top: number; bottom: number; visible: boolean } | null {
    const dom = ed.getDomNode();
    const v = ed.getScrolledVisiblePosition?.(pos);
    if (!dom || !v) return null;
    const r = dom.getBoundingClientRect();
    const contentLeft = r.left + (ed.getLayoutInfo?.().contentLeft ?? 0);
    const x = r.left + v.left;
    const top = r.top + v.top;
    const bottom = top + v.height;
    const visible = bottom > r.top + 1 && top < r.bottom - 1 && x >= contentLeft - 2 && x <= r.right + 2;
    return { x, top, bottom, visible };
  }

  function schedule() {
    const ctx = ctxRef;
    if (!ctx || raf) return;
    const w = ctx.win as unknown as { requestAnimationFrame?: (cb: () => void) => number };
    if (typeof w.requestAnimationFrame === 'function') {
      raf = w.requestAnimationFrame(() => {
        raf = 0;
        ctx.guard(NAME, () => render(ctx));
      });
    } else {
      ctx.guard(NAME, () => render(ctx));
    }
  }

  function render(ctx: Context) {
    const ed = current;
    if (!enabled(ctx) || !ed) return hideAll();
    const sel = ed.getSelection();
    const sels = ed.getSelections() || [];
    const focused = ed.hasTextFocus() || !!drag;
    if (!sel || !focused || ctx.state.playback === 'playing' || sels.length > 1) {
      if (!drag) {
        armed = false;
        menuMode = null;
      }
      return hideAll();
    }
    ensureOverlay(ctx);
    if (!startHandle || !endHandle || !menu) return;

    if (sel.isEmpty()) {
      startHandle.classList.remove('sc-on');
      endHandle.classList.remove('sc-on');
      if (menuMode !== 'caret' || touch) return void menu.classList.remove('sc-on');
      const c = caretBox(ed, { lineNumber: sel.startLineNumber, column: sel.startColumn });
      if (!c || !c.visible) return void menu.classList.remove('sc-on');
      setMenu(ctx, readOnly(ctx, ed) ? ['selectAll'] : ['paste', 'selectAll']);
      showMenu(ctx, { left: c.x, right: c.x, top: c.top, bottom: c.bottom }, 0);
      return;
    }
    if (!armed) return hideAll();

    const s = caretBox(ed, { lineNumber: sel.startLineNumber, column: sel.startColumn });
    const e = caretBox(ed, { lineNumber: sel.endLineNumber, column: sel.endColumn });
    place(startHandle, s, 32);
    place(endHandle, e, 12);

    if (drag || touch || !(s?.visible || e?.visible)) return void menu.classList.remove('sc-on');
    setMenu(ctx, readOnly(ctx, ed) ? ['copy', 'selectAll'] : ['cut', 'copy', 'paste', 'selectAll']);
    const boxes = [s, e].filter((b): b is NonNullable<typeof b> => !!b && b.visible);
    const dom = ed.getDomNode();
    const r = dom ? dom.getBoundingClientRect() : null;
    const multiLine = sel.startLineNumber !== sel.endLineNumber;
    showMenu(
      ctx,
      {
        left: multiLine && r ? r.left + (ed.getLayoutInfo?.().contentLeft ?? 0) : Math.min(...boxes.map((b) => b.x)),
        right: multiLine && r ? r.right : Math.max(...boxes.map((b) => b.x)),
        top: Math.min(...boxes.map((b) => b.top)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
      },
      30,
    );
  }

  function place(h: HTMLElement, c: ReturnType<typeof caretBox>, tipX: number) {
    if (!c || !c.visible) return void h.classList.remove('sc-on');
    h.style.left = `${Math.round(c.x - tipX)}px`;
    h.style.top = `${Math.round(c.bottom - 4)}px`;
    h.classList.add('sc-on');
  }

  function showMenu(ctx: Context, sel: { left: number; right: number; top: number; bottom: number }, handleDrop: number) {
    if (!menu) return;
    menu.classList.add('sc-on');
    const w = menu.offsetWidth || 260;
    const h = menu.offsetHeight || 44;
    const vv = ctx.win.visualViewport;
    const vw = ctx.win.innerWidth || 360;
    const vh = vv ? vv.height : ctx.win.innerHeight || 640;
    const p = placeMenu(sel, { w, h }, { w: vw, h: vh }, 10, handleDrop);
    menu.style.left = `${Math.round(p.x)}px`;
    menu.style.top = `${Math.round(p.y)}px`;
  }

  // --- selection helpers ------------------------------------------------------------
  function selectRange(ctx: Context, ed: ICodeEditor, range: IRange) {
    current = ed;
    armed = true;
    menuMode = 'selection';
    ed.setSelection({
      selectionStartLineNumber: range.startLineNumber,
      selectionStartColumn: range.startColumn,
      positionLineNumber: range.endLineNumber,
      positionColumn: range.endColumn,
    });
    if (!ed.hasTextFocus()) ed.focus();
    schedule();
    ctx.logger.log('info', NAME, 'word selected');
  }

  function wordAtPoint(ed: ICodeEditor, x: number, y: number): { pos: IPosition; range: IRange | null } | null {
    const pos = hitTest(ed, x, y);
    const model = ed.getModel();
    if (!pos || !model) return null;
    return { pos, range: wordRangeAt(model, pos) };
  }

  /**
   * Monaco hit-tests with the DOM (`elementFromPoint`), so our handles must not be in the
   * way: while dragging, the handle sits right over the point being looked up. Making the
   * overlay transparent to hit-testing does not affect the ongoing touch, whose target is
   * fixed at touchstart.
   */
  function hitTest(ed: ICodeEditor, x: number, y: number): IPosition | null {
    const r = root;
    const prev = r ? r.style.display : '';
    if (r) r.style.display = 'none';
    try {
      return ed.getTargetAtClientPoint(x, y)?.position ?? null;
    } finally {
      if (r) r.style.display = prev;
    }
  }

  function sameRange(a: IRange | null, b: IRange | null): boolean {
    return !!a && !!b && a.startLineNumber === b.startLineNumber && a.startColumn === b.startColumn && a.endLineNumber === b.endLineNumber && a.endColumn === b.endColumn;
  }

  // --- handle dragging ----------------------------------------------------------------
  function startDrag(which: 'start' | 'end', t: Touch | undefined) {
    const ed = current;
    const sel = ed?.getSelection();
    if (!ed || !sel || !t) return;
    const start = { lineNumber: sel.startLineNumber, column: sel.startColumn };
    const end = { lineNumber: sel.endLineNumber, column: sel.endColumn };
    const moving = which === 'start' ? start : end;
    const tip = caretBox(ed, moving);
    if (!tip) return;
    drag = { editor: ed, anchor: which === 'start' ? end : start, dx: tip.x - t.clientX, dy: tip.bottom - t.clientY, x: t.clientX, y: t.clientY, raf: 0 };
    stats.handleDrags++;
    menu?.classList.remove('sc-on');
  }

  function dragTo(ctx: Context, x: number, y: number) {
    const d = drag;
    if (!d) return;
    d.x = x;
    d.y = y;
    const ed = d.editor;
    const dom = ed.getDomNode();
    if (!dom) return;
    const r = dom.getBoundingClientRect();
    const lh = (caretBox(ed, d.anchor)?.bottom ?? 0) - (caretBox(ed, d.anchor)?.top ?? 0) || 18;
    const contentLeft = r.left + (ed.getLayoutInfo?.().contentLeft ?? 0);
    const px = Math.max(contentLeft + 1, Math.min(r.right - 2, x + d.dx));
    let py = y + d.dy - lh / 2;
    // Auto-scroll while the finger is at the editor's top or bottom edge.
    let scroll = 0;
    if (py < r.top + EDGE_SCROLL_ZONE / 2) scroll = -Math.min(24, Math.max(4, r.top + EDGE_SCROLL_ZONE / 2 - py));
    else if (py > r.bottom - EDGE_SCROLL_ZONE / 2) scroll = Math.min(24, Math.max(4, py - (r.bottom - EDGE_SCROLL_ZONE / 2)));
    py = Math.max(r.top + 2, Math.min(r.bottom - 2, py));
    const pos = hitTest(ed, px, py);
    if (pos && comparePositions(pos, d.anchor) !== 0) ed.setSelection(selectionFromAnchor(d.anchor, pos));
    schedule();
    if (scroll && typeof ed.getScrollTop === 'function' && typeof ed.setScrollTop === 'function' && !d.raf) {
      const w = ctx.win as unknown as { requestAnimationFrame?: (cb: () => void) => number };
      if (typeof w.requestAnimationFrame === 'function') {
        d.raf = w.requestAnimationFrame(() => {
          d.raf = 0;
          if (drag !== d) return;
          ed.setScrollTop!(ed.getScrollTop!() + scroll);
          ctx.guard(NAME, () => dragTo(ctx, d.x, d.y));
        });
      }
    }
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    schedule();
  }

  // --- menu actions -----------------------------------------------------------------
  function runMenu(ctx: Context, action: MenuAction) {
    const ed = current;
    const model = ed?.getModel();
    const sel = ed?.getSelection();
    if (!ed || !model || !sel) return;
    stats.menu++;
    switch (action) {
      case 'copy':
      case 'cut': {
        if (sel.isEmpty()) return;
        const text = model.getValueInRange(sel);
        ctx.bridge.post({ kind: 'clipboard', text });
        if (action === 'cut' && !readOnly(ctx, ed)) {
          ed.pushUndoStop();
          ed.executeEdits(SOURCE, [{ range: sel, text: '' }]);
          ed.pushUndoStop();
        } else {
          ed.setPosition({ lineNumber: sel.endLineNumber, column: sel.endColumn });
        }
        armed = false;
        menuMode = null;
        break;
      }
      case 'paste':
        // Native reads the clipboard and sends an editor `paste` command, which replaces the selection.
        ctx.bridge.post({ kind: 'pasteRequest' });
        armed = false;
        menuMode = null;
        break;
      case 'selectAll':
        selectRange(ctx, ed, model.getFullModelRange());
        break;
    }
    if (!ed.hasTextFocus()) ed.focus();
    schedule();
  }

  // --- editor hooks -----------------------------------------------------------------
  function hookEditors(ctx: Context) {
    for (const ed of editors(ctx)) {
      if (hooked.has(ed)) continue;
      hooked.add(ed);
      const subs: (IDisposable | undefined)[] = [
        ed.onDidChangeCursorSelection(() => ctx.guard(NAME, () => onSelectionChanged(ed))),
        ed.onDidScrollChange?.(() => schedule()),
        ed.onDidLayoutChange?.(() => schedule()),
        ed.onDidBlurEditorText(() => schedule()),
        ed.onDidFocusEditorText(() => schedule()),
      ];
      ed.onDidDispose(() => {
        subs.forEach((s) => s?.dispose());
        if (current === ed) {
          current = null;
          armed = false;
          schedule();
        }
      });
      subs.forEach((s) => s && disposables.push(s));
    }
  }

  function onSelectionChanged(ed: ICodeEditor) {
    const sel = ed.getSelection();
    if (!sel) return;
    if (sel.isEmpty()) {
      if (current === ed && !drag) {
        armed = false;
        if (menuMode === 'selection') menuMode = null;
      }
    } else if (drag?.editor === ed || Date.now() - Math.max(lastEditorTouchAt, ctxRef?.state.selectionArmedAt ?? 0) < TOUCH_ATTRIBUTION_MS) {
      // A selection the user made by touch: ours, Monaco's own word selection, or the
      // app toolbar's Select all / select-move buttons (they set `selectionArmedAt`).
      current = ed;
      armed = true;
      menuMode = 'selection';
    }
    schedule();
  }

  // --- editor touches -----------------------------------------------------------------
  function onTouchStart(ctx: Context, e: TouchEvent) {
    if (!enabled(ctx)) return;
    if (e.touches.length !== 1) {
      clearTouch();
      return;
    }
    const target = e.target as Element | null;
    if (!target?.closest || target.closest(`#${ROOT_ID}`)) return;
    const editorEl = target.closest('.monaco-editor');
    if (!editorEl || target.closest('.scrollbar, .minimap, .margin')) {
      clearTouch();
      return;
    }
    const ed = editorForElement(ctx, editorEl);
    if (!ed) return;
    const t = e.touches[0];
    const now = Date.now();
    lastEditorTouchAt = now;
    const point = { x: t.clientX, y: t.clientY, t: now };
    const double = lastTap && lastTap.editor === ed && isDoubleTap(lastTap, point) ? { x: lastTap.x, y: lastTap.y, t: lastTap.t } : null;
    clearTouch();
    touch = { editor: ed, x: t.clientX, y: t.clientY, t: now, moved: false, double, longPressTimer: null, longPressed: false, applied: null };
    if (menuMode === 'caret') menuMode = null;
    menu?.classList.remove('sc-on');
    if (!double) {
      const info = touch;
      info.longPressTimer = setTimeout(() => ctx.guard(NAME, () => onLongPress(ctx, info)), LONG_PRESS_MS);
    }
  }

  function onLongPress(ctx: Context, info: TouchInfo) {
    info.longPressTimer = null;
    if (touch !== info || info.moved) return;
    info.longPressed = true;
    stats.longPresses++;
    const hit = wordAtPoint(info.editor, info.x, info.y);
    if (!hit) return;
    if (hit.range) {
      info.applied = hit.range;
      selectRange(ctx, info.editor, hit.range);
    } else {
      current = info.editor;
      info.editor.setPosition(hit.pos);
      if (!info.editor.hasTextFocus()) info.editor.focus();
      menuMode = 'caret';
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (!touch) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - touch.x) > TAP_SLOP || Math.abs(t.clientY - touch.y) > TAP_SLOP) {
      touch.moved = true;
      if (touch.longPressTimer) clearTimeout(touch.longPressTimer);
      touch.longPressTimer = null;
    }
  }

  /**
   * Window capture phase (Monaco stops touchend's propagation in the bubble phase). The
   * selection is applied one task later, after Monaco has set its own, so ours wins.
   */
  function onTouchEnd(ctx: Context, t: { clientX: number; clientY: number } | null, now: number) {
    // Bookkeeping happens synchronously, so the next touchstart always sees this tap even
    // when the main thread is busy; only the selection itself waits for Monaco (see init).
    const info = touch;
    if (!info) return;
    if (info.longPressTimer) clearTimeout(info.longPressTimer);
    touch = null;
    lastEditorTouchAt = now;
    const later = (fn: () => void) => setTimeout(() => ctx.guard(NAME, fn), 0);
    if (info.longPressed) {
      lastTap = null;
      // Monaco treats the release as a tap and collapses the selection: restore ours.
      const applied = info.applied;
      later(() => {
        if (applied) reapply(ctx, info.editor, applied);
        schedule();
      });
      return;
    }
    const isTap = !info.moved && now - info.t <= TAP_MAX_MS && !!t;
    if (!isTap || !t) {
      lastTap = null;
      later(schedule);
      return;
    }
    if (info.double) {
      lastTap = null;
      stats.doubleTaps++;
      // Use the first tap's point: it is where the user aimed; the second tap drifts.
      const aim = info.double;
      later(() => {
        const hit = wordAtPoint(info.editor, aim.x, aim.y);
        if (hit?.range) reapply(ctx, info.editor, hit.range);
        schedule();
      });
      return;
    }
    lastTap = { x: t.clientX, y: t.clientY, t: now, editor: info.editor };
    later(schedule);
  }

  /** Select now, and again on the next frame if something (Monaco, Scrimba) moved it. */
  function reapply(ctx: Context, ed: ICodeEditor, range: IRange) {
    selectRange(ctx, ed, range);
    const w = ctx.win as unknown as { requestAnimationFrame?: (cb: () => void) => number };
    const check = () => ctx.guard(NAME, () => {
      const s = ed.getSelection();
      if (s && !sameRange(s, range) && current === ed && !drag && !touch) selectRange(ctx, ed, range);
    });
    if (typeof w.requestAnimationFrame === 'function') w.requestAnimationFrame(check);
    else setTimeout(check, 0);
  }

  function clearTouch() {
    if (touch?.longPressTimer) clearTimeout(touch.longPressTimer);
    touch = null;
  }

  return {
    name: NAME,
    init(ctx) {
      ctxRef = ctx;
      setStyle(ctx.doc, 'touch-selection', CSS);
      ctx.listen(ctx.doc, 'touchstart', (e: TouchEvent) => ctx.guard(NAME, () => onTouchStart(ctx, e)), { capture: true, passive: true });
      ctx.listen(ctx.win, 'touchmove', (e: TouchEvent) => ctx.guard(NAME, () => onTouchMove(e)), { capture: true, passive: true });
      // Capture phase: Monaco stops propagation of touchend in the bubble phase.
      ctx.listen(ctx.win, 'touchend', (e: TouchEvent) => ctx.guard(NAME, () => {
        const c = e.changedTouches[0];
        onTouchEnd(ctx, c ? { clientX: c.clientX, clientY: c.clientY } : null, Date.now());
      }), { capture: true, passive: true });
      ctx.listen(ctx.win, 'touchcancel', () => ctx.guard(NAME, () => {
        endDrag();
        clearTouch();
        schedule();
      }), { passive: true });
      ctx.listen(ctx.win, 'resize', () => schedule());
      ctx.on('viewportChanged', schedule);
      ctx.on('playbackChanged', schedule);
      ctx.on('configChanged', schedule);
      ctx.onDispose(() => {
        disposables.splice(0).forEach((d) => d.dispose());
        clearTouch();
        root?.remove();
        root = null;
      });
    },
    tick(ctx) {
      if (!enabled(ctx)) return hideAll();
      hookEditors(ctx);
      schedule();
    },
    onConfig() {
      schedule();
    },
    status(ctx) {
      return statusOf(
        ctx,
        NAME,
        isTouchDevice(ctx.win),
        enabled(ctx),
        `doubleTaps=${stats.doubleTaps} longPresses=${stats.longPresses} handleDrags=${stats.handleDrags} menu=${stats.menu} handles=${!!startHandle?.classList.contains('sc-on') || !!endHandle?.classList.contains('sc-on')}`,
      );
    },
  };
}

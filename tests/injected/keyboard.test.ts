/**
 * @jest-environment jsdom
 */
import { fixPointerEvents, findEditorHost, isEditorHostTag, PE_FIX_ATTR } from '../../src/injected/modules/keyboard';
import { startRuntime, type Runtime } from '../../src/injected/runtime';
import { resetStylesForTests } from '../../src/injected/core';
import { createFakeEditor, installFakeMonaco } from '../helpers/fakeMonaco';

/** Simulated computed pointer-events: explicit rules + inheritance + our fix attribute. */
function simulatedPe(rules: Map<Element, string>) {
  const pe = (el: Element): string => {
    if (el.hasAttribute(PE_FIX_ATTR)) return 'auto';
    const own = rules.get(el);
    if (own) return own;
    return el.parentElement ? pe(el.parentElement) : 'auto';
  };
  return pe;
}

function scrimbaLikeDom() {
  document.body.innerHTML = `
    <scrim-view><si-file-view><si-monaco-editor class="wc-ag"><div class="wc-ah">
      <div class="monaco-editor"><div class="view-lines"></div><textarea class="inputarea"></textarea></div>
    </div></si-monaco-editor></si-file-view></scrim-view>`;
  return {
    scrimView: document.querySelector('scrim-view')!,
    fileView: document.querySelector('si-file-view')!,
    host: document.querySelector('si-monaco-editor')!,
    monaco: document.querySelector('.monaco-editor')!,
  };
}

describe('pointer-events fix (root cause of the missing Android keyboard)', () => {
  test('finds the custom-element host ending in "-editor"', () => {
    const d = scrimbaLikeDom();
    expect(findEditorHost(d.monaco)).toBe(d.host);
  });

  test('marks only the element where pointer-events:none originates (Scrimba touch rule)', () => {
    const d = scrimbaLikeDom();
    const rules = new Map<Element, string>([[d.host, 'none'], [d.fileView, 'auto']]);
    const pe = simulatedPe(rules);
    const marked = fixPointerEvents(d.monaco, pe, (el) => el.setAttribute(PE_FIX_ATTR, ''));
    expect(marked).toEqual([d.host]);
    expect(pe(d.monaco)).toBe('auto');
    expect(pe(d.monaco.querySelector('textarea')!)).toBe('auto');
  });

  test('also marks a nested element that has its own none rule', () => {
    const d = scrimbaLikeDom();
    const inner = d.monaco.parentElement!;
    const rules = new Map<Element, string>([[d.host, 'none'], [inner, 'none'], [d.fileView, 'auto']]);
    const marked = fixPointerEvents(d.monaco, simulatedPe(rules), (el) => el.setAttribute(PE_FIX_ATTR, ''));
    expect(marked).toEqual([d.host, inner]);
  });

  test('does nothing when pointer events are disabled outside the editor host (e.g. a cover)', () => {
    const d = scrimbaLikeDom();
    const rules = new Map<Element, string>([[d.scrimView, 'none']]);
    const marked = fixPointerEvents(d.monaco, simulatedPe(rules), (el) => el.setAttribute(PE_FIX_ATTR, ''));
    expect(marked).toEqual([]);
  });

  test('signed-in layout: `editor-widget` host (own copy of a scrim, /head URL)', () => {
    // Structure seen on a OnePlus 12 (WebView 156) when signed in: scrim-view has its own
    // none rule, <main> restores auto, and the touch-only rule disables editor-widget.
    document.body.innerHTML = `
      <scrim-view><main class="$center"><editor-widget class="cdj-ah"><div class="cdj-ai $container">
        <div class="monaco-editor"><textarea class="inputarea"></textarea></div>
      </div></editor-widget></main></scrim-view>`;
    const host = document.querySelector('editor-widget')!;
    const main = document.querySelector('main')!;
    const monacoEl = document.querySelector('.monaco-editor')!;
    expect(findEditorHost(monacoEl)).toBe(host);
    const rules = new Map<Element, string>([
      [document.querySelector('scrim-view')!, 'none'],
      [main, 'auto'],
      [host, 'none'],
    ]);
    const pe = simulatedPe(rules);
    const marked = fixPointerEvents(monacoEl, pe, (el) => el.setAttribute(PE_FIX_ATTR, ''));
    expect(marked).toEqual([host]);
    expect(pe(monacoEl.querySelector('textarea')!)).toBe('auto');
  });

  test('editor host tag names', () => {
    expect(isEditorHostTag('SI-MONACO-EDITOR')).toBe(true);
    expect(isEditorHostTag('editor-widget')).toBe(true);
    expect(isEditorHostTag('si-file-view')).toBe(false);
    expect(isEditorHostTag('scrim-view')).toBe(false);
    expect(isEditorHostTag('DIV')).toBe(false);
    expect(isEditorHostTag('texteditor-x')).toBe(false);
  });

  test('does nothing on an unblocked editor (desktop)', () => {
    const d = scrimbaLikeDom();
    const marked = fixPointerEvents(d.monaco, simulatedPe(new Map()), (el) => el.setAttribute(PE_FIX_ATTR, ''));
    expect(marked).toEqual([]);
  });
});

describe('tap focus assist', () => {
  let rt: Runtime;
  afterEach(() => {
    rt?.stop();
    resetStylesForTests();
    document.body.innerHTML = '';
  });

  function touch(type: string, target: Element, x: number, y: number) {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[]; changedTouches: unknown[] };
    const t = { clientX: x, clientY: y, target };
    Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
    Object.defineProperty(ev, 'changedTouches', { value: [t] });
    target.dispatchEvent(ev);
  }

  test('focuses Monaco and positions the cursor on a tap that Monaco ignored', () => {
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    const ed = createFakeEditor(document);
    installFakeMonaco(window, [ed]);
    rt = startRuntime(window, { tickMs: 0 });
    const lines = ed.getDomNode()!.querySelector('.view-lines')!;
    touch('touchstart', lines, 50, 40);
    touch('touchend', lines, 52, 41);
    expect(ed.focused).toBe(true);
    expect(ed.getPosition()).toEqual({ lineNumber: 2, column: 3 });
    expect(rt.ctx.state.input.tapAssistFocus).toBe(1);
  });

  test('ignores drags (scrolling) and long presses', () => {
    const ed = createFakeEditor(document);
    installFakeMonaco(window, [ed]);
    rt = startRuntime(window, { tickMs: 0 });
    const lines = ed.getDomNode()!.querySelector('.view-lines')!;
    touch('touchstart', lines, 50, 40);
    touch('touchend', lines, 50, 120);
    expect(ed.focused).toBe(false);
  });

  test('can be disabled by config', () => {
    const ed = createFakeEditor(document);
    installFakeMonaco(window, [ed]);
    rt = startRuntime(window, { tickMs: 0 });
    rt.receive({ kind: 'config', config: { ...rt.config(), tapFocusAssist: false } });
    const lines = ed.getDomNode()!.querySelector('.view-lines')!;
    touch('touchstart', lines, 50, 40);
    touch('touchend', lines, 50, 40);
    expect(ed.focused).toBe(false);
  });
});

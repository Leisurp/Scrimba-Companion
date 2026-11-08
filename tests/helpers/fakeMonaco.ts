/**
 * Minimal fake of the public Monaco editor API used by the runtime. It records calls and
 * keeps a simple text model so command mapping can be unit-tested in jsdom.
 * Real Monaco behaviour is covered by the Playwright suite (e2e/), which loads the actual
 * monaco-editor package.
 */
import type { ICodeEditor, IRange, ISelection, MonacoGlobal, Selection } from '../../src/injected/monacoTypes';

type Listener = (...args: unknown[]) => void;

export interface FakeEditor extends ICodeEditor {
  triggers: { source: string; handler: string; payload: unknown }[];
  edits: { source: string; edits: { range: IRange; text: string | null }[] }[];
  options: Record<string, unknown>;
  fire(event: 'focus' | 'blur' | 'content' | 'cursor'): void;
  lines: string[];
  sel: { sl: number; sc: number; el: number; ec: number };
  focused: boolean;
}

function mkSelection(sl: number, sc: number, el: number, ec: number): Selection {
  return {
    startLineNumber: sl,
    startColumn: sc,
    endLineNumber: el,
    endColumn: ec,
    isEmpty: () => sl === el && sc === ec,
    getPosition: () => ({ lineNumber: el, column: ec }),
  };
}

export function createFakeEditor(doc: Document, text = 'const a = 1;\nfunction f() {\n  return a;\n}', id = 'vs.editor.ICodeEditor:1'): FakeEditor {
  const host = doc.createElement('si-monaco-editor');
  const container = doc.createElement('div');
  const dom = doc.createElement('div');
  dom.className = 'monaco-editor';
  const lines = doc.createElement('div');
  lines.className = 'view-lines';
  const textarea = doc.createElement('textarea');
  textarea.className = 'inputarea';
  dom.appendChild(lines);
  dom.appendChild(textarea);
  container.appendChild(dom);
  host.appendChild(container);
  doc.body.appendChild(host);

  const listeners: Record<string, Listener[]> = { focus: [], blur: [], content: [], cursor: [], dispose: [] };
  const on = (k: string) => (fn: Listener) => {
    listeners[k].push(fn);
    return { dispose: () => (listeners[k] = listeners[k].filter((x) => x !== fn)) };
  };
  let version = 1;

  const ed: FakeEditor = {
    triggers: [],
    edits: [],
    options: {},
    lines: text.split('\n'),
    sel: { sl: 1, sc: 1, el: 1, ec: 1 },
    focused: false,
    fire(event) {
      listeners[event].forEach((fn) => fn({}));
    },
    getId: () => id,
    getModel() {
      return {
        uri: { toString: () => 'file:///sp0/index.js' },
        getValue: () => ed.lines.join('\n'),
        getLineCount: () => ed.lines.length,
        getLineContent: (n: number) => ed.lines[n - 1] ?? '',
        getLineMaxColumn: (n: number) => (ed.lines[n - 1] ?? '').length + 1,
        getValueInRange: (r: IRange) => {
          if (r.startLineNumber === r.endLineNumber) return ed.lines[r.startLineNumber - 1].slice(r.startColumn - 1, r.endColumn - 1);
          const out = [ed.lines[r.startLineNumber - 1].slice(r.startColumn - 1)];
          for (let i = r.startLineNumber + 1; i < r.endLineNumber; i++) out.push(ed.lines[i - 1]);
          out.push(ed.lines[r.endLineNumber - 1].slice(0, r.endColumn - 1));
          return out.join('\n');
        },
        getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: ed.lines.length, endColumn: ed.lines[ed.lines.length - 1].length + 1 }),
        getEOL: () => '\n',
        getLanguageId: () => 'javascript',
        getAlternativeVersionId: () => version,
      };
    },
    getDomNode: () => dom,
    hasTextFocus: () => ed.focused,
    focus() {
      if (!ed.focused) {
        ed.focused = true;
        listeners.focus.forEach((fn) => fn());
      }
    },
    layout: jest.fn(),
    trigger(source, handler, payload) {
      ed.triggers.push({ source, handler, payload });
    },
    executeEdits(source, edits, endCursor) {
      ed.edits.push({ source, edits: edits.map((e) => ({ range: e.range, text: e.text })) });
      // Apply single-line edits to the model (enough for tests).
      for (const e of edits) {
        const r = e.range;
        if (r.startLineNumber === r.endLineNumber) {
          const l = ed.lines[r.startLineNumber - 1];
          ed.lines[r.startLineNumber - 1] = l.slice(0, r.startColumn - 1) + (e.text ?? '') + l.slice(r.endColumn - 1);
        } else {
          const first = ed.lines[r.startLineNumber - 1].slice(0, r.startColumn - 1);
          const last = ed.lines[r.endLineNumber - 1].slice(r.endColumn - 1);
          ed.lines.splice(r.startLineNumber - 1, r.endLineNumber - r.startLineNumber + 1, ...(first + (e.text ?? '') + last).split('\n'));
        }
      }
      version++;
      if (endCursor && endCursor.length) {
        const c = endCursor[0] as ISelection;
        ed.sel = { sl: c.positionLineNumber, sc: c.positionColumn, el: c.positionLineNumber, ec: c.positionColumn };
      }
      listeners.content.forEach((fn) => fn({}));
      return true;
    },
    pushUndoStop: () => true,
    getPosition: () => ({ lineNumber: ed.sel.el, column: ed.sel.ec }),
    setPosition(p) {
      ed.sel = { sl: p.lineNumber, sc: p.column, el: p.lineNumber, ec: p.column };
      listeners.cursor.forEach((fn) => fn({}));
    },
    getSelection: () => mkSelection(ed.sel.sl, ed.sel.sc, ed.sel.el, ed.sel.ec),
    getSelections: () => [mkSelection(ed.sel.sl, ed.sel.sc, ed.sel.el, ed.sel.ec)],
    setSelection(s) {
      const r = s as IRange;
      ed.sel = { sl: r.startLineNumber, sc: r.startColumn, el: r.endLineNumber, ec: r.endColumn };
      listeners.cursor.forEach((fn) => fn({}));
    },
    setSelections: jest.fn(),
    revealPositionInCenterIfOutsideViewport: jest.fn(),
    getTargetAtClientPoint: () => ({ position: { lineNumber: 2, column: 3 } }),
    getAction: (actionId: string) => (actionId === 'editor.action.commentLine' ? { run: jest.fn() } : null),
    getOption: (optId: number) => ed.options[String(optId)],
    updateOptions(o) {
      Object.assign(ed.options, o);
    },
    onDidFocusEditorText: on('focus'),
    onDidBlurEditorText: on('blur'),
    onDidChangeModelContent: on('content'),
    onDidChangeCursorSelection: on('cursor'),
    onDidDispose: on('dispose'),
  };
  return ed;
}

export function installFakeMonaco(win: Window, editors: ICodeEditor[]): MonacoGlobal {
  const m: MonacoGlobal = { editor: { getEditors: () => editors, EditorOption: { readOnly: 0, domReadOnly: 1, editContext: 2 } } };
  (win as unknown as { monaco: MonacoGlobal }).monaco = m;
  return m;
}

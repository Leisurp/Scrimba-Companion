/**
 * @jest-environment jsdom
 */
import { startRuntime, type Runtime } from '../../src/injected/runtime';
import { resetStylesForTests } from '../../src/injected/core';
import { findRunButton } from '../../src/injected/modules/editor';
import type { EditorCommand, PageToNative } from '../../src/shared/protocol';
import { createFakeEditor, installFakeMonaco, type FakeEditor } from '../helpers/fakeMonaco';

const outbox = () => ((window as unknown as { __SC_OUTBOX__?: PageToNative[] }).__SC_OUTBOX__ ||= []);
const results = () => outbox().filter((m): m is Extract<PageToNative, { kind: 'commandResult' }> => m.kind === 'commandResult');

describe('editor module (fake Monaco: command mapping only)', () => {
  let rt: Runtime;
  let ed: FakeEditor;
  let id = 0;
  const run = (command: EditorCommand) => {
    rt.receive({ kind: 'editor', id: ++id, command });
    return results().find((r) => r.id === id)!;
  };

  beforeEach(() => {
    (window as unknown as { __SC_OUTBOX__: PageToNative[] }).__SC_OUTBOX__ = [];
    ed = createFakeEditor(document);
    installFakeMonaco(window, [ed]);
    rt = startRuntime(window, { tickMs: 0 });
  });
  afterEach(() => {
    rt.stop();
    resetStylesForTests();
    document.body.innerHTML = '';
  });

  test('detects Monaco and reports editor state', () => {
    const states = outbox().filter((m) => m.kind === 'editorState');
    expect(rt.ctx.services.activeEditor()).toBe(ed);
    rt.tick();
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        const s = outbox().filter((m) => m.kind === 'editorState').pop() as Extract<PageToNative, { kind: 'editorState' }>;
        expect(states.length + 1).toBeGreaterThan(0);
        expect(s.state.detected).toBe(true);
        expect(s.state.kind).toBe('monaco');
        expect(s.state.modelUri).toBe('file:///sp0/index.js');
        expect(s.state.contentHash).toMatch(/^[0-9a-f]{8}$/);
        resolve();
      }, 120),
    );
  });

  test.each([
    [{ type: 'insertText', text: ';' }, 'type', { text: ';' }],
    [{ type: 'indent' }, 'tab', null],
    [{ type: 'outdent' }, 'outdent', null],
    [{ type: 'newline' }, 'type', { text: '\n' }],
    [{ type: 'undo' }, 'undo', null],
    [{ type: 'redo' }, 'redo', null],
    [{ type: 'deleteLeft' }, 'deleteLeft', null],
    [{ type: 'move', direction: 'left' }, 'cursorLeft', null],
    [{ type: 'move', direction: 'right', select: true }, 'cursorRightSelect', null],
    [{ type: 'move', direction: 'left', word: true }, 'cursorWordLeft', null],
    [{ type: 'move', direction: 'end' }, 'cursorEnd', null],
  ] as [EditorCommand, string, unknown][])('%j → Monaco command %s', (command, handler, payload) => {
    const r = run(command);
    expect(r.ok).toBe(true);
    expect(ed.triggers.at(-1)).toEqual({ source: 'scrimba-companion', handler, payload });
  });

  test('paste goes through Monaco paste handler (keeps undo + formatting rules)', () => {
    run({ type: 'paste', text: 'x\ny' });
    expect(ed.triggers.at(-1)?.handler).toBe('paste');
    expect((ed.triggers.at(-1)?.payload as { text: string }).text).toBe('x\ny');
  });

  test('insertPair with empty selection inserts both and places cursor between', () => {
    ed.setPosition({ lineNumber: 1, column: 13 });
    run({ type: 'insertPair', open: '(', close: ')' });
    expect(ed.lines[0]).toBe('const a = 1;()');
    expect(ed.getPosition()).toEqual({ lineNumber: 1, column: 14 });
  });

  test('insertPair wraps a selection', () => {
    ed.setSelection({ startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8 });
    run({ type: 'insertPair', open: '[', close: ']' });
    expect(ed.lines[0]).toBe('const [a] = 1;');
  });

  test('copy returns selected text; cut removes it', () => {
    ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
    expect(run({ type: 'copy' }).clipboardText).toBe('const');
    expect(ed.lines[0]).toBe('const a = 1;');
    expect(run({ type: 'cut' }).clipboardText).toBe('const');
    expect(ed.lines[0]).toBe(' a = 1;');
  });

  test('copy with empty selection copies the whole line (Monaco default)', () => {
    ed.setPosition({ lineNumber: 3, column: 2 });
    expect(run({ type: 'copy' }).clipboardText).toBe('  return a;\n');
  });

  test('selectAll selects the full model', () => {
    run({ type: 'selectAll' });
    expect(ed.sel).toEqual({ sl: 1, sc: 1, el: 4, ec: 2 });
  });

  test('bridge replaceInLine edits one line and moves the cursor', () => {
    run({ type: 'replaceInLine', lineNumber: 3, startColumn: 10, endColumn: 11, text: 'b + 1', cursorColumn: 15 });
    expect(ed.lines[2]).toBe('  return b + 1;');
    expect(ed.getPosition()).toEqual({ lineNumber: 3, column: 15 });
    expect(ed.edits.at(-1)?.source).toBe('scrimba-companion-bridge');
  });

  test('bridge columns are clamped to the line', () => {
    run({ type: 'replaceInLine', lineNumber: 99, startColumn: -5, endColumn: 999, text: '}', cursorColumn: 999 });
    expect(ed.lines[3]).toBe('}');
  });

  test('requestLineState posts the cursor line', () => {
    ed.setSelection({ startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 5 });
    run({ type: 'requestLineState' });
    const ls = outbox().filter((m) => m.kind === 'lineState').pop() as Extract<PageToNative, { kind: 'lineState' }>;
    expect(ls.line).toMatchObject({ lineNumber: 2, text: 'function f() {', selectionStartColumn: 3, selectionEndColumn: 5, multiLineSelection: false });
  });

  test('restoreSnapshot only applies to the matching model and is one edit', () => {
    expect(run({ type: 'restoreSnapshot', modelUri: 'file:///other.js', content: 'x' }).ok).toBe(false);
    expect(run({ type: 'restoreSnapshot', modelUri: 'file:///sp0/index.js', content: 'let z = 2;' }).ok).toBe(true);
    expect(ed.lines).toEqual(['let z = 2;']);
  });

  test('bridge strategy suppresses the web keyboard (inputmode=none) and restores it', () => {
    const ta = ed.getDomNode()!.querySelector('textarea')!;
    rt.receive({ kind: 'config', config: { ...rt.config(), editingStrategy: 'bridge' } });
    expect(ta.getAttribute('inputmode')).toBe('none');
    rt.receive({ kind: 'config', config: { ...rt.config(), editingStrategy: 'direct' } });
    expect(ta.hasAttribute('inputmode')).toBe(false);
  });

  test('reports a clear error when no editor exists', () => {
    installFakeMonaco(window, []);
    expect(run({ type: 'undo' })).toMatchObject({ ok: false, error: 'no-editor' });
  });

  test('focus during playback requests a pause (auto-pause on edit)', () => {
    const spy = jest.fn(() => true);
    rt.ctx.services.pausePlayback = spy;
    ed.focus();
    expect(spy).toHaveBeenCalledWith('editor-focus');
    expect(document.documentElement.hasAttribute('data-sc-editing')).toBe(true);
  });

  test('typing while editing marks dirty; Ctrl+S clears it', async () => {
    ed.focus();
    run({ type: 'replaceInLine', lineNumber: 1, startColumn: 1, endColumn: 1, text: 'x', cursorColumn: 2 });
    await new Promise((r) => setTimeout(r, 120));
    const dirty = () => (outbox().filter((m) => m.kind === 'editorState').pop() as Extract<PageToNative, { kind: 'editorState' }>).state.dirty;
    expect(dirty()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await new Promise((r) => setTimeout(r, 120));
    expect(dirty()).toBe(false);
  });

  test('findRunButton matches Scrimba "RERUN" label', () => {
    const b = document.createElement('op-button');
    b.textContent = 'RERUN';
    const h = document.createElement('ide-header');
    h.appendChild(b);
    document.body.appendChild(h);
    expect(findRunButton(document)).toBe(b);
  });
});

describe('page-visible runtime global', () => {
  test('exposes commands and diagnostics, but not the context or the app bridge', () => {
    const rt = startRuntime(window, { tickMs: 0 });
    const g = (window as unknown as Record<string, Record<string, unknown>>).__SC__;
    expect(typeof g.receive).toBe('function');
    expect(typeof g.diagnostics).toBe('function');
    expect(g.ctx).toBeUndefined();
    expect(Object.isFrozen(g)).toBe(true);
    // A page script can't replace it to intercept app commands (e.g. paste text).
    expect(() => {
      'use strict';
      (window as unknown as Record<string, unknown>).__SC__ = { receive() {} };
    }).toThrow();
    expect((window as unknown as Record<string, unknown>).__SC__).toBe(g);
    // Starting again returns the same runtime (idempotent injection).
    expect(startRuntime(window, { tickMs: 0 })).toBe(rt);
    rt.stop();
    expect((window as unknown as Record<string, unknown>).__SC__).toBeUndefined();
  });
});

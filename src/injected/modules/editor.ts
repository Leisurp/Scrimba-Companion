/**
 * Editor module: detects Scrimba's Monaco editors, tracks focus/dirty/cursor state,
 * executes editing commands through Monaco's public command API, and serves the
 * native text-input bridge.
 *
 * Evidence (see docs/COMPATIBILITY_FINDINGS.md): Scrimba uses Monaco in textarea input
 * mode and exposes `window.monaco`. All edits below go through `editor.trigger()` /
 * `editor.executeEdits()`, so they land in Monaco's model and undo stack exactly like
 * typed input and are observed by Scrimba's own change listeners.
 */
import type { EditorCommand, EditorState, LineState } from '../../shared/protocol';
import { activateElement, statusOf, type CompatModule, type Context } from '../core';
import { getMonaco, readOption, type ICodeEditor, type IRange, type ISelection, type MonacoGlobal } from '../monacoTypes';
import { fnv1a } from '../../shared/hash';

const NAME = 'editor';
const SOURCE = 'scrimba-companion';

interface Hooked {
  ed: ICodeEditor;
  disposers: { dispose(): void }[];
}

export interface EditorModuleApi {
  run(command: EditorCommand): { ok: boolean; error?: string; clipboardText?: string };
  active(): ICodeEditor | null;
  state(): EditorState;
  lineState(): LineState | null;
  markSaved(): void;
}

export function createEditorModule(): CompatModule & { api: EditorModuleApi } {
  const hooked = new Map<string, Hooked>();
  let lastFocusedId: string | null = null;
  let dirty = false;
  let suppressCursorEcho = 0;
  let lastPostedState = '';
  let stateTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLine = -1;
  let ctxRef: Context | null = null;
  let monacoRef: MonacoGlobal | null = null;
  const BRIDGE_ATTR = 'data-sc-bridge-input';

  function editors(): ICodeEditor[] {
    // Read the global each time: cheap, and robust if the page replaces it.
    if (ctxRef) monacoRef = getMonaco(ctxRef.win);
    if (!monacoRef) return [];
    try {
      return monacoRef.editor.getEditors().filter((e) => {
        const dom = e.getDomNode();
        return !!dom && dom.isConnected && !!e.getModel();
      });
    } catch {
      return [];
    }
  }

  function active(): ICodeEditor | null {
    const list = editors();
    const focused = list.find((e) => safeFocus(e));
    if (focused) return focused;
    const last = list.find((e) => e.getId() === lastFocusedId);
    if (last) return last;
    // Largest visible editor.
    let best: ICodeEditor | null = list[0] ?? null;
    let bestArea = 0;
    for (const e of list) {
      const r = e.getDomNode()!.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) {
        best = e;
        bestArea = area;
      }
    }
    return best;
  }

  function safeFocus(e: ICodeEditor): boolean {
    try {
      return e.hasTextFocus();
    } catch {
      return false;
    }
  }

  let hashCache: { key: string; hash: string } | null = null;
  function contentHash(model: { uri: { toString(): string }; getAlternativeVersionId(): number; getValue(): string } | null): string | null {
    if (!model) return null;
    const key = `${model.uri.toString()}@${model.getAlternativeVersionId()}`;
    if (hashCache && hashCache.key === key) return hashCache.hash;
    hashCache = { key, hash: fnv1a(model.getValue()) };
    return hashCache.hash;
  }

  function state(): EditorState {
    const list = editors();
    const ed = active();
    const model = ed?.getModel() ?? null;
    const sel = ed?.getSelection() ?? null;
    const pos = ed?.getPosition() ?? null;
    return {
      detected: list.length > 0,
      kind: list.length > 0 ? 'monaco' : 'none',
      editorCount: list.length,
      focused: list.some(safeFocus),
      dirty,
      hasSelection: !!sel && !sel.isEmpty(),
      lineNumber: pos?.lineNumber ?? 0,
      column: pos?.column ?? 0,
      language: model?.getLanguageId ? model.getLanguageId() : null,
      readOnly: !!(ed && monacoRef && readOption(monacoRef, ed, 'readOnly')),
      modelUri: model ? model.uri.toString() : null,
      contentHash: contentHash(model),
    };
  }

  function lineState(): LineState | null {
    const ed = active();
    const model = ed?.getModel();
    const sel = ed?.getSelection();
    if (!ed || !model || !sel) return null;
    const pos = sel.getPosition();
    const line = pos.lineNumber;
    const multi = sel.startLineNumber !== sel.endLineNumber;
    const maxCol = model.getLineMaxColumn(line);
    let start = pos.column;
    let end = pos.column;
    if (!multi) {
      start = sel.startColumn;
      end = sel.endColumn;
    }
    return {
      lineNumber: line,
      lineCount: model.getLineCount(),
      text: model.getLineContent(line),
      selectionStartColumn: Math.min(Math.max(1, start), maxCol),
      selectionEndColumn: Math.min(Math.max(1, end), maxCol),
      multiLineSelection: multi,
    };
  }

  function postState(ctx: Context, force = false) {
    const s = state();
    const key = JSON.stringify(s);
    if (!force && key === lastPostedState) return;
    lastPostedState = key;
    ctx.bridge.post({ kind: 'editorState', state: s });
  }

  function scheduleState(ctx: Context) {
    if (stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = null;
      ctx.guard(NAME, () => postState(ctx));
    }, 80);
  }

  function postLineState(ctx: Context) {
    const ls = lineState();
    if (ls) ctx.bridge.post({ kind: 'lineState', line: ls });
  }

  function scheduleSnapshot(ctx: Context, ed: ICodeEditor) {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      ctx.guard(NAME, () => {
        const model = ed.getModel();
        if (!model || !dirty) return;
        const content = model.getValue();
        if (content.length > 512 * 1024) return; // keep recovery snapshots small
        ctx.bridge.post({
          kind: 'snapshot',
          location: ctx.win.location.origin + ctx.win.location.pathname,
          modelUri: model.uri.toString(),
          content,
        });
      });
    }, 2500);
  }

  function setEditing(ctx: Context, editing: boolean) {
    if (ctx.state.editing === editing) return;
    ctx.state.editing = editing;
    const html = ctx.doc.documentElement;
    if (editing) html.setAttribute('data-sc-editing', '');
    else html.removeAttribute('data-sc-editing');
    ctx.emit('editingChanged');
  }

  function applyStrategy(ctx: Context, ed: ICodeEditor) {
    const bridge = ctx.config().editingStrategy === 'bridge';
    const inputs = ed.getDomNode()?.querySelectorAll('textarea, .native-edit-context') ?? [];
    inputs.forEach((el) => {
      if (bridge && !el.hasAttribute(BRIDGE_ATTR)) {
        // In bridge mode the native TextInput owns the keyboard. inputmode="none" stops
        // Monaco's hidden input from summoning a competing web keyboard while keeping
        // focus, cursor rendering, hardware-keyboard input and API edits intact.
        // (Monaco's `domReadOnly` alone does not set `readonly` unless readOnly is also on.)
        el.setAttribute(BRIDGE_ATTR, el.getAttribute('inputmode') ?? '');
        el.setAttribute('inputmode', 'none');
      } else if (!bridge && el.hasAttribute(BRIDGE_ATTR)) {
        const prev = el.getAttribute(BRIDGE_ATTR);
        if (prev) el.setAttribute('inputmode', prev);
        else el.removeAttribute('inputmode');
        el.removeAttribute(BRIDGE_ATTR);
      }
    });
  }

  function hook(ctx: Context, ed: ICodeEditor) {
    const id = ed.getId();
    if (hooked.has(id)) return;
    const disposers = [
      ed.onDidFocusEditorText(() =>
        ctx.guard(NAME, () => {
          lastFocusedId = id;
          ctx.state.input.focus++;
          setEditing(ctx, true);
          if (ctx.config().autoPauseOnEdit) ctx.services.pausePlayback('editor-focus');
          postState(ctx, true);
          if (ctx.config().editingStrategy === 'bridge') postLineState(ctx);
        }),
      ),
      ed.onDidBlurEditorText(() =>
        ctx.guard(NAME, () => {
          ctx.state.input.blur++;
          setTimeout(() => {
            if (!editors().some(safeFocus)) setEditing(ctx, false);
            postState(ctx, true);
          }, 150);
        }),
      ),
      ed.onDidChangeModelContent(() =>
        ctx.guard(NAME, () => {
          // Scrimba's own playback also changes the model; only count edits while the user is editing.
          if (ctx.state.editing || safeFocus(ed)) {
            dirty = true;
            scheduleSnapshot(ctx, ed);
          }
          scheduleState(ctx);
        }),
      ),
      ed.onDidChangeCursorSelection(() =>
        ctx.guard(NAME, () => {
          scheduleState(ctx);
          if (ctx.config().editingStrategy !== 'bridge' || !safeFocus(ed)) return;
          if (suppressCursorEcho > 0) return;
          const pos = ed.getPosition();
          // Native bridge needs the new line whenever the cursor changes line or is moved by Monaco.
          if (pos && pos.lineNumber !== lastLine) lastLine = pos.lineNumber;
          postLineState(ctx);
        }),
      ),
      ed.onDidDispose(() => {
        hooked.get(id)?.disposers.forEach((d) => d.dispose());
        hooked.delete(id);
        ctx.emit('editorsChanged');
      }),
    ];
    hooked.set(id, { ed, disposers });
    applyStrategy(ctx, ed);
    ctx.logger.log('info', NAME, `hooked Monaco editor ${id}`);
    ctx.emit('editorsChanged');
  }

  function wrapRange(sel: IRange, open: string, close: string, model: { getValueInRange(r: IRange): string }) {
    return { range: sel, text: open + model.getValueInRange(sel) + close, forceMoveMarkers: true };
  }

  function withEcho<T>(fn: () => T): T {
    suppressCursorEcho++;
    try {
      return fn();
    } finally {
      suppressCursorEcho--;
    }
  }

  function isMacLike(win: Window): boolean {
    return /Mac|iPhone|iPad|iPod/i.test(win.navigator.platform || '') || /Mac OS X/.test(win.navigator.userAgent);
  }

  function runCommand(ctx: Context, cmd: EditorCommand): { ok: boolean; error?: string; clipboardText?: string } {
    const ed = active();
    if (!ed) return { ok: false, error: 'no-editor' };
    const model = ed.getModel();
    if (!model) return { ok: false, error: 'no-model' };
    const t = (handler: string, payload: unknown = null) => ed.trigger(SOURCE, handler, payload);
    let clipboardText: string | undefined;

    switch (cmd.type) {
      case 'insertText':
        t('type', { text: cmd.text });
        break;
      case 'insertPair': {
        const sels = ed.getSelections() || [];
        if (sels.some((s) => !s.isEmpty())) {
          ed.pushUndoStop();
          ed.executeEdits(SOURCE, sels.map((s) => wrapRange(s, cmd.open, cmd.close, model)));
          ed.pushUndoStop();
        } else {
          const edits = sels.map((s) => ({ range: s as IRange, text: cmd.open + cmd.close, forceMoveMarkers: true }));
          const cursors: ISelection[] = sels.map((s) => {
            const p = s.getPosition();
            const col = p.column + cmd.open.length;
            return { selectionStartLineNumber: p.lineNumber, selectionStartColumn: col, positionLineNumber: p.lineNumber, positionColumn: col };
          });
          // Toolbar insertions are their own undo step (like Monaco's paste).
          ed.pushUndoStop();
          ed.executeEdits(SOURCE, edits, cursors);
          ed.pushUndoStop();
        }
        break;
      }
      case 'indent':
        t('tab');
        break;
      case 'outdent':
        t('outdent');
        break;
      case 'newline':
        t('type', { text: '\n' });
        break;
      case 'deleteLeft':
        t('deleteLeft');
        break;
      case 'deleteRight':
        t('deleteRight');
        break;
      case 'undo':
        t('undo');
        break;
      case 'redo':
        t('redo');
        break;
      case 'selectAll': {
        ctx.state.selectionArmedAt = Date.now();
        const r = model.getFullModelRange();
        ed.setSelection(r);
        break;
      }
      case 'move': {
        const base: Record<string, string> = {
          left: cmd.word ? 'cursorWordLeft' : 'cursorLeft',
          right: cmd.word ? 'cursorWordEndRight' : 'cursorRight',
          up: 'cursorUp',
          down: 'cursorDown',
          home: 'cursorHome',
          end: 'cursorEnd',
        };
        const id = base[cmd.direction];
        if (!id) return { ok: false, error: 'bad-direction' };
        if (cmd.select) ctx.state.selectionArmedAt = Date.now();
        t(cmd.select ? id + 'Select' : id);
        break;
      }
      case 'copy':
      case 'cut': {
        const sels = (ed.getSelections() || []).filter((s) => !s.isEmpty());
        const eol = model.getEOL();
        if (sels.length) {
          clipboardText = sels.map((s) => model.getValueInRange(s)).join(eol);
          if (cmd.type === 'cut') {
            ed.pushUndoStop();
            ed.executeEdits(SOURCE, sels.map((s) => ({ range: s as IRange, text: '' })));
            ed.pushUndoStop();
          }
        } else {
          // Monaco's default: copy/cut with an empty selection acts on the whole line.
          const pos = ed.getPosition();
          if (!pos) return { ok: false, error: 'no-cursor' };
          clipboardText = model.getLineContent(pos.lineNumber) + eol;
          if (cmd.type === 'cut') t('editor.action.deleteLines');
        }
        break;
      }
      case 'paste':
        t('paste', { text: cmd.text, pasteOnNewLine: false, multicursorText: null, mode: null });
        break;
      case 'toggleComment': {
        const action = ed.getAction('editor.action.commentLine');
        if (!action) return { ok: false, error: 'no-comment-action' };
        void action.run();
        break;
      }
      case 'save': {
        // Scrimba binds save to `mod+s` on its editor element (data-hotkey). We emit the same
        // shortcut Monaco/Scrimba would receive from a physical keyboard.
        const target = ed.getDomNode()?.querySelector('textarea, .native-edit-context') || ed.getDomNode();
        if (!target) return { ok: false, error: 'no-target' };
        const mac = isMacLike(ctx.win);
        const W = ctx.win as unknown as typeof globalThis;
        target.dispatchEvent(
          new W.KeyboardEvent('keydown', {
            key: 's',
            code: 'KeyS',
            keyCode: 83,
            which: 83,
            ctrlKey: !mac,
            metaKey: mac,
            bubbles: true,
            cancelable: true,
            composed: true,
          } as KeyboardEventInit),
        );
        dirty = false;
        break;
      }
      case 'run': {
        const btn = findRunButton(ctx.doc);
        if (!btn) return { ok: false, error: 'no-run-button' };
        activateElement(ctx.win, btn);
        return { ok: true };
      }
      case 'focus':
        ed.focus();
        return { ok: true };
      case 'blur': {
        const a = ctx.doc.activeElement as HTMLElement | null;
        a?.blur?.();
        return { ok: true };
      }
      case 'replaceInLine': {
        const line = clampLine(model, cmd.lineNumber);
        const max = model.getLineMaxColumn(line);
        const start = clamp(cmd.startColumn, 1, max);
        const end = clamp(cmd.endColumn, start, max);
        withEcho(() => {
          ed.executeEdits('scrimba-companion-bridge', [
            { range: { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end }, text: cmd.text, forceMoveMarkers: true },
          ]);
          const newMax = model.getLineMaxColumn(line);
          const col = clamp(cmd.cursorColumn, 1, newMax);
          ed.setPosition({ lineNumber: line, column: col });
        });
        return { ok: true };
      }
      case 'setSelectionInLine': {
        const line = clampLine(model, cmd.lineNumber);
        const max = model.getLineMaxColumn(line);
        withEcho(() =>
          ed.setSelection({
            startLineNumber: line,
            startColumn: clamp(cmd.startColumn, 1, max),
            endLineNumber: line,
            endColumn: clamp(cmd.endColumn, 1, max),
          }),
        );
        return { ok: true };
      }
      case 'requestLineState':
        postLineState(ctx);
        return { ok: true };
      case 'restoreSnapshot': {
        if (model.uri.toString() !== cmd.modelUri) return { ok: false, error: 'model-mismatch' };
        ed.pushUndoStop();
        ed.executeEdits('scrimba-companion-restore', [{ range: model.getFullModelRange(), text: cmd.content }]);
        ed.pushUndoStop();
        dirty = true;
        break;
      }
      default:
        return { ok: false, error: 'unknown-command' };
    }

    // Keep the editor focused (and the keyboard up) after toolbar actions.
    if (!safeFocus(ed)) ed.focus();
    if (ctx.config().editingStrategy === 'bridge') postLineState(ctx);
    scheduleState(ctx);
    return { ok: true, clipboardText };
  }

  const api: EditorModuleApi = {
    run: (command) => (ctxRef ? ctxRef.guard(NAME, () => runCommand(ctxRef!, command), { ok: false, error: 'exception' })! : { ok: false, error: 'not-ready' }),
    active,
    state,
    lineState,
    markSaved: () => {
      dirty = false;
    },
  };

  return {
    name: NAME,
    api,
    init(ctx) {
      ctxRef = ctx;
      ctx.services.activeEditor = active;
      // Detect real save shortcuts typed on a physical keyboard so dirty tracking stays honest.
      ctx.listen(ctx.doc, 
        'keydown',
        (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            dirty = false;
            scheduleState(ctx);
          }
        },
        true,
      );
    },
    tick(ctx) {
      monacoRef = getMonaco(ctx.win);
      if (!monacoRef) return;
      const list = editors();
      list.forEach((ed) => hook(ctx, ed));
      list.forEach((ed) => applyStrategy(ctx, ed));
      scheduleState(ctx);
    },
    onConfig(ctx) {
      editors().forEach((ed) => applyStrategy(ctx, ed));
    },
    status(ctx) {
      const list = editors();
      return statusOf(
        ctx,
        NAME,
        !!monacoRef,
        list.length > 0,
        monacoRef ? `monaco editors=${list.length} hooked=${hooked.size} strategy=${ctx.config().editingStrategy}` : 'window.monaco not found',
      );
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function clampLine(model: { getLineCount(): number }, line: number): number {
  return clamp(line, 1, model.getLineCount());
}

/** Find Scrimba's Run/Rerun button by visible label, scoped to header/toolbars. */
export function findRunButton(doc: Document): HTMLElement | null {
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>('ide-header op-button, ide-header button, [class*="SIRunner"], op-button, button'),
  );
  for (const el of candidates) {
    const label = (el.innerText || el.textContent || '').trim();
    if (/^(re)?run\b/i.test(label) && label.length < 20) return el;
  }
  return null;
}

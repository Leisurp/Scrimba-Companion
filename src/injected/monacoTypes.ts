/**
 * Minimal structural subset of the public Monaco editor API used by the runtime.
 * Scrimba exposes the standard `window.monaco` global; we only rely on documented,
 * public Monaco API surface (https://microsoft.github.io/monaco-editor/docs.html).
 */
export interface IPosition {
  lineNumber: number;
  column: number;
}
export interface IRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}
export interface ISelection {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}
export interface Selection extends IRange {
  isEmpty(): boolean;
  getPosition(): IPosition;
}
export interface IDisposable {
  dispose(): void;
}
export interface ITextModel {
  uri: { toString(): string };
  getValue(): string;
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
  getLineMaxColumn(lineNumber: number): number;
  getValueInRange(range: IRange): string;
  getFullModelRange(): IRange;
  getEOL(): string;
  getLanguageId?(): string;
  getAlternativeVersionId(): number;
  canUndo?(): boolean;
  canRedo?(): boolean;
  getWordAtPosition?(position: IPosition): { word: string; startColumn: number; endColumn: number } | null;
}
export interface IEditorAction {
  run(): Promise<void> | void;
}
export interface IMouseTarget {
  position: IPosition | null;
}
export interface ICodeEditor {
  getId(): string;
  getModel(): ITextModel | null;
  getDomNode(): HTMLElement | null;
  hasTextFocus(): boolean;
  focus(): void;
  layout(dimension?: { width: number; height: number }): void;
  trigger(source: string, handlerId: string, payload: unknown): void;
  executeEdits(
    source: string,
    edits: { range: IRange; text: string | null; forceMoveMarkers?: boolean }[],
    endCursorState?: ISelection[] | IRange[],
  ): boolean;
  pushUndoStop(): boolean;
  getPosition(): IPosition | null;
  setPosition(position: IPosition): void;
  getSelection(): Selection | null;
  getSelections(): Selection[] | null;
  setSelection(selection: IRange | ISelection): void;
  setSelections(selections: ISelection[]): void;
  revealPositionInCenterIfOutsideViewport(position: IPosition): void;
  getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null;
  /** Position of a caret relative to the editor's DOM node (already scrolled), or null if not rendered. */
  getScrolledVisiblePosition?(position: IPosition): { top: number; left: number; height: number } | null;
  getScrollTop?(): number;
  setScrollTop?(top: number): void;
  getLayoutInfo?(): { contentLeft: number; width: number; height: number };
  onDidScrollChange?(fn: (e: unknown) => void): IDisposable;
  onDidLayoutChange?(fn: (e: unknown) => void): IDisposable;
  getAction(id: string): IEditorAction | null;
  getOption(id: number): unknown;
  updateOptions(options: Record<string, unknown>): void;
  onDidFocusEditorText(fn: () => void): IDisposable;
  onDidBlurEditorText(fn: () => void): IDisposable;
  onDidChangeModelContent(fn: (e: unknown) => void): IDisposable;
  onDidChangeCursorSelection(fn: (e: unknown) => void): IDisposable;
  onDidChangeModel?(fn: (e: unknown) => void): IDisposable;
  onDidDispose(fn: () => void): IDisposable;
}
export interface MonacoGlobal {
  editor: {
    getEditors(): ICodeEditor[];
    EditorOption?: Record<string, number>;
  };
}

export function getMonaco(win: Window): MonacoGlobal | null {
  const m = (win as unknown as { monaco?: MonacoGlobal }).monaco;
  if (m && m.editor && typeof m.editor.getEditors === 'function') return m;
  return null;
}

export function readOption(m: MonacoGlobal, ed: ICodeEditor, name: string): unknown {
  const id = m.editor.EditorOption ? m.editor.EditorOption[name] : undefined;
  if (typeof id !== 'number') return undefined;
  try {
    return ed.getOption(id);
  } catch {
    return undefined;
  }
}

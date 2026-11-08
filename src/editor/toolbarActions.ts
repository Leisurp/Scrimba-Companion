import type { EditorCommand } from '../shared/protocol';

export type ToolbarActionId =
  | 'tab'
  | 'outdent'
  | 'braces'
  | 'parens'
  | 'brackets'
  | 'arrow'
  | 'semicolon'
  | 'dquote'
  | 'squote'
  | 'backtick'
  | 'angle'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'selectLeft'
  | 'selectRight'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'selectAll'
  | 'comment'
  | 'save'
  | 'run'
  | 'done';

export interface ToolbarAction {
  id: ToolbarActionId;
  label: string;
  accessibilityLabel: string;
  /** Static command, or null when the screen must handle it (clipboard, keyboard). */
  command: EditorCommand | null;
  group: 'insert' | 'navigate' | 'history' | 'clipboard' | 'lesson';
}

export const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  { id: 'tab', label: '⇥', accessibilityLabel: 'Indent (Tab)', command: { type: 'indent' }, group: 'insert' },
  { id: 'outdent', label: '⇤', accessibilityLabel: 'Outdent', command: { type: 'outdent' }, group: 'insert' },
  { id: 'braces', label: '{ }', accessibilityLabel: 'Insert braces', command: { type: 'insertPair', open: '{', close: '}' }, group: 'insert' },
  { id: 'parens', label: '( )', accessibilityLabel: 'Insert parentheses', command: { type: 'insertPair', open: '(', close: ')' }, group: 'insert' },
  { id: 'brackets', label: '[ ]', accessibilityLabel: 'Insert square brackets', command: { type: 'insertPair', open: '[', close: ']' }, group: 'insert' },
  { id: 'arrow', label: '=>', accessibilityLabel: 'Insert arrow', command: { type: 'insertText', text: '=>' }, group: 'insert' },
  { id: 'semicolon', label: ';', accessibilityLabel: 'Insert semicolon', command: { type: 'insertText', text: ';' }, group: 'insert' },
  { id: 'dquote', label: '" "', accessibilityLabel: 'Insert double quotes', command: { type: 'insertPair', open: '"', close: '"' }, group: 'insert' },
  { id: 'squote', label: "' '", accessibilityLabel: 'Insert single quotes', command: { type: 'insertPair', open: "'", close: "'" }, group: 'insert' },
  { id: 'backtick', label: '` `', accessibilityLabel: 'Insert backticks', command: { type: 'insertPair', open: '`', close: '`' }, group: 'insert' },
  { id: 'angle', label: '< >', accessibilityLabel: 'Insert angle brackets', command: { type: 'insertPair', open: '<', close: '>' }, group: 'insert' },
  { id: 'left', label: '←', accessibilityLabel: 'Cursor left', command: { type: 'move', direction: 'left' }, group: 'navigate' },
  { id: 'right', label: '→', accessibilityLabel: 'Cursor right', command: { type: 'move', direction: 'right' }, group: 'navigate' },
  { id: 'up', label: '↑', accessibilityLabel: 'Cursor up', command: { type: 'move', direction: 'up' }, group: 'navigate' },
  { id: 'down', label: '↓', accessibilityLabel: 'Cursor down', command: { type: 'move', direction: 'down' }, group: 'navigate' },
  { id: 'selectLeft', label: '⇧←', accessibilityLabel: 'Extend selection left', command: { type: 'move', direction: 'left', select: true }, group: 'navigate' },
  { id: 'selectRight', label: '⇧→', accessibilityLabel: 'Extend selection right', command: { type: 'move', direction: 'right', select: true }, group: 'navigate' },
  { id: 'undo', label: '↶', accessibilityLabel: 'Undo', command: { type: 'undo' }, group: 'history' },
  { id: 'redo', label: '↷', accessibilityLabel: 'Redo', command: { type: 'redo' }, group: 'history' },
  { id: 'copy', label: 'Copy', accessibilityLabel: 'Copy selection', command: { type: 'copy' }, group: 'clipboard' },
  { id: 'cut', label: 'Cut', accessibilityLabel: 'Cut selection', command: { type: 'cut' }, group: 'clipboard' },
  { id: 'paste', label: 'Paste', accessibilityLabel: 'Paste from clipboard', command: null, group: 'clipboard' },
  { id: 'selectAll', label: 'All', accessibilityLabel: 'Select all', command: { type: 'selectAll' }, group: 'clipboard' },
  { id: 'comment', label: '//', accessibilityLabel: 'Toggle line comment', command: { type: 'toggleComment' }, group: 'clipboard' },
  { id: 'save', label: 'Save', accessibilityLabel: 'Save (Ctrl+S)', command: { type: 'save' }, group: 'lesson' },
  { id: 'run', label: '▶ Run', accessibilityLabel: 'Run code', command: { type: 'run' }, group: 'lesson' },
  { id: 'done', label: 'Done', accessibilityLabel: 'Hide keyboard', command: { type: 'blur' }, group: 'lesson' },
];

export function getAction(id: ToolbarActionId): ToolbarAction {
  const a = TOOLBAR_ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown toolbar action ${id}`);
  return a;
}

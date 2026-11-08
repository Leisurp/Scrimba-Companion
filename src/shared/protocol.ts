/**
 * Message protocol shared by the native app and the injected page runtime.
 *
 * This file must stay free of React Native imports: it is bundled into the
 * injected script by esbuild (see scripts/build-injected.mjs) as well as being
 * used by the native side.
 */

export const PROTOCOL_VERSION = 1;
export const RUNTIME_VERSION = '1.0.0';

export type EditingStrategy = 'direct' | 'bridge';
export type CaptionPosition = 'default' | 'raised' | 'top';
export type CaptionsWhileEditing = 'show' | 'dim' | 'hide';
export type PlaybackState = 'playing' | 'paused' | 'unknown';

export interface CaptionConfig {
  /** Visual scale factor applied to Scrimba's own caption element (1 = unchanged). */
  scale: number;
  /** Background opacity 0..1, or null to keep Scrimba's default styling. */
  backgroundOpacity: number | null;
  position: CaptionPosition;
  whileEditing: CaptionsWhileEditing;
}

export interface RuntimeConfig {
  /** Re-enable pointer events that Scrimba disables on its editor on touch devices. */
  touchFix: boolean;
  /** Focus Monaco synchronously from a tap if Monaco did not focus itself. */
  tapFocusAssist: boolean;
  /** Phone-style text selection: reliable double-tap/long-press word select, drag handles, Cut/Copy/Paste menu. */
  touchSelection: boolean;
  /** Pause the screencast as soon as the editor receives focus. */
  autoPauseOnEdit: boolean;
  editingStrategy: EditingStrategy;
  captions: CaptionConfig;
  /** Pause playback when the audio output device changes (e.g. headphones unplugged). */
  pauseOnAudioRouteChange: boolean;
  /** Post verbose logs to native. */
  debug: boolean;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  touchFix: true,
  tapFocusAssist: true,
  touchSelection: true,
  autoPauseOnEdit: true,
  editingStrategy: 'direct',
  captions: { scale: 1, backgroundOpacity: null, position: 'default', whileEditing: 'dim' },
  pauseOnAudioRouteChange: true,
  debug: false,
};

export type MoveDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

export type EditorCommand =
  | { type: 'insertText'; text: string }
  | { type: 'insertPair'; open: string; close: string }
  | { type: 'indent' }
  | { type: 'outdent' }
  | { type: 'newline' }
  | { type: 'deleteLeft' }
  | { type: 'deleteRight' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'selectAll' }
  | { type: 'move'; direction: MoveDirection; select?: boolean; word?: boolean }
  | { type: 'copy' }
  | { type: 'cut' }
  | { type: 'paste'; text: string }
  | { type: 'toggleComment' }
  | { type: 'save' }
  | { type: 'run' }
  | { type: 'focus' }
  | { type: 'blur' }
  /** Native text-input bridge: replace [startColumn, endColumn) on one line. Columns are 1-based (Monaco). */
  | {
      type: 'replaceInLine';
      lineNumber: number;
      startColumn: number;
      endColumn: number;
      text: string;
      cursorColumn: number;
    }
  | { type: 'setSelectionInLine'; lineNumber: number; startColumn: number; endColumn: number }
  | { type: 'requestLineState' }
  | { type: 'restoreSnapshot'; modelUri: string; content: string };

export type EditorCommandType = EditorCommand['type'];

export type NativeToPage =
  | { kind: 'config'; config: RuntimeConfig }
  | { kind: 'editor'; id: number; command: EditorCommand }
  | { kind: 'playback'; action: 'pause' | 'play' }
  | { kind: 'layout'; fullscreenEditor?: boolean; expandedPreview?: boolean }
  | { kind: 'requestDiagnostics' }
  | { kind: 'appState'; state: 'active' | 'background' }
  | { kind: 'softKeyboard'; visible: boolean; height: number };

export interface EditorState {
  detected: boolean;
  kind: 'monaco' | 'none';
  editorCount: number;
  focused: boolean;
  /** Edits since the last save the app knows about (heuristic). */
  dirty: boolean;
  hasSelection: boolean;
  lineNumber: number;
  column: number;
  language: string | null;
  readOnly: boolean;
  /** Monaco model URI of the active editor (e.g. file:///sp0/index.html). */
  modelUri: string | null;
  /** FNV-1a hash of the active model content (for recovery comparison only). */
  contentHash: string | null;
}

export interface LineState {
  lineNumber: number;
  lineCount: number;
  text: string;
  /** 1-based Monaco columns, clamped to the cursor line. */
  selectionStartColumn: number;
  selectionEndColumn: number;
  multiLineSelection: boolean;
}

export interface ModuleStatus {
  name: string;
  applicable: boolean;
  active: boolean;
  detail: string;
  errorCount: number;
}

export interface InputCounters {
  keydown: number;
  keydownIme229: number;
  beforeinput: Record<string, number>;
  input: number;
  compositionstart: number;
  compositionend: number;
  focus: number;
  blur: number;
  tapAssistFocus: number;
  touchFixApplied: number;
}

export interface PageDiagnostics {
  runtimeVersion: string;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number; visualHeight: number | null };
  touch: { maxTouchPoints: number; coarsePointer: boolean; touchInterfaceClass: boolean };
  monaco: { present: boolean; editors: number; editContextSupported: boolean; editContextEnabled: boolean | null };
  pointerEventsFix: string[];
  modules: ModuleStatus[];
  input: InputCounters;
  playback: { state: PlaybackState; controlsFound: boolean; mediaElements: number; mediaErrors: string[] };
  captions: { found: boolean; tag: string | null; enabled: boolean | null };
  layout: { fullscreenEditor: boolean; expandedPreview: boolean; previewAvailable: boolean };
  logs: { t: number; level: LogLevel; module: string; message: string }[];
  location: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type PageToNative =
  | { kind: 'ready'; runtimeVersion: string; protocol: number; location: string }
  | { kind: 'location'; location: string; title: string }
  | { kind: 'editorState'; state: EditorState }
  | { kind: 'lineState'; line: LineState }
  | { kind: 'commandResult'; id: number; ok: boolean; error?: string; clipboardText?: string }
  | { kind: 'playback'; state: PlaybackState; reason?: string }
  | { kind: 'physicalKeyboard'; detected: boolean }
  | { kind: 'modules'; modules: ModuleStatus[] }
  | { kind: 'log'; level: LogLevel; module: string; message: string }
  | { kind: 'diagnostics'; report: PageDiagnostics }
  | { kind: 'snapshot'; location: string; modelUri: string; content: string }
  | { kind: 'layoutState'; fullscreenEditor: boolean; expandedPreview: boolean; previewAvailable: boolean }
  /** Text the user copied or cut with the in-page selection menu, for the native clipboard. */
  | { kind: 'clipboard'; text: string }
  /** The in-page selection menu's Paste: native reads the clipboard and sends an editor `paste` command. */
  | { kind: 'pasteRequest' }
  | { kind: 'execution'; crossOriginIsolated: boolean; sharedArrayBuffer: boolean; webContainerExpected: boolean; blocked: boolean };

export type PageMessageKind = PageToNative['kind'];

/** Global names used inside the page. */
export const PAGE_GLOBAL = '__SC__';
export const PAGE_EARLY_GLOBAL = '__SC_EARLY__';
export const PAGE_BOOT_CONFIG = '__SC_BOOT_CONFIG__';
export const PAGE_TOKEN = '__SC_TOKEN__';

/** Wire format of page → native messages. */
export interface Envelope {
  t: string;
  m: PageToNative;
}

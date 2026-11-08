/**
 * In-memory diagnostics for the current app session. Nothing here is persisted or sent
 * anywhere automatically; the user can export a redacted report from the panel.
 */
import type { EditorState, ModuleStatus, PageDiagnostics, PlaybackState } from '../shared/protocol';
import { redactUrl } from './redact';

export interface NativeLogEntry {
  t: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export interface DiagnosticsSnapshot {
  logs: NativeLogEntry[];
  modules: ModuleStatus[];
  editor: EditorState | null;
  playback: PlaybackState;
  page: PageDiagnostics | null;
  navigation: { loading: boolean; url: string; canGoBack: boolean; canGoForward: boolean; lastError: string | null };
  runtimeReady: boolean;
  compatMode: string;
  physicalKeyboard: boolean;
}

type Listener = () => void;

export class DiagnosticsStore {
  private snapshot: DiagnosticsSnapshot = {
    logs: [],
    modules: [],
    editor: null,
    playback: 'unknown',
    page: null,
    navigation: { loading: false, url: '', canGoBack: false, canGoForward: false, lastError: null },
    runtimeReady: false,
    compatMode: 'mobile',
    physicalKeyboard: false,
  };
  private listeners = new Set<Listener>();

  get(): DiagnosticsSnapshot {
    return this.snapshot;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(patch: Partial<DiagnosticsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  log(level: NativeLogEntry['level'], source: string, message: string): void {
    // URLs are redacted at the point of capture so raw query strings are never held.
    const clean = message.replace(/\bhttps?:\/\/\S+/g, (m) => redactUrl(m)).slice(0, 500);
    const logs = [...this.snapshot.logs, { t: Date.now(), level, source, message: clean }].slice(-300);
    this.update({ logs });
  }

  navigation(patch: Partial<DiagnosticsSnapshot['navigation']>): void {
    const nav = { ...this.snapshot.navigation, ...patch };
    if (patch.url) nav.url = redactUrl(patch.url);
    this.update({ navigation: nav });
  }
}

export const diagnostics = new DiagnosticsStore();

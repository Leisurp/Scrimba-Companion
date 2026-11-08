import type { EditorCommand, NativeToPage, PageToNative } from '../shared/protocol';
import { buildCommandScript, parsePageMessage } from './messages';

export interface CommandResult {
  ok: boolean;
  error?: string;
  clipboardText?: string;
}

interface Pending {
  resolve(r: CommandResult): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Native ↔ page messaging. Plain class (no React) so it is unit-testable.
 * `inject` is WebView.injectJavaScript.
 */
export class PageBridge {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private inject: (js: string) => void,
    readonly token: string,
  ) {}

  setInjector(inject: (js: string) => void): void {
    this.inject = inject;
  }

  send(msg: NativeToPage): void {
    try {
      this.inject(buildCommandScript(msg));
    } catch {
      /* WebView not ready; commands are best-effort */
    }
  }

  command(command: EditorCommand, timeoutMs = 2000): Promise<CommandResult> {
    const id = this.nextId++;
    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.send({ kind: 'editor', id, command });
    });
  }

  /** Parses a raw WebView message; resolves command results. Returns the message or null. */
  handleRaw(raw: string): PageToNative | null {
    const msg = parsePageMessage(raw, this.token);
    if (!msg) return null;
    if (msg.kind === 'commandResult') {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.resolve({ ok: msg.ok, error: msg.error, clipboardText: msg.clipboardText });
      }
    }
    return msg;
  }

  /** Call when the page reloads: outstanding commands can no longer complete. */
  reset(): void {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'page-reloaded' });
    });
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

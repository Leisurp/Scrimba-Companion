/**
 * Native-side handling of the page protocol: building injected scripts, serialising
 * commands and validating incoming messages.
 */
import {
  PAGE_BOOT_CONFIG,
  PAGE_GLOBAL,
  PAGE_TOKEN,
  type NativeToPage,
  type PageToNative,
  type RuntimeConfig,
} from '../shared/protocol';
import { EARLY_SCRIPT, MAIN_SCRIPT } from '../injected/generated/bundles';

const KINDS: ReadonlySet<string> = new Set<PageToNative['kind']>([
  'ready',
  'location',
  'editorState',
  'lineState',
  'commandResult',
  'playback',
  'physicalKeyboard',
  'modules',
  'log',
  'diagnostics',
  'snapshot',
  'layoutState',
  'execution',
  'clipboard',
  'pasteRequest',
]);

/** Cryptographically weak is fine: the token only separates our runtime from other frames. */
export function createSessionToken(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.floor(random() * 0xffffffff).toString(36);
  return s;
}

/** JSON embedded in a <script>-less JS string: escape characters that could end the literal. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(/<\/script/gi, '<\\/script');
}

/**
 * The WebView injects into every top-level page it shows, including sign-in pages
 * (github.com, Google, …). The runtime, and with it the session token that lets a page
 * talk to the app (clipboard, snapshots), must only ever run on Scrimba itself.
 */
const SCRIMBA_HOST_RE = /^(www\.)?scrimba\.com$/;
export const SCRIMBA_PAGE_CHECK = `(location.protocol==='https:'&&${SCRIMBA_HOST_RE.toString()}.test(location.hostname))`;

export function buildEarlyScript(): string {
  return `if(${SCRIMBA_PAGE_CHECK}){\n${EARLY_SCRIPT}\n}\ntrue;`;
}

export function buildMainScript(config: RuntimeConfig, token: string): string {
  return `if(${SCRIMBA_PAGE_CHECK}){(function(){try{window.${PAGE_BOOT_CONFIG}=${jsLiteral(config)};window.${PAGE_TOKEN}=${jsLiteral(token)};}catch(e){}})();\n${MAIN_SCRIPT}\n}\ntrue;`;
}

/** Messages are only accepted while the WebView shows Scrimba itself (not a sign-in page). */
export function isScrimbaPageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && SCRIMBA_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Script passed to injectJavaScript() to deliver one command. Commands can carry the user's
 * clipboard (paste), so they are only delivered while the WebView shows Scrimba.
 */
export function buildCommandScript(msg: NativeToPage): string {
  return `if(${SCRIMBA_PAGE_CHECK})(function(){var r=window.${PAGE_GLOBAL};if(r&&r.receive){r.receive(${jsLiteral(msg)});}})();true;`;
}

/**
 * Parses and validates a raw `onMessage` payload. Returns null for anything that does not
 * come from this session's runtime (wrong token) or does not match the protocol shape.
 */
export function parsePageMessage(raw: string, token: string): PageToNative | null {
  if (typeof raw !== 'string' || raw.length > 2_000_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const env = parsed as { t?: unknown; m?: unknown };
  if (typeof env.t !== 'string' || env.t !== token || !token) return null;
  const m = env.m as { kind?: unknown } | null;
  if (!m || typeof m !== 'object' || typeof m.kind !== 'string' || !KINDS.has(m.kind)) return null;
  const msg = m as PageToNative;
  switch (msg.kind) {
    case 'commandResult':
      if (typeof msg.id !== 'number' || typeof msg.ok !== 'boolean') return null;
      if (msg.clipboardText !== undefined && typeof msg.clipboardText !== 'string') return null;
      break;
    case 'location':
      if (typeof msg.location !== 'string') return null;
      break;
    case 'snapshot':
      if (typeof msg.content !== 'string' || typeof msg.modelUri !== 'string' || typeof msg.location !== 'string') return null;
      break;
    case 'lineState':
      if (!msg.line || typeof msg.line.text !== 'string' || typeof msg.line.lineNumber !== 'number') return null;
      break;
    case 'editorState':
      if (!msg.state || typeof msg.state.focused !== 'boolean') return null;
      break;
    case 'playback':
      if (!['playing', 'paused', 'unknown'].includes(msg.state)) return null;
      break;
    case 'clipboard':
      if (typeof msg.text !== 'string') return null;
      break;
    default:
      break;
  }
  return msg;
}

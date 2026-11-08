import type { DiagnosticsSnapshot } from './store';
import { redactDeep, redactText } from './redact';

export interface NativeInfo {
  appVersion: string;
  buildVersion: string;
  platform: string;
  osVersion: string;
  deviceModel: string;
  isDevice: boolean;
}

/** Derives the System WebView / Chromium major version from the page user agent. */
export function webViewVersionFromUA(ua: string): string {
  const chrome = /Chrome\/([0-9.]+)/.exec(ua);
  if (chrome) return `Chromium ${chrome[1]}`;
  const webkit = /AppleWebKit\/([0-9.]+)/.exec(ua);
  const os = /OS ([0-9_]+) like Mac/.exec(ua);
  if (webkit) return `WebKit ${webkit[1]}${os ? ` (iOS ${os[1].replace(/_/g, '.')})` : ''}`;
  return 'unknown';
}

/**
 * Builds the exportable report. The editor state contains only positions and counts;
 * recovery snapshots and code are never included. All text passes through redaction.
 */
export function buildReport(snapshot: DiagnosticsSnapshot, native: NativeInfo, settings: unknown): string {
  const page = snapshot.page;
  const body = {
    generatedAt: new Date().toISOString(),
    app: native,
    webView: page ? webViewVersionFromUA(page.userAgent) : 'not reported',
    compatMode: snapshot.compatMode,
    runtimeReady: snapshot.runtimeReady,
    physicalKeyboard: snapshot.physicalKeyboard,
    navigation: snapshot.navigation,
    playback: snapshot.playback,
    editor: snapshot.editor
      ? { ...snapshot.editor, contentHash: snapshot.editor.contentHash ? '[present]' : null, modelUri: snapshot.editor.modelUri ? '[present]' : null }
      : null,
    modules: snapshot.modules,
    page,
    settings,
    nativeLogs: snapshot.logs.slice(-150),
  };
  const json = JSON.stringify(redactDeep(body), null, 2);
  return redactText(
    `Scrimba Companion diagnostic report\n` +
      `(Unofficial app. Redacted: no passwords, cookies, tokens, code or query strings.)\n\n` +
      json,
  );
}

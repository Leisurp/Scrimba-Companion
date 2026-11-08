# Architecture

```
┌──────────────────────────── React Native (Expo SDK 58, RN 0.88, TypeScript strict) ────────────────────────────┐
│ App.tsx → SettingsProvider → BrowserScreen                                                                      │
│   NavBar (back/forward/refresh/full-screen/preview/rotate/settings, collapsible)                                │
│   ExecutionNotice · OfflineBanner · ErrorScreen                                                                 │
│   ScrimbaWebView  ── single long-lived react-native-webview (Android System WebView / WKWebView)                │
│   BridgeInput (optional native text-input bridge) · CodingToolbar (above the keyboard)                          │
│   SettingsSheet · DiagnosticsPanel (hidden: tap version 7×)                                                     │
│                                                                                                                 │
│ PageBridge ── injectJavaScript(NativeToPage) ──►  page runtime  ──► postMessage({t: token, m: PageToNative})    │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                     │ injectedJavaScriptBeforeContentLoaded: EARLY_SCRIPT   (media + History hooks)
                     │ injectedJavaScript:                    MAIN_SCRIPT    (compat runtime, window.__SC__)
                     ▼
┌─────────────────────────────── Page runtime (src/injected, bundled by esbuild) ──────────────────────────────────┐
│ core: bridge, logger, guarded module context, tracked listeners, scoped <style>                                │
│ modules:  editor · keyboard · playback · subtitles · fullscreen · layout · navigation · execution              │
│ Each module: init / tick (SPA re-detection) / onConfig / status → diagnostics. Errors are caught and counted.  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Directories

| Path | What |
|---|---|
| `src/shared/` | Protocol types and constants shared by the native side and the page runtime (no RN imports). |
| `src/injected/` | Page runtime. `entries/` are esbuild entry points; `generated/bundles.ts` is the committed output (Hermes cannot `toString()` functions). |
| `src/webview/` | Native side of the bridge: script builders, message validation, `PageBridge`, URL policy, user agents. |
| `src/components/`, `src/screens/` | React Native UI. |
| `src/state/` | Settings (AsyncStorage), last lesson, recovery snapshots (app sandbox files). |
| `src/diagnostics/` | Native log store, redaction, report export. |
| `plugins/` | Expo config plugins (Windows CMake path limit, optional release signing). |
| `tests/` | Jest: `unit/` + `components/` (jest-expo), `injected/` (jsdom + esbuild transform). |
| `e2e/` | Playwright: `specs/` against a Scrimba-shaped fixture with real `monaco-editor`; `live/` against scrimba.com (opt-in). |
| `scripts/` | `build-injected.mjs`; `android-device-test.mjs` (real app + real WebView + adb input). |

## Key decisions

* **Real site, real editor.** No content is copied or recreated, and no private APIs are used.
  Editing goes through Monaco's documented public API, which Scrimba exposes as `window.monaco`.
* **Capability detection over DOM assumptions.** Hashed class names are never used. Selectors are
  stable custom-element tags (`si-monaco-editor`, `scrim-play-controls`, `ide-clip-captions`) plus
  computed-style checks, with generic fallbacks (`*-editor` hosts, accessible Play/Pause labels,
  `*caption*` tags).
* **Pause only, never resume.** Editing, backgrounding, audio-route changes and OS media
  interruptions pause playback. Resuming is always the user's tap.
* **Single WebView.** Changing the compatibility mode changes the user agent and reloads in place
  (cookies and history kept). The WebView is only re-created after the render process dies, and it
  then returns to the last URL.
* **Mobile UA by default** on both platforms: the keyboard bug is capability-based, so Desktop mode
  does not fix it, and the mobile UA keeps sign-in providers working. Desktop is a manual override.
* **Security.** Only `https://scrimba.com`, sign-in hosts and (in sub-frames) runner hosts load in
  the WebView. Other links open in the system browser; `file:`, `intent:` and `javascript:` are
  blocked. The early and main scripts and every native→page command are wrapped in a check for
  `https://(www.)scrimba.com`, so nothing runs on sign-in pages (github.com, Google) or on the
  learner-code origin (`cw1.scrimba.com`). Messages need a per-session token (kept in a closure)
  and are only accepted while the WebView's URL is scrimba.com. `window.__SC__` is a frozen,
  non-writable facade (receive, diagnostics, config, tick, stop): page scripts can't reach the app
  bridge or swap in their own command receiver. The selection menu and handles act only on
  trusted (real) input events. Diagnostics collect counts and tag names, never key values, code,
  cookies or query strings, and are redacted again on export. Nothing is sent anywhere
  automatically.
* **Storage.** Preferences, last lesson and the pending GitHub sign-in `state` live in AsyncStorage;
  recovery snapshots are files in the app sandbox (no SQLite needed). Authentication stays in the
  WebView cookie store. `android.allowBackup` is off, so none of it goes into cloud backups.

## Data flow for one toolbar key

1. User presses `{ }` in `CodingToolbar` (a native view; focus stays in the WebView).
2. `BrowserScreen` → `PageBridge.command({type:'insertPair', open:'{', close:'}'})` →
   `injectJavaScript("window.__SC__.receive(...)")`.
3. The editor module runs `pushUndoStop` → `executeEdits` → sets the cursor between the pair →
   `pushUndoStop`, then posts `commandResult` (and `lineState` in bridge mode).
4. Scrimba's own model listeners see the change (dirty flag, branch, recording-safe).

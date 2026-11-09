# Compatibility findings: Scrimba on mobile WebViews

Investigated on 2026-11-06 against the live site (public scrim `https://scrimba.com/s0v687325e`, no
login) in desktop Chromium, mobile emulation (Chromium + WebKit with real touch events) and the
**real Android System WebView 133** inside this app on an Android 16 emulator.
Scrimba can change at any time; the live suite (`npm run test:live`) and the on-device script
(`npm run test:android`) re-check these facts.

## 1. What the editor is

| Fact | Evidence |
|---|---|
| The IDE is an Imba single-page app built from custom elements (`app-ide`, `scrim-view`, `si-monaco-editor`, `scrim-play-controls`, `ide-clip-captions`, `op-ui-clipboard`, …). | DOM inspection |
| The code editor is **Monaco** (VS Code's editor), and `window.monaco` is exposed with the public API (`monaco.editor.getEditors()`). | `typeof monaco.editor.getEditors === 'function'` |
| Monaco runs in **textarea input mode** (`editContext: false`): keystrokes go to a hidden `textarea.inputarea`. | `editor.getOption(EditorOption.editContext) === false` |
| The editor is not read-only (`readOnly=false`, `domReadOnly=false`), on desktop or with a mobile UA. | `getOption` |
| No iframe boundary for the editor: Monaco lives in the main document. Iframes exist only for the runner/preview (`stackblitz.com/headless`, `*.webcontainer-api.io`). | iframe list |
| Typing into the editor **auto-pauses** the screencast and creates a local "branch" (URL becomes `/<scrim>/<branch>/head`). The header then shows "CTRL+S to save" and RUN/RERUN. | Observed on desktop and Android |
| Hotkeys are declared with `data-hotkey`: `mod+s` on `si-monaco-editor` (save), `space`/arrows on `scrim-play-controls`. | DOM attributes |

## 2. Why the Android keyboard never appears (root cause)

On touch devices Scrimba adds `touch-interface` to `<html>` and ships this rule (class names are
build-hashed):

```css
.wc-ag:is(.touch-interface :where(.wc-ag)) { pointer-events: none; }
```

`.wc-ag` is on **`si-monaco-editor`**, the editor host. With pointer events disabled, taps fall
through to the parent `si-file-view` (`document.elementFromPoint` over the code returns
`SI-FILE-VIEW`, not Monaco). Monaco never sees the tap, never focuses its textarea, and the platform
never shows a keyboard.

* The class is keyed on **touch capability**, not on the user agent, so "desktop site" mode does not
  help (an emulated Android UA still got `touch-interface`; a real Android WebView in either mode
  reports `maxTouchPoints > 0`).
* There is no user-agent or device gate on editing itself.

**Fix (keyboard module):** find where `pointer-events: none` *originates* between `.monaco-editor`
and its host (`*-editor` custom element) and mark it with `data-sc-pe-fix`, which a scoped rule
restores to `auto`. Monaco's own `pointer-events: none` layers are descendants with their own rules
and stay untouched. If pointer events are disabled *outside* the host (for example under Scrimba's
start cover), nothing is changed. A tap-focus assist also calls `editor.focus()` synchronously inside
`touchend` (so user activation is preserved) when Monaco did not focus itself.

Verified with real touch input:

| Environment | Without fix | With fix |
|---|---|---|
| Local fixture with real Monaco, Chromium + WebKit (Playwright touch) | tap does not focus | tap focuses; cursor placed at tap |
| scrimba.com, mobile Chromium + mobile WebKit emulation (`npm run test:live`) | tap does not focus | tap focuses; typing, undo, auto-pause work |
| **App on Android 16, System WebView 133, `adb input tap`** | n/a (fix on by default) | Monaco focused; **Gboard shown** (`mInputShown=true`) |
| **App on a OnePlus 12 (Android 16, WebView 156), signed in, own copy of a scrim (`…/head`)** | taps hit `<main>`; diagnostics said "editor not blocked" | taps reach `.view-line`; Monaco focused; soft-keyboard typing reaches Monaco (`insertText` events) |

**Signed-in layout (verified 2026-11-07 on the device over WebView DevTools).** When you are
signed in and open your own copy of a scrim, the editor host is **`editor-widget`**, not
`si-monaco-editor`. Chain: `scrim-view` (own `pointer-events:none`) → `main.$center` (`auto`) →
`editor-widget` (`none`, from a `.touch-interface` rule) → `div.$container` → `.monaco-editor`.
The host finder only matched tags ending in `-editor`, so it fell back to `div.$container`, saw
`none` on its parent and treated it as a cover. Host tags are now matched by `isEditorHostTag`
(a custom element with an `editor` segment), which covers both layouts.

### "Scrim unwritable due to syncing error" (Scrimba data, not the app)

Scrimba shows this toast once, then silently drops every edit, when it cannot replay a scrim's
saved edit stream (`IDE…Branch.syncBuffer` → an action's `decode` throws →
`c.addToStream is not a function`; `write()` then refuses while `Symbol.for('#syncError')` is set).

One case was traced in detail (2026-11-07, a signed-in learner's copy of a challenge,
`IDESolutionBranch`, stream `/op/stream/<scrim>/stream`):

* The bytes in the WebView were identical to the server's, and a standard msgpack decoder reads
  them, so nothing was corrupted in transit or by the WebView.
* Part of the stream was a fragment of the lesson preview's `index.html`
  (`…</style><script>SCRIMBA_REQUEST=…`) written in as raw bytes, so Scrimba's action decoder
  loses its place.
* That data was written from a regular mobile browser session before this app existed, so the
  cause is on Scrimba's side.
* Other scrims are unaffected. Recovery is on Scrimba's side (reset that challenge, or contact
  Scrimba support). The app doesn't try to patch Scrimba's stream decoder, since writing to a
  broken stream could make it worse.

### Touch text selection (selection module)

Monaco's touch support selects a word on double-tap only through its gesture recogniser, which
resets its tap count whenever a "change" (pan) event fires between the taps. Almost any finger
movement fires one, so on a phone a double-tap selects the word only some of the time. Monaco has
no selection handles and no Cut/Copy/Paste menu. (Scrimba sets `contextmenu: false`.)

The selection module adds, on touch devices (setting: *Phone-style text selection*, on by default):

* **Double-tap / long-press select the word under the finger**, using the first tap's point,
  Monaco's language word (`getWordAtPosition`: `myLeads`, CSS `main-title`) or a run of operator
  characters (`=>`, `===`). Double-tap window 400 ms / 40 px (Monaco uses 400 ms), tap slop 12 px,
  long press 450 ms.
* **Two Android-style handles** (an overlay outside Monaco) at the ends of the selection. Dragging one
  keeps the other end anchored, follows the finger with the grab offset, auto-scrolls at the
  editor's top/bottom edge, and re-positions on scroll/layout.
* **A floating menu**: Cut / Copy / Paste / Select all (Copy / Select all when read-only). Copy and Cut
  post `{kind:'clipboard', text}` to the app, which writes the system clipboard; Paste posts
  `{kind:'pasteRequest'}` and the app answers with the editor's `paste` command. Only messages with the
  main frame's session token are accepted, so the lesson preview iframe cannot write the clipboard.

Implementation notes found while testing:

* Monaco's gesture handler calls `stopPropagation()` on `touchend` in the bubble phase, so the module
  listens in the capture phase and handles the tap one task later, after Monaco's own handling.
* `getTargetAtClientPoint` hit-tests the DOM, and while dragging, the handle sits over the point being
  looked up (Monaco returned no position). The overlay is hidden for the duration of each lookup;
  the ongoing touch is unaffected because its target is fixed at `touchstart`.
* Touches on the handles and menu call `preventDefault()` on `touchstart`, so the editor keeps focus
  and the soft keyboard stays up.

Verified: unit tests; fixture e2e with real Monaco in Chromium and WebKit (double-tap, jittery
double-tap, long press, both handles, Cut/Copy/Paste/Select all, setting off); live scrimba.com in
mobile Chromium and WebKit; and on a OnePlus 12 (WebView 156) over WebView DevTools with synthetic
touch: double-tap, jittery double-tap, long press, end and start handle drags across lines; then
selection, handles and copy/paste by hand on the same phone (2026-11-07).

## 3. Input path and the bridge

* Soft-keyboard input on Android reaches Monaco through Chromium's IME (`beforeinput`/`input`,
  `keyCode 229`). Letters, punctuation, Enter (with Monaco auto-indent) and Backspace were verified on
  the emulator with Gboard installed.
* All toolbar actions use **Monaco's public command API** (`editor.trigger(...)`: `type`, `tab`,
  `outdent`, `undo`, `redo`, `paste`, `cursor*`, `deleteLeft`, `editor.action.commentLine`) and
  `executeEdits` for bracket pairs. They land in Monaco's model and undo stack and are seen by
  Scrimba's change listeners (Scrimba marks the file dirty and creates its branch). Toolbar
  insertions push undo stops so each is its own undo step.
* **Native text-input bridge (fallback, Settings → Typing method → Bridge):** a native `TextInput`
  mirrors the current line; each change is reduced to a single-range edit applied with
  `executeEdits`, and Enter/Backspace-at-start map to Monaco commands. The web keyboard is suppressed
  with `inputmode="none"` on Monaco's input. Note: Monaco's `domReadOnly` option alone does **not**
  set `readonly` unless `readOnly` is also on, so it cannot be used for this. Verified against real
  Monaco in the fixture (Chromium + WebKit). Not yet verified on a device; Direct mode works there,
  so the bridge is an opt-in fallback.
* **Save:** a synthetic `Ctrl/Cmd+S` keydown on Monaco's input **does** save on Android WebView
  (Scrimba's unsaved dot on the file tab and "CTRL+S to save" disappeared).
* **First keystrokes after an edit begins:** when Scrimba creates the branch on the first edit, keys
  injected *instantly* by `adb input text` were dropped (only the first character landed). Typing
  after that was reliable. Human typing speed has not been verified on a physical device.

## 4. Code execution: blocked in Android System WebView

Scrimba runs lesson code in a **StackBlitz WebContainer**. Even the HTML intro lesson starts
`npx --yes servor . index.html 8000` in its runner. WebContainers need `SharedArrayBuffer`, which
browsers only expose to **cross-origin-isolated** pages.

| Environment | `crossOriginIsolated` | `SharedArrayBuffer` | Runner |
|---|---|---|---|
| Desktop Chromium | `true` | available | WebContainer iframe created |
| Android System WebView 133 (in app) | **`false`** | **undefined** | Scrimba shows `DataCloneError: Failed to execute 'postMessage' on 'Worker': Shar…`; no WebContainer; the preview shows the recording's static snapshot and does not change after edit + save + run |

When the runner fails, Scrimba pops an error toast (`op-toast.error`, full message "…
SharedArrayBuffer transfer requires self.crossOriginIsolated"). Reproduced on live scrimba.com in
Chromium with COOP/COEP stripped (2026-11-06). The `execution` module hides only that toast, and
only in non-isolated pages, using a MutationObserver so it never paints; the live suite checks it.

This cannot be fixed from injected page scripts, and faking isolation would break other things.
The app therefore detects it (`execution` module) and shows a compact notice with
**Open in browser** (Chrome supports cross-origin isolation). Editing, saving, playback and
captions still work in the app.

Not verified: whether iOS WKWebView exposes cross-origin isolation for Scrimba (no macOS
available). Possible future work: embed GeckoView (which supports COOP/COEP) on Android. That
would be a fundamental architecture change.

Also noted: even in the desktop Chromium pane used for investigation, the preview did not visibly
update after a trusted edit + Ctrl+S + RERUN, so "edit → preview" was not confirmed anywhere during
this run. It needs checking on a phone's Chrome and in the app on iOS.

## 5. Playback, audio and captions

* Play/pause state comes from `scrim-play-controls op-icon.play`: its SVG class contains `pause`
  while playing and `play` while paused. A synthetic pointer + click sequence on the icon toggles
  playback (verified). `element.click()` alone and synthetic Space on the controls did not.
* Instructor audio is a **detached `HTMLAudioElement`** (`new Audio()`, WebM) with no `<audio>` in
  the DOM. The early script patches `HTMLMediaElement.prototype.play` to track these elements and
  record `play()` rejections.
* Captions are Scrimba's own `ide-clip-captions`: absolutely positioned, with a clipped background
  layer as the first child and per-word spans scrolled with a pixel `translate`. Restyling uses CSS
  `scale` (layout-neutral) rather than `font-size`, so Scrimba's line math still works. Caption text
  and timing are never read or regenerated. Captions are not rendered while you are in your own
  branch.

## 6. Full-screen editing

`app-ide` has a transform and `si-workspace-canvas` uses `container-type: size`, so
`position: fixed` resolves against them, and ancestors form stacking contexts. The full-screen
module marks the editor host as `position: fixed; inset: 0` and lifts each ancestor's `z-index`.
Scrimba's Monaco theme is **transparent** (`rgba(255,255,255,0)`) and the colour lives on
`si-file-view`, so the expanded host gets the first opaque ancestor background. Otherwise the
header and drawers show through, a bug found and fixed on the emulator. The real editor is reused,
so content, cursor, undo history and saving are unaffected.

## 7. Platform notes

* Android 16 edge-to-edge: React Native's keyboard height excludes the navigation bar, so the bottom
  safe-area inset must stay applied while the keyboard is up (otherwise the coding toolbar sat 24 dp
  under the keyboard; fixed).
* `react-native-webview` 14 with the New Architecture: `dataDetectorTypes` must be an **array**
  (`['none']`); a string crashes Android at view creation (`String cannot be cast to ReadableArray`).
* `react-native-webview` 14's TypeScript declaration `WebView<P = undefined>` collapses its props to
  `never`; the wrapper instantiates `WebView<object>`.
* On Android, `window.ReactNativeWebView` is visible to every frame, including the iframe that runs
  learner code. Messages are therefore stamped with a per-session token held only by the main frame.
* Google blocks its OAuth page inside embedded WebViews (`disallowed_useragent`). The app warns and
  does not spoof the user agent; use email/password or GitHub sign-in.
* GitHub's sign-in page hides "Continue with Google", "Continue with Apple" and "Sign in with a
  passkey" when the request carries Android WebView's `X-Requested-With` header (checked
  2026-11-06 with Playwright: same page with a desktop, Android Chrome or WebView user agent shows
  them; adding only the header hides them). The app does not strip the header or spoof the user
  agent to get around this.
* **GitHub sign-in through the browser (Android).** Traced 2026-11-07: Scrimba's "Continue with
  GitHub" opens a popup at `scrimba.com/auth/github`, which 302s to
  `github.com/login/oauth/authorize?client_id=…&redirect_uri=https://scrimba.com/auth/github/callback&state=…`
  without setting a cookie, so `state` is bound to the existing Scrimba session cookie. The popup
  resolves once the page sees a signed-in user. The app therefore:
  1. cancels the WebView's navigation to that authorize URL (directly, or GitHub's `/login?return_to=`
     form of it) and opens it in a Chrome Custom Tab (`expo-web-browser`, `createTask: false`), where
     GitHub shows "Continue with Google" and Google allows sign-in;
  2. is registered (app.json `intentFilters`, no `autoVerify`) for exactly
     `https://scrimba.com/auth/github/callback`. Android 12+ only routes unverified https links to an
     app after the user enables it under *Open by default*, so the first sign-in shows that one-time
     step;
  3. loads the returning callback in the WebView, whose session holds the matching `state`, then goes
     back to the page the user was on (Scrimba's callback page is built for a popup).
  The app stores only the pending `state` (15 min). A callback it did not start, e.g. the user
  signing in to Scrimba in Chrome, is reopened in a Custom Tab so Chrome can finish its own sign-in.
  A hint on github.com/login (reached any other way) still links to GitHub's password reset.

  **Verified on the Android 16 emulator (Chrome + System WebView, 2026-11-07):** "Continue with
  GitHub" in the app opens GitHub in a Custom Tab inside the app's task, with "Continue with
  Google", "Continue with Apple" and passkeys visible. Before the *Open by default* setting,
  `pm get-app-links` lists `scrimba.com` as *Disabled* (the user enables it once); afterwards only
  `/auth/github/callback` resolves to the app and lesson URLs still resolve to Chrome. A tap in the
  Custom Tab on a link that 302s to `scrimba.com/auth/github/callback?code=…&state=<pending state>`
  stands in for GitHub's final redirect: Chrome handed it to the app (`START … LAUNCH_SINGLE_TASK`),
  the Custom Tab closed, and the WebView requested the callback with its own cookies.
  A real sign-in (a GitHub account that uses "Continue with Google") was then confirmed on a
  OnePlus 12 (Android 16). With a fake `code` Scrimba never answered the WebView's request (with the
  wrong `state` it answers 400 at once, so the `state` check passed), which is why the app gives up
  after 20 s, returns to the page and asks the user to try again.
* The root view pads by `useSafeAreaInsets()` with `initialWindowMetrics`, not the native
  `SafeAreaView`, to avoid the toolbar briefly sitting under the status bar on cold start
  (reported intermittently on a OnePlus 12; not reproduced on the emulator).

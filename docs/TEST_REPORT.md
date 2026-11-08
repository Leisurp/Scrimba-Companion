# Test report: 2026-11-06

Environment: Windows 11, Node 22.22, JDK 17.0.20 (Temurin), Android SDK (platform 37, build-tools
37, NDK 27.1), Expo SDK 58 / React Native 0.88.1 / react-native-webview 14.0.1, Playwright 1.65
(Chromium 152-class, WebKit), Android 16 emulator (x86_64, Google APIs, **System WebView
133.0.6943.137**, Gboard). No macOS, Xcode or physical device was available.

Legend: **Verified** = observed working in the stated environment. **Verified (proxy)** = observed
in a browser engine standing in for a platform. **Unverified** = implemented, not observed.
**Blocked** = cannot work as specified, with evidence.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| Injected bundle freshness | `npm run check:injected` | pass |
| TypeScript (strict) | `npm run typecheck` | pass, 0 errors |
| ESLint (eslint-config-expo, React hooks rules) | `npm run lint` | pass, 0 problems |
| Jest: native logic, components, page runtime (jsdom) | `npm test` | **111 / 111 pass** |
| Playwright fixture with real Monaco: Chromium (Pixel 7) + WebKit (iPhone 14), real touch | `npm run test:e2e` | **33 pass, 1 skipped** (CDP-only IME test on WebKit) |
| Playwright live, real scrimba.com: Chromium + WebKit mobile emulation | `npm run test:live` | **2 / 2 pass** |
| On-device: installed release APK, real WebView, adb touch/keys | `npm run test:android` | **18 / 19** (the one failure is the execution blocker, expected) |
| Release APK build (Gradle, arm64-v8a + x86_64) | `./gradlew assembleRelease` | pass (≈39 MB, debug-signed) |

Unit and component tests use a fake Monaco to check command mapping only. They say nothing about
compatibility with Scrimba. The fixture suite uses real Monaco but not Scrimba. Only the live suite
and the on-device script touch the real site.

## Functional status

### P0: editing and execution

| Requirement | Status | Evidence |
|---|---|---|
| Tap code → keyboard (Android) | **Verified** (emulator) | `mInputShown=true` after `adb input tap` on the code; Gboard visible in screenshot |
| Tap code → focus (root cause fixed) | **Verified** (real WebView, live site in Chromium + WebKit) | Without fix: tap doesn't focus. With fix: focuses |
| Tap code → keyboard (iOS) | **Unverified** | WebKit proxy passes; no iOS device |
| Letters, punctuation, Enter/auto-indent, Backspace | **Verified** (emulator) | Model content read back after `adb input` |
| IME composition | **Verified (proxy)** Chromium CDP composition; Gboard key input on emulator | Swipe typing / CJK on a device unverified |
| Cursor movement, selection, copy/cut/paste, select all | **Verified (proxy)** real Monaco fixture; toolbar on emulator | System clipboard on device unverified |
| Undo/redo through Monaco history | **Verified** (emulator toolbar + fixture) | Each toolbar insert is one undo step |
| Changes reach Scrimba's editor | **Verified** | Scrimba marks the file dirty, creates its branch, shows "CTRL+S to save" |
| Save (Ctrl/Cmd+S) | **Verified** (emulator) | Scrimba's unsaved dot cleared after toolbar/synthetic save |
| Code execution in the app | **Blocked** (Android System WebView) | `crossOriginIsolated=false`, no `SharedArrayBuffer`; runner fails (`DataCloneError`); preview unchanged after edit + save + run. App shows notice + Open in browser |
| Code execution anywhere | **Unverified** | Not confirmed even in the desktop pane used for investigation |
| Native text-input bridge | **Verified (proxy)** real Monaco fixture (Chromium + WebKit) | Not run on a device |

### P1: playback, audio, subtitles

| Requirement | Status | Evidence |
|---|---|---|
| Screencast playback preserved | **Verified** (emulator, live site) | Plays; editor appears during playback |
| Auto-pause on edit, never auto-resume | **Verified** (emulator, fixture) | Play icon state; blur doesn't resume |
| Pause on app background | Unit-tested; **unverified** on device | |
| Audio: speaker / wired / Bluetooth / calls / focus | **Unverified** | Emulator ran with `-no-audio`; hooks implemented (media `pause` sync, `devicechange` pause, visibility pause) |
| Captions preserved + restyled | **Verified** detection (emulator, live); styling **verified (proxy)** in fixture | Visual check on device pending |

### P2: layout, full screen, preview, navigation

| Requirement | Status | Evidence |
|---|---|---|
| Portrait | **Verified** (emulator) | Screenshots |
| Landscape | **Verified** renders (emulator) | Screenshot; notice compacted after finding it too tall |
| Toolbar above keyboard (edge-to-edge) | **Verified** (emulator) | Bug found (24 dp overlap) and fixed |
| Toolbar scroll keeps keyboard open | **Verified** (emulator) | An edge-swipe closing it turned out to be Android's back gesture |
| Full-screen editor | **Verified** (emulator) | Bug found (transparent Monaco theme let header show through) and fixed |
| Expanded preview | **Verified (proxy)** fixture | Device unverified |
| Native nav bar, refresh guard | Built; partially exercised | Back/forward/refresh not scripted |

### P3: settings, storage, recovery, diagnostics, keyboards

| Requirement | Status | Evidence |
|---|---|---|
| Settings persistence, validation | **Verified** (unit) + developer mode survived app reinstalls on emulator | |
| Last-lesson resume | **Verified** (emulator) | Relaunch reopened the scrim |
| Login persistence | **Unverified** | No credentials used (by design) |
| Unsaved-edit recovery | **Verified** prompt (emulator); restore path unit/fixture tested | |
| Offline recovery UI | Unit/component level only; **unverified** on device | |
| Diagnostics + redaction | **Verified** (unit: no code, tokens, emails, query strings) | Export share sheet unverified on device |
| Hardware keyboard shortcuts | **Verified (proxy)** Ctrl+Z / Ctrl+Shift+Z in fixture; physical-keyboard detection | Device unverified |

### P4: build, CI, docs

| Item | Status |
|---|---|
| Android APK | **Built** locally; installed and run on emulator |
| iOS build | **Not built** (no macOS). EAS profiles configured |
| GitHub Actions (CI, release, live check) | Written; **not run** (no remote repository in this environment) |
| EAS build | Configured; **not run** (needs an Expo account) |

## Bugs found and fixed during verification

1. Android crash at launch: `dataDetectorTypes` string vs array under the New Architecture.
2. Windows build failure: CMake object paths longer than 260 characters → config plugin.
3. Coding toolbar partly hidden under the keyboard on edge-to-edge Android → padding fix.
4. Full-screen editor transparent over Scrimba's chrome → opaque ancestor background.
5. Bridge mode relied on `domReadOnly`, which Monaco ignores unless read-only → `inputmode="none"`.
6. Toolbar bracket pairs merged into the previous typing undo step → explicit undo stops.
7. Execution notice could be missed after a reload race → re-announce + status fallback.

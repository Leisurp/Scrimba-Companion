# Scrimba Companion

**An unofficial, open-source Android/iOS companion that makes [Scrimba](https://scrimba.com)'s
interactive screencasts usable on phones, above all their code editor.**

> Scrimba Companion is **not affiliated with, endorsed by, or sponsored by Scrimba**. It opens the
> real scrimba.com in a WebView, with your own account. It does not copy, download or recreate
> lessons, bypass sign-in, or use private APIs. Scrimba's name and content belong to their owners;
> this repository contains no Scrimba logos or artwork.

## Why

On Android, Scrimba lessons display fine, but tapping the code never brings up the keyboard. The
cause is a touch-only stylesheet rule that disables pointer events on the editor
([findings](docs/COMPATIBILITY_FINDINGS.md#2-why-the-android-keyboard-never-appears-root-cause)).
"Desktop site" mode doesn't help, because the rule depends on touch capability, not the user agent.

## Features

| | Feature | Status |
|---|---|---|
| ✅ | Tap code → keyboard opens in Scrimba's real Monaco editor (touch fix + tap-focus assist) | Verified on Android 16 emulator, real WebView |
| ✅ | Typing, punctuation, Enter + auto-indent, Backspace through the system keyboard | Verified on emulator (adb input) |
| ✅ | Coding toolbar above the keyboard: Tab/outdent, `{}` `()` `[]` `<>` quotes and backticks, `=>`, `;`, arrows, selection, undo/redo, copy/cut/paste/all, comment, Save, Run, Done. Horizontally scrollable | Verified on emulator (pairs, undo/redo, scroll keeps keyboard) |
| ✅ | Auto-pause when editing begins; never auto-resumes; pause on background / audio-route change / OS media interruption | Pause-on-edit verified on emulator; interruption handling **unverified** |
| ✅ | Full-screen editor (Scrimba's real editor expanded with CSS; no copy, so undo/cursor/save are kept) and expanded preview | Verified on emulator |
| ✅ | Subtitle size, background opacity, position; dim/hide while editing (restyles Scrimba's own captions) | Fixture + live-site verified; device visual check pending |
| ✅ | Collapsible native nav bar: back, forward, refresh (unsaved-changes guard), full-screen, preview, rotation, settings | Built; partly verified |
| ✅ | Mobile/Desktop site mode (reloads in place, keeps sign-in, warns about unsaved edits) | Built; unverified on device |
| ✅ | Phone-style text selection: double-tap or long-press selects the word every time, drag handles extend/shrink the selection, Cut / Copy / Paste / Select all menu | Verified in browser tests, live scrimba.com, and by hand on a OnePlus 12 (selection, handles, copy/paste) |
| ✅ | Hardware keyboards: Monaco's own shortcuts are left intact; coding toolbar auto-hides | Verified in browser tests; device unverified |
| ✅ | Last-lesson resume, login persistence (WebView cookies), preferences, light/dark/system theme | Resume verified on emulator |
| ✅ | Offline/error screen with automatic retry; local recovery of unsaved edits (asks first, undoable) | Recovery prompt verified on emulator |
| ✅ | Hidden diagnostics panel (Settings → tap version 7×) with redacted, user-initiated export | Built |
| ✅ | Native text-input bridge (Settings → Typing method → Bridge) as a fallback editing path | Verified against real Monaco in tests; not on device |
| ⚠️ | **Running code** | **Blocked in Android System WebView**: Scrimba's runner needs cross-origin isolation (SharedArrayBuffer), which the WebView lacks. The app says so and offers *Open in browser*. See [findings §4](docs/COMPATIBILITY_FINDINGS.md#4-code-execution-blocked-in-android-system-webview) |

## Screenshots

_Placeholders: screenshots of scrimba.com aren't committed because they show Scrimba's content._
Run `npm run test:android` to produce your own in `device-test-output/`.

| Keyboard + coding keys | Full-screen editor | Settings |
|---|---|---|
| `docs/screenshots/keyboard.png` (placeholder) | `docs/screenshots/fullscreen.png` (placeholder) | `docs/screenshots/settings.png` (placeholder) |

## Install on Android (APK)

1. Get an APK: from a GitHub Actions **Release builds** run (artifact / draft release) or by
   building one yourself (below). A locally built one is at `dist/scrimba-companion-<version>-*.apk`.
2. On the phone, allow installing apps from your browser or file manager (Settings → Apps →
   Special access → Install unknown apps).
3. Open the APK and install. Requires Android 7.0+ (API 24) and an up-to-date
   *Android System WebView* (Play Store).
4. Sign in to Scrimba. **Continue with GitHub** opens GitHub in your browser (Chrome Custom Tab),
   where every GitHub sign-in option works, including "Continue with Google". GitHub then sends
   you back to the app, which finishes the sign-in. One-time setup: Android settings → Apps →
   Scrimba Companion → Open by default → Add link → tick `scrimba.com` (the app offers a shortcut
   the first time). Email sign-in works in the app as well. Scrimba's own "Continue with Google"
   does not: Google blocks its sign-in page inside embedded app browsers.

APKs built without the release-keystore secrets are signed with a debug key. They install fine,
but an APK signed with a different key can't upgrade them in place (uninstall first).

## Development

Requirements: Node 22, JDK 17, Android SDK (platform 37, build-tools 37, NDK 27.1, CMake 3.22)
for local Android builds; macOS + Xcode 16+ for local iOS builds. Or use EAS cloud builds.

```bash
npm install
```

```bash
npm run build:injected
```

```bash
npx expo prebuild --platform android
```

```bash
npm run android
```

`npm run android` builds a development build and starts Metro. After editing anything in
`src/injected/`, run `npm run build:injected` (CI checks that the committed bundle is current).

### Tests

```bash
npm run verify
```

```bash
npx playwright install chromium webkit
```

```bash
npm run test:e2e
```

```bash
npm run test:live
```

```bash
npm run test:android
```

* `verify`: bundle freshness, TypeScript, ESLint, Jest (native logic, components, page runtime in
  jsdom).
* `test:e2e`: runtime against **real `monaco-editor`** in a Scrimba-shaped fixture, with real touch
  input on Chromium (≈ Android WebView engine) and WebKit (≈ iOS engine).
* `test:live`: opt-in, against the real scrimba.com (public scrim, no login, nothing saved).
* `test:android`: the installed app on an emulator or USB phone with real `adb` touch/keyboard
  input. Enable Developer mode in the app first (Settings → tap the version 7×) so DevTools can
  attach for observation. Set `ADB` if adb isn't on PATH.

Mocked tests don't establish compatibility with Scrimba. See [the test report](docs/TEST_REPORT.md)
and the [device checklist](docs/DEVICE_TEST_CHECKLIST.md).

### Building releases

Local release APK (debug-signed unless you pass the signing properties; debug-signed APKs are
for testing only, never publish one):

```bash
cd android && ./gradlew assembleRelease
```

With your own keystore (kept outside the repository, never committed). Gradle reads
`ORG_GRADLE_PROJECT_*` environment variables as project properties, which keeps the passwords
off the command line:

```bash
export ORG_GRADLE_PROJECT_SC_RELEASE_STORE_FILE=/abs/path/release.jks
export ORG_GRADLE_PROJECT_SC_RELEASE_STORE_PASSWORD=...
export ORG_GRADLE_PROJECT_SC_RELEASE_KEY_ALIAS=...
export ORG_GRADLE_PROJECT_SC_RELEASE_KEY_PASSWORD=...
cd android && ./gradlew assembleRelease
```

The **Release builds** workflow signs with the `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` repository secrets, and
refuses to draft a GitHub Release without them.

EAS (needs a free Expo account; `npx eas-cli@latest login`, then `npx eas-cli@latest init` once to
add the project ID):

```bash
npx eas-cli@latest build --platform android --profile preview
```

**Windows notes:** `sdkmanager.bat` fails if the SDK path contains spaces; Gradle/CMake needs short
paths (`plugins/withCmakeObjectPathMax.js` handles object paths). This repo was built on Windows
with the SDK under a `subst` drive letter.

## iOS

The app code is cross-platform. iOS-specific pieces: WKWebView configuration (inline media,
`keyboardDisplayRequiresUserAction={false}`, optional hidden keyboard accessory bar, shared
cookies, popups allowed so Scrimba's "Continue with GitHub" opens in the same WebView), the
`modules/audio-session` module (lesson audio plays with the silent switch on) and
`modules/web-data` (Sign out and clear data). **It has not been run on an iPhone yet**; CI's
`ios-build` job compiles it on macOS. The WebKit Playwright projects (fixture + live site) are the
closest functional signal.

Differences from Android:

* **Sign-in.** iOS has no equivalent of Android's "Open by default" link handover for
  scrimba.com, so GitHub sign-in stays inside the WebView. GitHub shows "Continue with Google"
  there, but Google blocks its sign-in page in embedded app browsers; use Scrimba email/password
  or a GitHub password (+ 2FA). Passkeys are not available to WKWebView in apps.
* **Code execution** depends on whether WKWebView reports `crossOriginIsolated` for Scrimba's
  runner. The app detects this at runtime and shows the "Open in browser" notice if not.
* **iPad orientation lock** may be ignored (iPadOS 27 always allows resizing).

Building without a Mac:

1. **CI (no Apple account):** the `ios-build` job in `.github/workflows/ci.yml` runs on pushes
   (or *Run workflow*) and uploads an **unsigned** `.ipa`. It installs on an iPhone only after
   re-signing with your own Apple ID in a sideloading tool (free Apple IDs: re-sign every 7 days).
2. **EAS (Apple Developer Program, $99/yr):** `npx eas-cli@latest build --platform ios --profile preview`
   for an internal build (register the phone first with `npx eas-cli@latest device:create`), or
   `--profile production` then `npx eas-cli@latest submit --platform ios` for TestFlight/App Store.
   EAS manages certificates and provisioning profiles.
3. `--profile preview-ios-simulator` builds for the iOS Simulator (no Apple account; needs a Mac
   to run).

On a Mac: `npx expo prebuild --platform ios`, then `npx expo run:ios`, or open
`ios/*.xcworkspace` in Xcode, set your Team under Signing & Capabilities and run on a device.
Forks: change `ios.bundleIdentifier` in `app.json` to one you own.

Check on a device (see `docs/DEVICE_TEST_CHECKLIST.md`): keyboard on tap, captions, audio with the
silent switch on and with AirPods, GitHub sign-in, and `crossOriginIsolated` for the runner.

## Privacy and security

* **Your sign-in stays with the WebView.** Scrimba's session cookie lives only in Android's WebView
  cookie store inside the app's private storage. The app never reads, logs or exports cookies, and
  never sees your password: GitHub sign-in happens in your browser.
* **No cloud backup of app data.** `allowBackup` is off, so the session isn't copied into Google
  backups or phone-to-phone transfers.
* **What the app stores on the phone:** your settings, the path of your last lesson (no query
  strings), the state value of an unfinished GitHub sign-in (15 minutes, never the OAuth `code`),
  and local copies of unsaved code edits for recovery (7 days, at most 20 files).
* **No analytics, no tracking, no servers of our own.** Nothing leaves the phone unless you export
  a diagnostics report yourself; reports contain no cookies, code or URL query strings.
* **The app's page code runs only on scrimba.com.** It isn't injected into sign-in pages, the app
  ignores messages from any other page, and the Cut / Copy / Paste menu only reacts to real taps.
* **Sign out and clear data** (Settings → Session) removes the WebView's cookies, site storage and
  cache, the saved copies of unsaved code and the last lesson. Your app settings are kept.
* **Permissions:** internet, network state, wake lock (keep the screen on during playback). No
  camera, microphone, location or storage access.
* **Developer mode** (tap the version in Settings → About 7 times) turns on WebView debugging,
  which lets a computer you've authorised over USB inspect the page, including your session.
  Leave it off unless you're debugging.
* **Only install APKs from this repository's releases.** Release APKs are signed with the
  project's own key. Debug-signed builds use a public key and are for local testing only.

Found a security issue? Please report it privately; see [SECURITY.md](SECURITY.md).

## Known limitations

* **Code execution doesn't work in Android System WebView** (no cross-origin isolation, so no
  `SharedArrayBuffer` for Scrimba's WebContainer runner). Use *Open in browser*. Editing, saving,
  playback and captions still work in the app.
* Scrimba's "Continue with Google" is blocked by Google inside embedded WebViews. GitHub sign-in
  (including GitHub's own "Continue with Google") goes through the browser instead; it needs the
  one-time "Open by default → scrimba.com" setting so GitHub's redirect returns to the app.
* Scrimba's own "DataCloneError" toast (its runner failing without cross-origin isolation) is
  hidden; the app's *Code can't run* notice replaces it.
* Very fast injected input right at the first edit of a lesson can drop characters while Scrimba
  creates your branch (seen with `adb`); human-speed typing still needs checking on a real phone.
* iOS is unbuilt and unverified. On Android, a OnePlus 12 (Android 16) has been checked by hand
  (keyboard, signed-in editing, text selection, GitHub sign-in through the browser);
  Bluetooth/wired audio, calls and hardware keyboards haven't been verified on a device yet.
* Scrimba can change its site at any time; the compatibility modules detect capabilities and fail
  safely, but may need updates. Run `npm run test:live` to check.

## Project docs

* [Architecture](docs/ARCHITECTURE.md)
* [Compatibility findings](docs/COMPATIBILITY_FINDINGS.md)
* [Test report](docs/TEST_REPORT.md)
* [Physical-device checklist](docs/DEVICE_TEST_CHECKLIST.md)

## License

MIT for the original code in this repository. See [LICENSE](LICENSE).

# Development guide

Scrimba Companion is an [Expo](https://expo.dev) (SDK 58) / React Native app. One long-lived
WebView shows the real scrimba.com; a small page script (`src/injected/`) fixes the editor on touch
screens and talks to the app. See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit.

## Requirements

- Node 22
- Android: JDK 17 and the Android SDK (platform 37, build-tools 37, NDK 27.1, CMake 3.22)
- iOS: macOS with Xcode 26.4+ (or build in the cloud, see below)

## Run it

```bash
npm install
```

```bash
npm run build:injected
```

```bash
npm run android
```

`npm run android` makes a development build, installs it and starts Metro. The `android/` and
`ios/` folders are generated (`npx expo prebuild`); configure native behaviour in `app.json` and
`plugins/` instead of editing them.

After changing anything in `src/injected/`, run `npm run build:injected` again: the bundle in
`src/injected/generated/` is committed and CI checks that it's current.

## Tests

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

| Command | What it checks |
|---|---|
| `verify` | Bundle is current, TypeScript, ESLint, Jest (app logic, components, page script in jsdom) |
| `test:e2e` | The page script against the real `monaco-editor` in a Scrimba-shaped page, with real touch input in Chromium (≈ Android WebView) and WebKit (≈ iOS) |
| `test:live` | Against the real scrimba.com (public lesson, no sign-in, nothing saved) |
| `test:android` | The installed app on an emulator or USB phone with real `adb` input. Turn on Developer mode in the app first (Settings → tap the version 7 times) so DevTools can attach. Set `ADB` if adb isn't on your PATH |

Mocked tests don't prove that something works on Scrimba. Check the live site and a real device
before calling a compatibility fix done; see [TEST_REPORT.md](TEST_REPORT.md) and
[DEVICE_TEST_CHECKLIST.md](DEVICE_TEST_CHECKLIST.md).

## Release builds

Releases are built by GitHub Actions; see [RELEASING.md](RELEASING.md). Local release APK:

```bash
cd android && ./gradlew assembleRelease
```

Without signing settings this APK uses Expo's public debug key. That's fine for your own testing,
but never share one: anyone can sign an "update" with that key. To sign with your own key, set
these environment variables first (Gradle reads them as project properties, which keeps passwords
off the command line):

```bash
export ORG_GRADLE_PROJECT_SC_RELEASE_STORE_FILE=/abs/path/release.jks
export ORG_GRADLE_PROJECT_SC_RELEASE_STORE_PASSWORD=...
export ORG_GRADLE_PROJECT_SC_RELEASE_KEY_ALIAS=...
export ORG_GRADLE_PROJECT_SC_RELEASE_KEY_PASSWORD=...
```

Cloud builds with EAS need a free Expo account (`npx eas-cli@latest login`, then
`npx eas-cli@latest init` once):

```bash
npx eas-cli@latest build --platform android --profile preview
```

**Windows:** `sdkmanager.bat` fails if the SDK path contains spaces, and Gradle/CMake needs short
paths (`plugins/withCmakeObjectPathMax.js` handles object paths). Putting the project or SDK under
a `subst` drive letter works.

## iOS

The app code is shared. iOS-specific pieces: the WKWebView settings (inline media, keyboard from
`focus()`, optional hidden keyboard bar, popups opened in the same WebView for Scrimba's
"Continue with GitHub"), `modules/audio-session` (lesson audio plays with the silent switch on)
and `modules/web-data` (Sign out and clear data). It compiles in CI but **hasn't been run on an
iPhone yet**; the WebKit Playwright projects are the closest signal.

Differences from Android:

- **Sign-in:** iOS has no equivalent of Android's "Open by default" for scrimba.com links, so
  GitHub sign-in stays inside the WebView. Google blocks its sign-in page there; use Scrimba
  email/password or a GitHub password (+ 2FA).
- **Running code** depends on whether WKWebView reports `crossOriginIsolated` for Scrimba's
  runner. The app checks at runtime and shows "Open in browser" if not.
- **iPad orientation lock** may be ignored (iPadOS always allows resizing).

Ways to build:

1. **GitHub Actions (no Apple account):** the `ios-build` CI job checks that it compiles, and the
   Release workflow attaches an **unsigned** `.ipa` to each release, installable after re-signing
   with a sideloading app and your Apple ID.
2. **EAS (Apple Developer Program):** `npx eas-cli@latest build --platform ios --profile preview`
   for internal devices (register them with `npx eas-cli@latest device:create`), or
   `--profile production` and `npx eas-cli@latest submit --platform ios` for TestFlight.
3. **On a Mac:** `npx expo prebuild --platform ios`, then `npx expo run:ios`, or open
   `ios/*.xcworkspace` in Xcode, set your Team under Signing & Capabilities and run.

Forks: change `android.package` and `ios.bundleIdentifier` in `app.json` to IDs you own.

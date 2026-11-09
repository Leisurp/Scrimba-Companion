# Scrimba Companion

**An unofficial, open-source Android/iOS companion that makes [Scrimba](https://scrimba.com)'s
interactive screencasts usable on phones, above all their code editor.**

> Scrimba Companion is **not affiliated with, endorsed by, or sponsored by Scrimba**. It opens the
> real scrimba.com in a WebView, with your own account. It does not copy, download or recreate
> lessons, bypass sign-in, or use private APIs. Scrimba's name and content belong to their owners;
> this repository contains no Scrimba logos or artwork.

## Why?

Scrimba lessons play fine in a phone browser, but you can't edit the code: tapping it never brings
up the keyboard. This app opens Scrimba as usual and fixes that, so you can pause a lesson and
code along on your phone.

## What you get

- **Edit the code on your phone.** Tap the code and the keyboard opens, just like on a computer.
- **Coding keys above the keyboard:** Tab, brackets, quotes, `=>`, arrow keys, undo/redo, copy and
  paste, comment, save and run.
- **Easy text selection:** double-tap or long-press a word, then drag the handles to select more.
- **The lesson pauses when you start typing**, and stays paused until you press play.
- **Full-screen editor** and a bigger preview when you need the space.
- **Subtitles you can read:** change their size, background and position, or hide them while you
  type.
- **Picks up where you left off:** reopens your last lesson and keeps you signed in.
- **Unsaved changes are kept** if the app closes unexpectedly, and you're offered them back.
- Light and dark mode, and works in portrait or landscape.

## Download

Get the latest version from the [**Releases page**](https://github.com/Leisurp/Scrimba-Companion/releases/latest).

### Android

1. On your phone, download
   [**ScrimbaCompanion.apk**](https://github.com/Leisurp/Scrimba-Companion/releases/latest/download/ScrimbaCompanion.apk).
2. Open it. If Android asks, allow your browser to install apps, then tap **Install**.
3. Open Scrimba Companion and sign in to Scrimba.

Needs Android 7.0 or newer. To update, install the new APK over the old one; you stay signed in.
Want automatic updates? Add this repository's URL to [Obtainium](https://obtainium.imranr.dev/).

### iPhone (experimental)

The iPhone version builds, but hasn't been tested on a real iPhone yet. Apple doesn't allow
installing apps from outside the App Store directly, so you install it with a sideloading app and
your own Apple ID:

1. Install [AltStore](https://altstore.io/), [SideStore](https://sidestore.io/) or
   [Sideloadly](https://sideloadly.io/) (follow their setup guide).
2. Download
   [**ScrimbaCompanion-unsigned.ipa**](https://github.com/Leisurp/Scrimba-Companion/releases/latest/download/ScrimbaCompanion-unsigned.ipa)
   and open it with that app.

With a free Apple ID, the app has to be refreshed every 7 days (the sideloading app can do this
for you).

## Good to know

- **Running code opens in your browser.** Android's built-in web view lacks a browser feature
  Scrimba's code runner needs, so when a lesson runs code the app shows an **Open in browser**
  button. Editing, saving, playback and subtitles all work in the app.
- **Signing in:** use your Scrimba email and password, or **Continue with GitHub**. Scrimba's
  **Continue with Google** doesn't work in any app (Google blocks it). On Android, GitHub sign-in
  opens in your browser, so a GitHub account that uses Google works too.
- Scrimba can change their site at any time. If something stops working, please
  [open an issue](https://github.com/Leisurp/Scrimba-Companion/issues).

## Troubleshooting

- **"Continue with GitHub" doesn't bring me back to the app (Android):** the first time, the app
  asks you to allow it to open scrimba.com links. You can do this any time in Android Settings →
  Apps → Scrimba Companion → Open by default → Add link → tick **scrimba.com**.
- **The keyboard doesn't open:** tap directly on a line of code. If it still doesn't open, update
  **Android System WebView** from the Play Store.
- **"App not installed" when updating:** you probably had an early test build. Uninstall it, then
  install the APK from the Releases page.
- **Sign out completely:** Settings → **Sign out and clear data**.

## Privacy

- **No ads, analytics or tracking.** The app has no servers of its own and sends nothing anywhere.
  The only site it opens is Scrimba (plus GitHub when you sign in with it).
- **Your sign-in stays on your phone**, in the system web view, the same as in a browser. The app
  never reads your password or cookies, and it isn't included in cloud backups.
- **What's saved on your phone:** your settings, your last lesson, and copies of unsaved code
  (deleted after 7 days). **Settings → Sign out and clear data** removes everything except your
  settings.
- **Permissions:** internet only (plus keeping the screen on while a lesson plays). No camera,
  microphone, location or files.

Found a security problem? Please report it privately: see [SECURITY.md](SECURITY.md).

## For developers

The app is built with Expo / React Native. It hosts the real Scrimba site in one WebView and adds a
small script that fixes the editor on touch screens.

- [Development guide](docs/DEVELOPMENT.md): building, running and testing
- [How it works](docs/ARCHITECTURE.md)
- [What we found out about Scrimba on phones](docs/COMPATIBILITY_FINDINGS.md)
- [Releasing](docs/RELEASING.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE). Scrimba is a trademark of its owners; this project only links to their site.

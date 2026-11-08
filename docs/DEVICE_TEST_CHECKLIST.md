# Physical-device test checklist

Automated checks on an emulator do **not** replace these. Record device, OS, WebView/Safari
version, keyboard app, and result (✅ / ❌ / n/a) for each row. Attach the diagnostic report
(Settings → tap the version 7× → Diagnostics → Export) for any ❌.

Setup: install the APK, sign in to Scrimba, open a lesson with code, press Play.

| # | Area | Steps | Expected |
|---|---|---|---|
| 1 | Keyboard opens | Tap inside the code while the lesson plays | Playback pauses; keyboard appears; cursor at the tapped spot |
| 2 | Typing | Type letters, digits and a word with autocorrect suggestions | Exact text appears; no duplicated or lost characters |
| 3 | First keystroke | In a fresh lesson, tap the code and type `abc` at normal speed | All three characters appear (Scrimba creates a branch on the first edit) |
| 4 | Punctuation | Type `{}[]()<>;:'"\`=>` with the keyboard and the toolbar | Correct characters; toolbar pairs place the cursor inside |
| 5 | Multiline | Press Enter inside a `{ }` block | New line, auto-indented |
| 6 | Deletion | Backspace within a line and at the start of a line | Character removed / lines joined |
| 7 | Cursor | Tap elsewhere; use ← → ↑ ↓ keys | Cursor moves accordingly |
| 8 | Selection | Long-press to select; toolbar ⇧← ⇧→; All | Selection shown; Copy/Cut/Paste work with the system clipboard |
| 9 | Undo/redo | Toolbar ↶ ↷ after several edits | Edits undone/redone in order; each toolbar insert is one step |
| 10 | IME | Use a CJK or swipe keyboard; accept suggestions | Composed text lands once, correctly |
| 11 | Full-screen editor | Tap ⛶; edit; Exit | Editor fills the screen; nothing overlaps; edits and undo history kept |
| 12 | Running code | Edit, tap Save then ▶ Run (toolbar) | **Android WebView: expected to fail** (see findings §4). The app shows "Code can’t run…" with Open in browser, which opens the lesson in Chrome |
| 13 | Save | Toolbar Save | Scrimba’s unsaved marker on the file tab disappears |
| 14 | Playback pause/resume | Edit while playing; hide keyboard | Stays paused until you press Play |
| 15 | Instructor audio (speaker) | Play a lesson | Audio audible, in sync with the cursor |
| 16 | Wired headphones | Plug in / unplug during playback | Audio routes; unplugging pauses (setting on) |
| 17 | Bluetooth audio | Connect/disconnect BT headphones | Audio routes; disconnect pauses |
| 18 | Interruptions | Receive a call / start another app’s audio | Lesson pauses; does not resume by itself |
| 19 | Background | Switch apps during playback, return | Paused; no background audio |
| 20 | Subtitles | Turn CC on; change size, background, position in Settings | Captions restyle immediately; timing unchanged |
| 21 | Subtitles + editing | Edit with captions on (While editing: Dim/Hide) | Captions dim/hide and don’t cover the code |
| 22 | Portrait/landscape | Rotate (auto) and use the rotation button | Layout adapts; no clipped toolbar; keyboard + toolbar fit |
| 23 | Toolbar scrolling | Swipe the coding keys from the middle of the bar | Keyboard stays open |
| 24 | Hardware keyboard | Connect a BT/USB keyboard: Ctrl+Z, Ctrl+Shift+Z, Ctrl+C/V/X, Ctrl+A, Shift+arrows, Tab | Works through Monaco; coding toolbar hides (Auto) |
| 25 | Login persistence | Sign in, force-stop the app, reopen | Still signed in |
| 26 | Last lesson | Open a lesson, force-stop, reopen | Same lesson opens |
| 27 | Recovery | Edit without saving, force-stop, reopen the lesson | "Restore unsaved edits?" offered; Restore works and can be undone |
| 28 | Offline | Airplane mode, then reload; turn network back on | Error screen with Try again; reloads automatically when back online |
| 29 | Mode switch | Settings → Site mode → Desktop with unsaved edits | Warning offered; after switching, still signed in |
| 30 | Bridge mode | Settings → Typing method → Bridge; edit a line | Native field edits the same Monaco line; Enter/Backspace behave; undo works |
| 31 | Google sign-in | Try “Continue with Google” | App explains that Google blocks embedded sign-in |
| 31b | GitHub via browser | Sign out; Scrimba → Continue with GitHub | First time: setup prompt; GitHub opens in a Chrome tab with “Continue with Google” |
| 31e | GitHub via browser, return | Enable Open by default → scrimba.com; sign in to GitHub with Google; authorize | Chrome tab closes, app shows Scrimba signed in on the page you started from |
| 31f | Chrome sign-in unaffected | Open in browser → sign in to Scrimba with GitHub in Chrome | Brief hop through the app, then Chrome finishes signing in |
| 31c | DataCloneError toast | Open a lesson with a runner | No “DataCloneError” toast; the app's “Code can't run” notice shows |
| 31d | Top layout on cold start | Open a lesson, force-stop, reopen several times | App toolbar never overlaps the status bar or Scrimba's header |
| 31g | Word select | Double-tap a word in the code, several times in different places; also long-press one | The tapped word is selected every time; two blue handles and a Cut / Copy / Paste / Select all menu appear |
| 31h | Selection handles | Drag the right handle down a few lines, then the left handle | Selection grows/shrinks with the finger; the editor scrolls at the edges; keyboard stays open |
| 31i | Selection menu | Copy, then paste elsewhere; Cut; Select all | Clipboard works with other apps; Cut removes the text and is undoable |
| 31j | Sign out and clear data | Signed in, Settings → Sign out and clear data → confirm | Page reloads signed out; reopening the app doesn't restore the session; settings unchanged |
| 32 | Diagnostics export | Export the report | Share sheet; report has no URLs with queries, no code, no cookies |

## Results so far

| Device | Rows verified | Notes |
|---|---|---|
| Android 16 emulator (x86_64, System WebView 133, Gboard), via `npm run test:android` + screenshots | 1, 2, 4, 5, 6, 9, 11, 13, 14, 22 (landscape renders), 23, 26, 27 (prompt offered) | 12 fails as expected (no cross-origin isolation). Input came from `adb` (real Android touch + key events), not a human |
| Physical Android phone | — | not yet tested |
| iPhone / iPad | — | not yet tested (no macOS/Xcode in this environment) |

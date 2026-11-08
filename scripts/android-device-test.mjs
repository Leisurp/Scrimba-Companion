#!/usr/bin/env node
/**
 * On-device verification against the REAL app, REAL Android System WebView and the REAL
 * scrimba.com, using real Android input (adb `input tap` / `input text` / keyevents go
 * through the normal touch and IME pipeline).
 *
 * DevTools is used only to *observe* (read Monaco's model, focus, playback state) — never
 * to type. Requirements:
 *  - emulator or USB device with the app installed (`adb devices`)
 *  - Developer mode enabled in the app (Settings → tap the version 7×), which turns on
 *    WebView debugging so DevTools can attach
 *
 *   node scripts/android-device-test.mjs [--url https://scrimba.com/<public scrim>]
 *
 * Env: ADB=path/to/adb (default: adb on PATH). Writes screenshots to ./device-test-output.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const ADB = process.env.ADB || 'adb';
const PKG = 'io.github.leisurp.scrimbacompanion';
const urlArg = process.argv.indexOf('--url');
const URL = urlArg > 0 ? process.argv[urlArg + 1] : 'https://scrimba.com/s0v687325e';
const OUT = 'device-test-output';
mkdirSync(OUT, { recursive: true });

const results = [];
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
function screenshot(name) {
  const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { env, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(`${OUT}/${name}.png`, png);
}
function uiDump() {
  // uiautomator occasionally returns "null root node" while the UI is busy; retry.
  for (let i = 0; i < 8; i++) {
    try {
      const out = adb('shell', 'uiautomator', 'dump', '/sdcard/sc-ui.xml');
      if (/dumped to/i.test(out)) return adb('shell', 'cat', '/sdcard/sc-ui.xml');
    } catch {
      /* retry */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
  }
  throw new Error('uiautomator dump failed repeatedly');
}
function boundsOf(xml, predicate) {
  const nodes = xml.split('<node ').slice(1);
  for (const n of nodes) {
    if (predicate(n)) {
      const m = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(n);
      if (m) return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
    }
  }
  return null;
}
function softKeyboardShown() {
  const s = adb('shell', 'dumpsys', 'input_method');
  return /mInputShown=true/.test(s) || /isInputViewShown=true/.test(s);
}

/**
 * Minimal CDP page client. Android WebView's DevTools endpoint only supports page-level
 * targets (no browser contexts), so Playwright's connectOverCDP cannot attach.
 */
async function connectPage(base) {
  const targets = await (await fetch(`${base}/json`)).json();
  const target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!target) throw new Error('No debuggable page in the WebView');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (fn, ...args) => {
    const expression = typeof fn === 'function' ? `(${fn.toString()})(...${JSON.stringify(args)})` : fn;
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result?.result?.value;
  };
  console.log(`Attached to WebView page target (${target.type})`);
  return {
    evaluate,
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(1500);
    },
    async waitForFunction(fn, timeout = 30_000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try {
          if (await evaluate(fn)) return;
        } catch {
          /* page navigating */
        }
        await sleep(500);
      }
      throw new Error('waitForFunction timed out');
    },
    close: () => ws.close(),
  };
}

async function main() {
  console.log(`Device: ${adb('shell', 'getprop', 'ro.product.model').trim()} Android ${adb('shell', 'getprop', 'ro.build.version.release').trim()}`);
  const wv = adb('shell', 'dumpsys', 'package', 'com.google.android.webview').match(/versionName=(\S+)/);
  console.log(`System WebView: ${wv ? wv[1] : 'unknown'}`);

  // Bring the app to the foreground (a backgrounded WebView does not answer DevTools).
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  await sleep(4000);
  const pid = adb('shell', 'pidof', PKG).trim();
  if (!pid) throw new Error('App is not running. Launch Scrimba Companion first.');
  const sockets = adb('shell', 'cat', '/proc/net/unix');
  const sock = (sockets.match(new RegExp(`@(webview_devtools_remote_${pid})`)) || [])[1];
  if (!sock) throw new Error('WebView DevTools socket not found. Enable Developer mode in the app settings (tap version 7×).');
  adb('forward', 'tcp:9333', `localabstract:${sock}`);

  const page = await connectPage('http://127.0.0.1:9333');
  await page.goto(URL);
  await page.waitForFunction(() => !!window.monaco && !!window.__SC__, 60_000);
  record('app injected the compatibility runtime into the real WebView', true);

  const info = await page.evaluate(() => ({
    touch: document.documentElement.classList.contains('touch-interface'),
    ua: navigator.userAgent,
    dpr: devicePixelRatio,
  }));
  record('Scrimba marks the page as touch-interface', info.touch, info.ua);

  // Locate the WebView on screen to convert CSS px → device px.
  let wvBounds = null;
  for (let i = 0; i < 10 && !wvBounds; i++) {
    const xml = uiDump();
    // The app may offer to restore a local recovery snapshot; dismiss it for this run.
    const notNow = boundsOf(xml, (n) => /text="(NOT NOW|Not now)"/.test(n));
    if (notNow) {
      record('recovery prompt offered for previously unsaved edits', true, 'dismissed with "Not now"');
      adb('shell', 'input', 'tap', String((notNow.x1 + notNow.x2) >> 1), String((notNow.y1 + notNow.y2) >> 1));
      await sleep(800);
      continue;
    }
    wvBounds = boundsOf(xml, (n) => n.includes('class="android.webkit.WebView"'));
    if (!wvBounds) await sleep(1000);
  }
  if (!wvBounds) throw new Error('WebView not found in UI hierarchy');
  const toScreen = (x, y) => [Math.round(wvBounds.x1 + x * info.dpr), Math.round(wvBounds.y1 + y * info.dpr)];

  // Start playback with a real tap on the cover's centre, then wait for code to show.
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  adb('shell', 'input', 'tap', ...toScreen(vp.w / 2, vp.h / 2).map(String));
  const editorPoint = async () =>
    page.evaluate(() => {
      const ed = window.monaco.editor.getEditors()[0];
      const r = ed.getDomNode().getBoundingClientRect();
      const p = ed.getScrolledVisiblePosition({ lineNumber: 9, column: 6 }) || { left: 60, top: 60 };
      const x = r.left + p.left + 3;
      const y = r.top + p.top + 8;
      const hit = document.elementFromPoint(x, y);
      return { x, y, visible: !!hit && !!hit.closest('si-monaco-editor, .monaco-editor, si-file-view') };
    });
  let pt;
  for (let i = 0; i < 45; i++) {
    pt = await editorPoint();
    if (pt.visible) break;
    await sleep(1000);
  }
  record('editor became visible during playback', !!pt?.visible);
  screenshot('01-playing');

  // Captions present and styled by the runtime.
  const cap = await page.evaluate(() => {
    const el = document.querySelector('ide-clip-captions');
    return el ? { scale: getComputedStyle(el).scale, attr: document.documentElement.getAttribute('data-sc-cap-pos') } : null;
  });
  record('Scrimba captions detected and under runtime styling', !!cap && cap.scale === '1' && cap.attr === 'default', JSON.stringify(cap));


  const pe = await page.evaluate(() => getComputedStyle(document.querySelector('si-monaco-editor')).pointerEvents);
  const fixed = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sc-pe-fix]')).map((e) => e.tagName.toLowerCase()));
  record('touch fix restored pointer-events on the editor host', pe === 'auto' && fixed.length > 0, `pointer-events=${pe} fixed=${fixed.join(',')}`);

  // Real tap on the code.
  adb('shell', 'input', 'tap', ...toScreen(pt.x, pt.y).map(String));
  await sleep(1500);
  const focused = await page.evaluate(() => window.monaco.editor.getEditors().some((e) => e.hasTextFocus()));
  record('real tap focuses Scrimba’s Monaco editor', focused);
  const kb = softKeyboardShown();
  record('Android soft keyboard is shown', kb);
  await sleep(800);
  const playState = await page.evaluate(() => (document.querySelector('scrim-play-controls op-icon.play svg')?.getAttribute('class') || '').includes('pause') ? 'playing' : 'paused');
  record('playback paused when editing began', playState === 'paused', playState);
  screenshot('02-keyboard');

  // Type through the Android input pipeline.
  // Scrimba creates a "branch" on the first edit of a scrim; keys injected instantly during
  // that transition can be dropped, so make the first edit, wait, then measure.
  adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END');
  adb('shell', 'input', 'keyevent', 'KEYCODE_SPACE');
  await sleep(2500);
  const before = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
  adb('shell', 'input', 'text', 'abc');
  await sleep(800);
  let value = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
  record('typed letters reach Monaco', value.includes('abc') && value.length === before.length + 3);

  // Special characters and multiline (KEYCODE_ENTER → Monaco newline + auto-indent).
  adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER');
  adb('shell', 'input', 'text', "x=\\(a\\)\\;");
  await sleep(800);
  value = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
  record('newline and punctuation reach Monaco', value.includes('x=(a);') && value.split('\n').length === before.split('\n').length + 1);

  adb('shell', 'input', 'keyevent', 'KEYCODE_DEL');
  await sleep(500);
  value = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
  record('backspace deletes in Monaco', value.includes('x=(a)') && !value.includes('x=(a);'));

  // Native coding toolbar (real button presses in the React Native layer).
  // Toolbar keys live in a horizontal ScrollView; swipe it until the key is on screen.
  const toolbarKey = (label) => {
    for (let i = 0; i < 6; i++) {
      const ui = uiDump();
      const b = boundsOf(ui, (n) => n.includes(`content-desc="${label}"`));
      if (b) return b;
      const bar = boundsOf(ui, (n) => n.includes('content-desc="Coding keys"'));
      if (!bar) return null;
      const y = String((bar.y1 + bar.y2) >> 1);
      const w = bar.x2 - bar.x1;
      adb('shell', 'input', 'swipe', String(bar.x1 + Math.round(w * 0.8)), y, String(bar.x1 + Math.round(w * 0.2)), y, '300');
    }
    return null;
  };
  const braces = toolbarKey('Insert braces');
  record('coding toolbar is shown above the keyboard', !!braces);
  if (braces) {
    adb('shell', 'input', 'tap', String((braces.x1 + braces.x2) >> 1), String((braces.y1 + braces.y2) >> 1));
    await sleep(800);
    value = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
    record('toolbar {} inserts a pair into Monaco', value.includes('x=(a){}'));
    // Scrolling the coding keys must not close the keyboard. Swipe from inside the bar:
    // starting within ~10% of the screen edge triggers Android's back gesture, which closes
    // the IME by design.
    const bar = boundsOf(uiDump(), (n) => n.includes('content-desc="Coding keys"'));
    if (bar) {
      const y = String((bar.y1 + bar.y2) >> 1);
      const w = bar.x2 - bar.x1;
      adb('shell', 'input', 'swipe', String(bar.x1 + Math.round(w * 0.8)), y, String(bar.x1 + Math.round(w * 0.2)), y, '300');
      await sleep(1000);
      record('soft keyboard stays open while scrolling the coding keys', softKeyboardShown());
    }
    const undo = toolbarKey('Undo');
    if (!undo) throw new Error('Undo key not reachable in the coding toolbar');
    adb('shell', 'input', 'tap', String((undo.x1 + undo.x2) >> 1), String((undo.y1 + undo.y2) >> 1));
    await sleep(800);
    value = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
    record('toolbar Undo uses Monaco history', value.includes('x=(a)') && !value.includes('{}'));
    const redo = toolbarKey('Redo');
    adb('shell', 'input', 'tap', String((redo.x1 + redo.x2) >> 1), String((redo.y1 + redo.y2) >> 1));
    await sleep(800);
    value = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
    record('toolbar Redo uses Monaco history', value.includes('x=(a){}'));
    screenshot('03-toolbar');
  }

  // Code execution: Scrimba's runner is a StackBlitz WebContainer, which needs
  // SharedArrayBuffer (cross-origin isolation). Record the real capability, not a proxy.
  const exec = await page.evaluate(() => ({ coi: self.crossOriginIsolated === true, sab: typeof SharedArrayBuffer === 'function' }));
  record('code execution possible in this WebView (cross-origin isolation for Scrimba runner)', exec.coi && exec.sab, `crossOriginIsolated=${exec.coi} SharedArrayBuffer=${exec.sab}`);
  if (!(exec.coi && exec.sab)) {
    const notice = boundsOf(uiDump(), (n) => n.includes('text="Open in browser"'));
    record('app tells the user execution is unavailable and offers the browser', !!notice);
  }

  // Full-screen editor via the native toolbar.
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); // hide keyboard
  await sleep(800);
  const ui2 = uiDump();
  const fs = boundsOf(ui2, (n) => n.includes('content-desc="Full-screen editor"'));
  if (fs) {
    adb('shell', 'input', 'tap', String((fs.x1 + fs.x2) >> 1), String((fs.y1 + fs.y2) >> 1));
    await sleep(1200);
    const cover = await page.evaluate(() => {
      const w = innerWidth, h = innerHeight;
      return [[10, 10], [w - 10, h / 2], [w / 2, h - 10]].every(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.monaco-editor'));
    });
    const kept = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue().includes('x=(a){}'));
    record('full-screen shows Scrimba’s real editor edge to edge with edits kept', cover && kept);
    screenshot('04-fullscreen');
    const exit = boundsOf(uiDump(), (n) => n.includes('content-desc="Exit full-screen editor"'));
    if (exit) adb('shell', 'input', 'tap', String((exit.x1 + exit.x2) >> 1), String((exit.y1 + exit.y2) >> 1));
  } else record('full-screen button found', false);

  writeFileSync(`${OUT}/results.json`, JSON.stringify({ url: URL, results }, null, 2));
  page.close();
  adb('forward', '--remove', 'tcp:9333');
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}/`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

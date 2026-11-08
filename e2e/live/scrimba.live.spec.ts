/**
 * OPT-IN live compatibility check against the real scrimba.com (no login needed).
 *
 *   npm run test:live
 *   SCRIMBA_LIVE_URL=https://scrimba.com/<public-scrim> npm run test:live
 *
 * Uses a public scrim, real touch events in mobile Chromium/WebKit emulation, and the
 * same injected runtime as the app. It only types into the page's local sandbox (a
 * Scrimba "branch"), never saves, and never logs in. Scrimba can change at any time,
 * so failures here are signals to update the compatibility modules.
 */
import { expect, test, type Page } from '@playwright/test';
import { command, injectEarly, injectRuntime, lastOf, monacoHasInputFocus, send } from '../helpers';

const URL = process.env.SCRIMBA_LIVE_URL || 'https://scrimba.com/s0v687325e';

async function editorPoint(page: Page) {
  return page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor: { getEditors(): { getDomNode(): HTMLElement; getScrolledVisiblePosition(p: unknown): { left: number; top: number } | null }[] } } }).monaco;
    const ed = m?.editor.getEditors()[0];
    if (!ed) return null;
    const r = ed.getDomNode().getBoundingClientRect();
    const p = ed.getScrolledVisiblePosition({ lineNumber: 3, column: 2 });
    return p ? { x: r.left + p.left + 4, y: r.top + p.top + 6 } : { x: r.left + 80, y: r.top + 60 };
  });
}

/** Scrimba shows slides/cover over the editor at t=0; play, wait for code, pause via the real control. */
async function revealEditor(page: Page) {
  const cover = page.locator('ide-cover');
  if (await cover.count()) await page.mouse.click(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
  await expect
    .poll(
      async () => {
        const pt = await editorPoint(page);
        if (!pt) return false;
        return page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('si-monaco-editor, .monaco-editor, si-file-view'), [pt.x, pt.y]);
      },
      { timeout: 40_000, intervals: [1000] },
    )
    .toBe(true);
}

test.describe.configure({ mode: 'serial' });

test('live: editor detection, root cause, fix, typing, undo, auto-pause', async ({ page }) => {
  test.setTimeout(120_000);
  await injectEarly(page);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as unknown as { monaco?: unknown }).monaco, null, { timeout: 45_000 });

  // 1. Without our fix: Scrimba's touch rule blocks taps on the editor.
  await injectRuntime(page, { touchFix: false, tapFocusAssist: false, autoPauseOnEdit: true });
  const touchClass = await page.evaluate(() => document.documentElement.classList.contains('touch-interface'));
  test.info().annotations.push({ type: 'touch-interface', description: String(touchClass) });
  await revealEditor(page);
  // Captions exist while watching the instructor (Scrimba hides them in your own branch).
  expect(await page.locator('ide-clip-captions').count()).toBeGreaterThan(0);
  const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.monaco-editor')!).pointerEvents);
  test.info().annotations.push({ type: 'editor pointer-events before fix', description: pe });
  let pt = (await editorPoint(page))!;
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(500);
  const focusedWithoutFix = await monacoHasInputFocus(page);
  test.info().annotations.push({ type: 'focused without fix', description: String(focusedWithoutFix) });
  if (touchClass) expect(focusedWithoutFix).toBe(false);

  // 2. Enable the fix: the same tap focuses Scrimba's real Monaco.
  const cfg = await page.evaluate(() => (window as unknown as { __SC__: { config(): unknown } }).__SC__.config());
  await send(page, { kind: 'config', config: { ...(cfg as object), touchFix: true, tapFocusAssist: true } as never });
  await page.waitForTimeout(300);
  pt = (await editorPoint(page))!;
  await page.touchscreen.tap(pt.x, pt.y);
  await expect.poll(() => monacoHasInputFocus(page), { timeout: 5000 }).toBe(true);

  // 3. Playback must now be paused (Scrimba pauses on edit; we pause on focus).
  await expect.poll(async () => (await lastOf(page, 'playback'))?.state ?? 'unknown', { timeout: 5000 }).not.toBe('playing');

  // 4. Typing reaches Scrimba's editor model; undo goes through Monaco history.
  const before = await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors(): { getValue(): string }[] } } }).monaco.editor.getEditors()[0].getValue());
  await command(page, { type: 'move', direction: 'end' });
  await page.keyboard.insertText(' /*companion*/');
  const after = await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors(): { getValue(): string }[] } } }).monaco.editor.getEditors()[0].getValue());
  expect(after).toContain('/*companion*/');
  await command(page, { type: 'insertPair', open: '{', close: '}' });
  await command(page, { type: 'undo' });
  await command(page, { type: 'undo' });
  const undone = await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors(): { getValue(): string }[] } } }).monaco.editor.getEditors()[0].getValue());
  expect(undone).not.toContain('/*companion*/');
  expect(undone.length).toBeLessThanOrEqual(before.length + 1);

  // 5. Full-screen on the real editor + captions detection.
  await send(page, { kind: 'layout', fullscreenEditor: true });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const covered = await page.evaluate(([w, h]) => !!document.elementFromPoint(w / 2, h - 40)?.closest('.monaco-editor'), [vp.width, vp.height]);
  expect(covered).toBe(true);
  await send(page, { kind: 'layout', fullscreenEditor: false });
  await send(page, { kind: 'requestDiagnostics' });
  const diag = await lastOf(page, 'diagnostics');
  test.info().annotations.push({ type: 'diagnostics', description: JSON.stringify({ touch: diag?.report.touch, fix: diag?.report.pointerEventsFix, captions: diag?.report.captions, playback: diag?.report.playback, modules: diag?.report.modules.map((m) => `${m.name}:${m.active}`) }) });
  expect(diag?.report.monaco.present).toBe(true);
});

test("live: Scrimba's runner DataCloneError toast is hidden without cross-origin isolation", async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'reproduces the Android System WebView condition in Chromium');
  test.setTimeout(90_000);
  // Android System WebView has no cross-origin isolation; drop COOP/COEP to get the same state.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const resp = await route.fetch();
    const headers = Object.fromEntries(Object.entries(resp.headers()).filter(([k]) => !/^cross-origin-(opener|embedder)-policy/i.test(k)));
    await route.fulfill({ response: resp, headers });
  });
  await injectEarly(page);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await injectRuntime(page);
  // Scrimba adds the toast once its runner fails to share memory with its worker.
  const toast = page.locator('op-toast', { hasText: 'DataCloneError' });
  await expect(toast).toHaveCount(1, { timeout: 60_000 });
  await expect(toast).toBeHidden();
  await expect(toast).toHaveAttribute('data-sc-hidden', 'runner-isolation');
});

test('live: double-tap selects a word in Scrimba\'s editor and shows selection handles + menu', async ({ page }) => {
  test.setTimeout(120_000);
  await injectEarly(page);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as unknown as { monaco?: unknown }).monaco, null, { timeout: 45_000 });
  await injectRuntime(page, {});
  await revealEditor(page);
  // First word on a visible line with an identifier.
  const target = await page.evaluate(() => {
    type Ed = { getModel(): { getLineCount(): number; getLineContent(n: number): string }; getDomNode(): HTMLElement; getScrolledVisiblePosition(p: unknown): { left: number; top: number; height: number } | null };
    const ed = (window as unknown as { monaco: { editor: { getEditors(): Ed[] } } }).monaco.editor.getEditors()[0];
    const r = ed.getDomNode().getBoundingClientRect();
    const m = ed.getModel();
    for (let ln = 1; ln <= m.getLineCount(); ln++) {
      const match = /[A-Za-z_]\w{3,}/.exec(m.getLineContent(ln));
      if (!match) continue;
      const p = ed.getScrolledVisiblePosition({ lineNumber: ln, column: match.index + 2 });
      if (!p) continue;
      const y = r.top + p.top + p.height / 2;
      if (y < r.top + 4 || y > r.bottom - 4) continue;
      const x = r.left + p.left + 2;
      if (!document.elementFromPoint(x, y)?.closest('.monaco-editor')) continue;
      return { x, y, word: match[0] };
    }
    return null;
  });
  expect(target, 'a visible word in the editor').not.toBeNull();
  await page.touchscreen.tap(target!.x, target!.y);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(target!.x + 2, target!.y + 1);
  const selected = () =>
    page.evaluate(() => {
      const ed = (window as unknown as { monaco: { editor: { getEditors(): { getSelection(): unknown; getModel(): { getValueInRange(r: unknown): string } }[] } } }).monaco.editor.getEditors()[0];
      return ed.getModel().getValueInRange(ed.getSelection());
    });
  await expect.poll(selected, { timeout: 5000 }).toBe(target!.word);
  const ui = () =>
    page.evaluate(() => ['.sc-ts-start', '.sc-ts-end', '.sc-ts-menu'].map((s) => !!document.querySelector(`#sc-touch-selection ${s}.sc-on`)));
  await expect.poll(ui, { timeout: 5000 }).toEqual([true, true, true]);
});

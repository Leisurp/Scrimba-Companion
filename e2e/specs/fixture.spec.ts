/**
 * Runtime ↔ real Monaco, with real touch input, in a Scrimba-shaped fixture.
 * What this proves: the mechanisms work with the actual Monaco implementation and real
 * touch events. What it does NOT prove: behaviour on scrimba.com (see live suite) or on
 * a physical device's soft keyboard (see docs/DEVICE_TEST_CHECKLIST.md).
 */
import { expect, test, type Page } from '@playwright/test';
import { command, injectEarly, injectRuntime, lastOf, monacoHasInputFocus, send } from '../helpers';

type FixtureWindow = Window & {
  fixture: { ready: boolean; runClicks: number; saveKeys: number; playToggles: number; setPlaying(on: boolean): void; editor: { getValue(): string; getModel(): { getLineContent(n: number): string } } };
};

const value = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).fixture.editor.getValue());
const line = (page: Page, n: number) => page.evaluate((i) => (window as unknown as FixtureWindow).fixture.editor.getModel().getLineContent(i), n);

async function open(page: Page, withRuntime = true, config = {}) {
  await injectEarly(page);
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as FixtureWindow).fixture?.ready === true);
  if (withRuntime) await injectRuntime(page, config);
}

/** Point inside the text of line `n` (1-based), at character `col` (0-based). */
async function pointAt(page: Page, n: number, col = 2) {
  return page.evaluate(
    ([ln, c]) => {
      const ed = (window as unknown as { monaco: { editor: { getEditors(): { getScrolledVisiblePosition(p: unknown): { left: number; top: number; height: number }; getDomNode(): HTMLElement }[] } } }).monaco.editor.getEditors()[0];
      const p = ed.getScrolledVisiblePosition({ lineNumber: ln, column: c + 1 });
      const r = ed.getDomNode().getBoundingClientRect();
      return { x: r.left + p.left + 2, y: r.top + p.top + p.height / 2 };
    },
    [n, col] as const,
  );
}

test.describe('touch → keyboard focus (root cause)', () => {
  test('without the runtime, tapping the editor does NOT focus Monaco (reproduces the bug)', async ({ page }) => {
    await open(page, false);
    expect(await page.evaluate(() => document.documentElement.classList.contains('touch-interface'))).toBe(true);
    const p = await pointAt(page, 2, 4);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(200);
    expect(await monacoHasInputFocus(page)).toBe(false);
  });

  test('with the runtime, a tap focuses Monaco and places the cursor', async ({ page }) => {
    await open(page);
    const p = await pointAt(page, 2, 4);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => monacoHasInputFocus(page)).toBe(true);
    const state = await page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors(): { getPosition(): { lineNumber: number } }[] } } }).monaco.editor.getEditors()[0].getPosition());
    expect(state.lineNumber).toBe(2);
    const fix = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sc-pe-fix]')).map((e) => e.tagName.toLowerCase()));
    expect(fix).toEqual(['si-monaco-editor']);
  });

  test('touch fix can be turned off (setting) and restores Scrimba behaviour', async ({ page }) => {
    await open(page, true, { touchFix: false, tapFocusAssist: false });
    const p = await pointAt(page, 2, 4);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(200);
    expect(await monacoHasInputFocus(page)).toBe(false);
  });
});

test.describe('typing into the real editor', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    const p = await pointAt(page, 5, 15); // end of `greet("world");`
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => monacoHasInputFocus(page)).toBe(true);
    await command(page, { type: 'move', direction: 'end' });
  });

  test('special characters, multiline and auto-indent', async ({ page }) => {
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('const f = (a) => {');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText("return [a, 'x', \"y\", `z`];");
    expect(await line(page, 6)).toBe('const f = (a) => {');
    // Monaco auto-indents inside the block (4-space default tab size in the fixture).
    expect((await line(page, 7)).trimStart()).toBe("return [a, 'x', \"y\", `z`];");
    expect(await line(page, 7)).toMatch(/^\s+return/);
  });

  test('IME composition commits correctly (CDP composition events)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP Input.imeSetComposition is Chromium-only');
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.insertText(' //');
    await cdp.send('Input.imeSetComposition', { text: 'ca', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.imeSetComposition', { text: 'caf', selectionStart: 3, selectionEnd: 3 });
    await cdp.send('Input.insertText', { text: 'café' });
    expect(await line(page, 5)).toBe('greet("world"); //café');
  });

  test('deletion, cursor movement and selection', async ({ page }) => {
    await page.keyboard.press('Backspace'); // remove ';'
    expect(await line(page, 5)).toBe('greet("world")');
    await command(page, { type: 'move', direction: 'home' });
    await command(page, { type: 'move', direction: 'right', select: true });
    await command(page, { type: 'move', direction: 'right', select: true });
    const copied = await command(page, { type: 'copy' });
    expect(copied?.clipboardText).toBe('gr');
  });

  test('toolbar pairs, indent/outdent, comment', async ({ page }) => {
    await command(page, { type: 'newline' });
    await command(page, { type: 'insertText', text: 'x = ' });
    await command(page, { type: 'insertPair', open: '{', close: '}' });
    expect(await line(page, 6)).toBe('x = {}');
    await command(page, { type: 'insertText', text: 'a' });
    expect(await line(page, 6)).toBe('x = {a}'); // cursor was placed between the pair
    await command(page, { type: 'move', direction: 'home' });
    await command(page, { type: 'indent' });
    expect(await line(page, 6)).toMatch(/^\s+x = \{a\}$/);
    await command(page, { type: 'outdent' });
    expect(await line(page, 6)).toBe('x = {a}');
    await command(page, { type: 'toggleComment' });
    await expect.poll(() => line(page, 6)).toBe('// x = {a}');
  });

  test('undo and redo use Monaco history; toolbar edits are their own step', async ({ page }) => {
    const before = await value(page);
    await page.keyboard.insertText(' // one');
    const typed = await line(page, 5);
    await command(page, { type: 'insertPair', open: '(', close: ')' });
    expect(await line(page, 5)).toBe(typed + '()');
    await command(page, { type: 'undo' });
    expect(await line(page, 5)).toBe(typed);
    await command(page, { type: 'redo' });
    expect(await line(page, 5)).toBe(typed + '()');
    for (let i = 0; i < 6 && (await value(page)) !== before; i++) await command(page, { type: 'undo' });
    expect(await value(page)).toBe(before);
    for (let i = 0; i < 6; i++) await command(page, { type: 'redo' });
    expect(await line(page, 5)).toBe(typed + '()');
  });

  test('select all, cut and multi-line paste', async ({ page }) => {
    const all = await value(page);
    await command(page, { type: 'selectAll' });
    const cut = await command(page, { type: 'cut' });
    expect(cut?.clipboardText).toBe(all);
    expect(await value(page)).toBe('');
    await command(page, { type: 'paste', text: 'a\nb\nc' });
    expect(await value(page)).toBe('a\nb\nc');
    await command(page, { type: 'undo' });
    await command(page, { type: 'undo' });
    expect(await value(page)).toBe(all);
  });

  test('hardware keyboard shortcuts are left to Monaco (Ctrl+Z / Ctrl+Shift+Z)', async ({ page }) => {
    const before = await value(page);
    await page.keyboard.type('xyz');
    await page.keyboard.press('Control+z');
    expect(await value(page)).toBe(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await value(page)).toContain('xyz');
    const phys = await lastOf(page, 'physicalKeyboard');
    expect(phys?.detected).toBe(true);
  });
});

test.describe('lesson integration', () => {
  test('editing auto-pauses playback and never resumes it', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as FixtureWindow).fixture.setPlaying(true));
    const p = await pointAt(page, 1, 3);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => page.evaluate(() => document.querySelector('#play svg')!.getAttribute('class'))).toContain('play');
    // Blur the editor: playback must stay paused.
    await command(page, { type: 'blur' });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.querySelector('#play svg')!.getAttribute('class'))).not.toContain('pause');
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).fixture.playToggles)).toBe(1);
  });

  test('save sends mod+s and run clicks RERUN', async ({ page }) => {
    await open(page);
    await command(page, { type: 'focus' });
    expect((await command(page, { type: 'save' }))?.ok).toBe(true);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).fixture.saveKeys)).toBe(1);
    expect((await command(page, { type: 'run' }))?.ok).toBe(true);
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).fixture.runClicks)).toBe(1);
  });

  test('full-screen expands the real editor and keeps content + undo history', async ({ page }) => {
    await open(page);
    await command(page, { type: 'focus' });
    await command(page, { type: 'move', direction: 'end' });
    await page.keyboard.insertText(' /*fs*/');
    await send(page, { kind: 'layout', fullscreenEditor: true });
    await page.waitForTimeout(200);
    const vp = page.viewportSize()!;
    const box = await page.locator('si-monaco-editor').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(vp.width - 1);
    expect(box!.height).toBeGreaterThanOrEqual(vp.height - 1);
    // Nothing else paints on top (captions, preview, controls).
    for (const [x, y] of [[5, 5], [vp.width - 5, 5], [vp.width / 2, vp.height - 50], [vp.width - 20, vp.height - 5]]) {
      const inside = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.monaco-editor'), [x, y]);
      expect(inside).toBe(true);
    }
    // The expanded host must be opaque, or Scrimba's header/drawers show through.
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('si-monaco-editor')!).backgroundColor);
    expect(bg).not.toMatch(/rgba\(.*,\s*0\)|transparent|\/ 0\)/);
    expect(await line(page, 1)).toContain('/*fs*/');
    await command(page, { type: 'undo' });
    expect(await line(page, 1)).not.toContain('/*fs*/');
    await send(page, { kind: 'layout', fullscreenEditor: false });
    expect(await page.locator('[data-sc-fullscreen]').count()).toBe(0);
  });

  test('expanded preview', async ({ page }) => {
    await open(page);
    expect((await lastOf(page, 'layoutState'))?.previewAvailable).toBe(true);
    await send(page, { kind: 'layout', expandedPreview: true });
    const box = await page.locator('si-browser-view').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  });

  test('caption styling targets the original captions', async ({ page }) => {
    await open(page, true, { captions: { scale: 1.5, backgroundOpacity: 0.9, position: 'top', whileEditing: 'dim' } });
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => {
      const el = document.querySelector('ide-clip-captions')!;
      const cs = getComputedStyle(el);
      return { scale: cs.scale, top: el.getBoundingClientRect().top, bg: getComputedStyle(el.firstElementChild!).backgroundColor, text: el.textContent };
    });
    expect(s.scale).toBe('1.5');
    expect(s.top).toBeLessThan(60);
    expect(s.bg).toBe('rgba(0, 0, 0, 0.9)');
    expect(s.text).toBe('Hello there.'); // text untouched
  });
});

test.describe('native bridge strategy', () => {
  test('bridge edits land in Monaco; web keyboard suppressed via inputmode=none', async ({ page }) => {
    await open(page, true, { editingStrategy: 'bridge' });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.querySelector('.monaco-editor textarea')?.getAttribute('inputmode'))).toBe('none');
    await command(page, { type: 'focus' });
    await command(page, { type: 'requestLineState' });
    await command(page, { type: 'replaceInLine', lineNumber: 2, startColumn: 22, endColumn: 22, text: ' + "!"', cursorColumn: 28 });
    expect(await line(page, 2)).toBe('  return "Hi " + name + "!";');
    await command(page, { type: 'newline' });
    const ls = await lastOf(page, 'lineState');
    expect(ls?.line.lineNumber).toBe(3);
    await command(page, { type: 'undo' });
    await command(page, { type: 'undo' });
    expect(await line(page, 2)).toBe('  return "Hi " + name;');
  });
});

test('diagnostics never include code text', async ({ page }) => {
  await open(page);
  await send(page, { kind: 'requestDiagnostics' });
  const d = await lastOf(page, 'diagnostics');
  expect(d?.report.monaco.present).toBe(true);
  expect(JSON.stringify(d)).not.toContain('greet');
});

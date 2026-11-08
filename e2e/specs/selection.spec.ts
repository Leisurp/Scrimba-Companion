/**
 * Phone-style text selection against the real Monaco editor with real touch input:
 * double-tap / long-press word selection, drag handles and the Cut/Copy/Paste menu.
 * Chromium drives touch through CDP (touchmove included); WebKit only has taps.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { injectEarly, injectRuntime, outbox } from '../helpers';
import { DOUBLE_TAP_MS } from '../../src/injected/modules/selection';

type Ed = {
  getValue(): string;
  getSelection(): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  getModel(): { getValueInRange(r: unknown): string };
  getScrolledVisiblePosition(p: unknown): { left: number; top: number; height: number };
  getDomNode(): HTMLElement;
};
type W = Window & { fixture: { ready: boolean }; monaco: { editor: { getEditors(): Ed[] } } };

async function open(page: Page, config = {}) {
  await injectEarly(page);
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as W).fixture?.ready === true);
  await injectRuntime(page, config);
}

/** Client point of the caret before character `col` (0-based) on line `n`, mid-line. */
function pointAt(page: Page, n: number, col: number) {
  return page.evaluate(([ln, c]) => {
    const ed = (window as unknown as W).monaco.editor.getEditors()[0];
    const p = ed.getScrolledVisiblePosition({ lineNumber: ln, column: c + 1 });
    const r = ed.getDomNode().getBoundingClientRect();
    return { x: r.left + p.left + 3, y: r.top + p.top + p.height / 2 };
  }, [n, col] as const);
}

const selectedText = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as unknown as W).monaco.editor.getEditors()[0];
    return ed.getModel().getValueInRange(ed.getSelection());
  });
const value = (page: Page) => page.evaluate(() => (window as unknown as W).monaco.editor.getEditors()[0].getValue());

function overlayBox(page: Page, sel: string) {
  return page.evaluate((s) => {
    const el = document.querySelector(`#sc-touch-selection ${s}`) as HTMLElement | null;
    if (!el || !el.classList.contains('sc-on')) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, text: el.textContent };
  }, sel);
}

async function cdpTouch(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}
const pt = (x: number, y: number) => [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }];

/**
 * Two real taps. Under heavy parallel test load, Playwright can take longer than the
 * double-tap window between them (seen: 400-450 ms for a 120 ms wait), which a phone would
 * also treat as two single taps. The gap is measured in the page; only a too-slow gap is
 * retried, so a real double-tap that fails still fails the test.
 */
async function doubleTap(page: Page, x: number, y: number) {
  await page.evaluate(() => {
    const w = window as unknown as { __tapTimes?: number[] };
    w.__tapTimes = [];
    if ((w as { __tapHooked?: boolean }).__tapHooked) return;
    (w as { __tapHooked?: boolean }).__tapHooked = true;
    window.addEventListener('touchstart', () => w.__tapTimes!.push(performance.now()), true);
    window.addEventListener('touchend', () => w.__tapTimes!.push(performance.now()), true);
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(() => ((window as unknown as { __tapTimes: number[] }).__tapTimes = []));
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x + 2, y + 1);
    const t = await page.evaluate(() => (window as unknown as { __tapTimes: number[] }).__tapTimes);
    if (t.length >= 3 && t[2] - t[1] <= DOUBLE_TAP_MS) return;
    await page.waitForTimeout(DOUBLE_TAP_MS + 100); // let it count as unrelated taps, then retry
  }
  throw new Error('test harness could not deliver two taps within the double-tap window');
}

async function tapMenu(page: Page, label: string) {
  const box = await page.evaluate((l) => {
    const b = Array.from(document.querySelectorAll('#sc-touch-selection .sc-ts-menu button')).find((e) => e.textContent === l);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
  expect(box, `menu item ${label}`).not.toBeNull();
  await page.touchscreen.tap(box!.x, box!.y);
}

test.describe('phone-style text selection', () => {
  test('double-tap selects the word, shows both handles and the menu', async ({ page }) => {
    await open(page);
    const p = await pointAt(page, 5, 2); // inside `greet`
    await doubleTap(page, p.x, p.y);
    await expect.poll(() => selectedText(page)).toBe('greet');
    await expect.poll(() => overlayBox(page, '.sc-ts-start')).not.toBeNull();
    expect(await overlayBox(page, '.sc-ts-end')).not.toBeNull();
    const menu = await overlayBox(page, '.sc-ts-menu');
    expect(menu?.text).toBe('CutCopyPasteSelect all');
  });

  test('a tap elsewhere clears the selection and hides the handles', async ({ page }) => {
    await open(page);
    const p = await pointAt(page, 5, 2);
    await doubleTap(page, p.x, p.y);
    await expect.poll(() => selectedText(page)).toBe('greet');
    const q = await pointAt(page, 2, 4);
    await page.waitForTimeout(400);
    await page.touchscreen.tap(q.x, q.y);
    await expect.poll(() => selectedText(page)).toBe('');
    await expect.poll(() => overlayBox(page, '.sc-ts-start')).toBeNull();
    expect(await overlayBox(page, '.sc-ts-menu')).toBeNull();
  });

  test('Copy sends the text to the app clipboard and collapses the selection', async ({ page }) => {
    await open(page);
    const p = await pointAt(page, 1, 10); // `greet` in `function greet(name)`
    await doubleTap(page, p.x, p.y);
    await expect.poll(() => selectedText(page)).toBe('greet');
    await expect.poll(() => overlayBox(page, '.sc-ts-menu')).not.toBeNull();
    await tapMenu(page, 'Copy');
    await expect.poll(async () => (await outbox(page)).filter((m) => m.kind === 'clipboard').pop()).toEqual({ kind: 'clipboard', text: 'greet' });
    await expect.poll(() => selectedText(page)).toBe('');
    expect(await overlayBox(page, '.sc-ts-start')).toBeNull();
  });

  test('Cut removes the word; Paste asks the app for the clipboard', async ({ page }) => {
    await open(page);
    const p = await pointAt(page, 2, 4); // `return` (left of the fixture's preview box)
    await doubleTap(page, p.x, p.y);
    await expect.poll(() => selectedText(page)).toBe('return');
    await expect.poll(() => overlayBox(page, '.sc-ts-menu')).not.toBeNull();
    await tapMenu(page, 'Cut');
    await expect.poll(() => value(page)).toContain('{\n   "Hi " + name;');
    expect((await outbox(page)).filter((m) => m.kind === 'clipboard').pop()).toEqual({ kind: 'clipboard', text: 'return' });

    const q = await pointAt(page, 5, 2);
    await page.waitForTimeout(400);
    await doubleTap(page, q.x, q.y);
    await expect.poll(() => overlayBox(page, '.sc-ts-menu')).not.toBeNull();
    await tapMenu(page, 'Paste');
    await expect.poll(async () => (await outbox(page)).some((m) => m.kind === 'pasteRequest')).toBe(true);
  });

  test('Select all selects the whole file and keeps the handles', async ({ page }) => {
    await open(page);
    const p = await pointAt(page, 5, 2);
    await doubleTap(page, p.x, p.y);
    await expect.poll(() => overlayBox(page, '.sc-ts-menu')).not.toBeNull();
    await tapMenu(page, 'Select all');
    await expect.poll(async () => (await selectedText(page)).length).toBe((await value(page)).length);
    expect(await overlayBox(page, '.sc-ts-end')).not.toBeNull();
  });

  test('can be turned off in settings', async ({ page }) => {
    await open(page, { touchSelection: false });
    const p = await pointAt(page, 5, 2);
    await doubleTap(page, p.x, p.y);
    await page.waitForTimeout(400);
    expect(await overlayBox(page, '.sc-ts-start')).toBeNull();
    expect(await overlayBox(page, '.sc-ts-menu')).toBeNull();
  });
});

test.describe('phone-style text selection: gestures with finger movement (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'needs CDP touchmove');

  test('a double-tap with finger jitter still selects the word', async ({ page }) => {
    await open(page);
    const cdp = await cdpTouch(page);
    const p = await pointAt(page, 2, 4); // `return`
    const tapJitter = async (x: number, y: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x + 5, y + 3) });
      await page.waitForTimeout(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    // Same harness guard as doubleTap(): retry only when the gap itself was too slow.
    const times = () => page.evaluate(() => (window as unknown as { __tt: number[] }).__tt);
    await page.evaluate(() => {
      const w = window as unknown as { __tt: number[] };
      w.__tt = [];
      window.addEventListener('touchstart', () => w.__tt.push(performance.now()), true);
      window.addEventListener('touchend', () => w.__tt.push(performance.now()), true);
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.evaluate(() => ((window as unknown as { __tt: number[] }).__tt = []));
      await tapJitter(p.x, p.y);
      await tapJitter(p.x + 8, p.y - 3);
      const t = await times();
      if (t.length >= 3 && t[2] - t[1] <= DOUBLE_TAP_MS) break;
      await page.waitForTimeout(DOUBLE_TAP_MS + 100);
    }
    await expect.poll(() => selectedText(page)).toBe('return');
  });

  test('long-press selects the word', async ({ page }) => {
    await open(page);
    const cdp = await cdpTouch(page);
    const p = await pointAt(page, 1, 10);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(p.x, p.y) });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => selectedText(page)).toBe('greet');
    await expect.poll(() => overlayBox(page, '.sc-ts-menu')).not.toBeNull();
  });

  test('dragging the end handle extends the selection; the start handle shrinks it', async ({ page }) => {
    await open(page);
    const cdp = await cdpTouch(page);
    const p = await pointAt(page, 1, 10);
    await doubleTap(page, p.x, p.y);
    await expect.poll(() => selectedText(page)).toBe('greet');
    await expect.poll(() => overlayBox(page, '.sc-ts-end')).not.toBeNull();

    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10) });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    // End handle: drag down one line and right, onto `return`.
    const end = (await overlayBox(page, '.sc-ts-end'))!;
    const target = await pointAt(page, 2, 8); // after `return`
    const grab = { x: end.x + 22, y: end.y + 14 };
    const endTip = { x: end.x + 12, y: end.y + 4 };
    await drag(grab, { x: grab.x + (target.x - endTip.x), y: grab.y + (target.y - endTip.y) + 10 });
    await expect.poll(() => selectedText(page)).toBe('greet(name) {\n  return');

    // Start handle: drag right by two characters of `greet`.
    const start = (await overlayBox(page, '.sc-ts-start'))!;
    const s2 = await pointAt(page, 1, 11); // between `gr` and `eet`
    const startTip = { x: start.x + 32, y: start.y + 4 };
    const g2 = { x: start.x + 22, y: start.y + 14 };
    await drag(g2, { x: g2.x + (s2.x - 3 - startTip.x) + 2, y: g2.y + (s2.y - startTip.y) + 10 });
    await expect.poll(() => selectedText(page)).toBe('eet(name) {\n  return');
    await expect.poll(() => overlayBox(page, '.sc-ts-menu')).not.toBeNull();
  });
});

import type { Page } from '@playwright/test';
import { EARLY_SCRIPT, MAIN_SCRIPT } from '../src/injected/generated/bundles';
import type { EditorCommand, NativeToPage, PageToNative, RuntimeConfig } from '../src/shared/protocol';
import { DEFAULT_RUNTIME_CONFIG } from '../src/shared/protocol';

/** Same order as the WebView: early hooks before page scripts, runtime after load. */
export async function injectEarly(page: Page) {
  await page.addInitScript({ content: EARLY_SCRIPT });
}

export async function injectRuntime(page: Page, config: Partial<RuntimeConfig> = {}) {
  const boot = { ...DEFAULT_RUNTIME_CONFIG, ...config, captions: { ...DEFAULT_RUNTIME_CONFIG.captions, ...(config.captions || {}) } };
  await page.evaluate((c) => {
    (window as unknown as Record<string, unknown>).__SC_BOOT_CONFIG__ = c;
  }, boot);
  await page.addScriptTag({ content: MAIN_SCRIPT });
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__SC__);
}

export async function send(page: Page, msg: NativeToPage) {
  await page.evaluate((m) => (window as unknown as { __SC__: { receive(m: unknown): void } }).__SC__.receive(m), msg);
}

let cmdId = 1000;
export async function command(page: Page, cmd: EditorCommand) {
  const id = ++cmdId;
  await send(page, { kind: 'editor', id, command: cmd });
  return page.evaluate((i) => {
    const out = ((window as unknown as { __SC_OUTBOX__?: PageToNative[] }).__SC_OUTBOX__ || []) as PageToNative[];
    return out.find((m) => m.kind === 'commandResult' && m.id === i) as Extract<PageToNative, { kind: 'commandResult' }> | undefined;
  }, id);
}

export async function outbox(page: Page): Promise<PageToNative[]> {
  return page.evaluate(() => ((window as unknown as { __SC_OUTBOX__?: PageToNative[] }).__SC_OUTBOX__ || []) as PageToNative[]);
}

export async function lastOf<K extends PageToNative['kind']>(page: Page, kind: K) {
  const all = await outbox(page);
  return all.filter((m) => m.kind === kind).pop() as Extract<PageToNative, { kind: K }> | undefined;
}

/** Active element is Monaco's hidden input (textarea or EditContext div). */
export async function monacoHasInputFocus(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    return !!a && !!a.closest('.monaco-editor') && (a.tagName === 'TEXTAREA' || a.classList.contains('native-edit-context'));
  });
}

import { PageBridge } from '../../src/webview/PageBridge';
import { buildCommandScript, buildEarlyScript, buildMainScript, createSessionToken, isScrimbaPageUrl, jsLiteral, parsePageMessage, SCRIMBA_PAGE_CHECK } from '../../src/webview/messages';
import { DEFAULT_RUNTIME_CONFIG } from '../../src/shared/protocol';

const env = (t: string, m: unknown) => JSON.stringify({ t, m });

describe('message validation', () => {
  test('rejects messages without the session token (e.g. from the lesson preview iframe)', () => {
    expect(parsePageMessage(env('wrong', { kind: 'ready' }), 'tok')).toBeNull();
    expect(parsePageMessage(JSON.stringify({ kind: 'ready' }), 'tok')).toBeNull();
    expect(parsePageMessage(env('tok', { kind: 'ready', runtimeVersion: '1', protocol: 1, location: '' }), '')).toBeNull();
    expect(parsePageMessage(env('tok', { kind: 'ready', runtimeVersion: '1', protocol: 1, location: '' }), 'tok')).not.toBeNull();
  });

  test('rejects unknown kinds and malformed payloads', () => {
    expect(parsePageMessage('not json', 'tok')).toBeNull();
    expect(parsePageMessage(env('tok', { kind: 'evil' }), 'tok')).toBeNull();
    expect(parsePageMessage(env('tok', { kind: 'commandResult', id: '1', ok: true }), 'tok')).toBeNull();
    expect(parsePageMessage(env('tok', { kind: 'commandResult', id: 1, ok: true, clipboardText: 5 }), 'tok')).toBeNull();
    expect(parsePageMessage(env('tok', { kind: 'playback', state: 'exploding' }), 'tok')).toBeNull();
    expect(parsePageMessage(env('tok', { kind: 'clipboard', text: 5 }), 'tok')).toBeNull();
  });

  test('selection menu clipboard messages', () => {
    expect(parsePageMessage(env('tok', { kind: 'clipboard', text: 'myLeads' }), 'tok')).toEqual({ kind: 'clipboard', text: 'myLeads' });
    expect(parsePageMessage(env('tok', { kind: 'pasteRequest' }), 'tok')).toEqual({ kind: 'pasteRequest' });
    // Only this session's runtime may write the clipboard (not the lesson preview iframe).
    expect(parsePageMessage(env('other', { kind: 'clipboard', text: 'x' }), 'tok')).toBeNull();
  });

  test('jsLiteral escapes line separators and script terminators', () => {
    const s = jsLiteral({ a: ' </script>' });
    expect(s).not.toContain(' ');
    expect(s).not.toMatch(/<\/script/i);
    expect(eval(`(${s})`)).toEqual({ a: ' </script>' });
  });

  test('injected scripts embed config + token and end with true', () => {
    const js = buildMainScript(DEFAULT_RUNTIME_CONFIG, 'tok');
    expect(js).toContain('__SC_BOOT_CONFIG__');
    expect(js).toContain('"tok"');
    expect(js.trim().endsWith('true;')).toBe(true);
    expect(buildCommandScript({ kind: 'requestDiagnostics' })).toContain('__SC__');
  });

  test('injected scripts only run on scrimba.com (never on sign-in pages)', () => {
    const runsOn = (href: string) => {
      const location = new URL(href);
      return new Function('location', `return ${SCRIMBA_PAGE_CHECK};`)(location) as boolean;
    };
    expect(runsOn('https://scrimba.com/learn-react-c0e')).toBe(true);
    expect(runsOn('https://www.scrimba.com/')).toBe(true);
    expect(runsOn('https://github.com/login/oauth/authorize?x=1')).toBe(false);
    expect(runsOn('https://accounts.google.com/o/oauth2')).toBe(false);
    expect(runsOn('https://cw1.scrimba.com/preview')).toBe(false); // learner code runs there
    expect(runsOn('https://scrimba.com.evil.example/')).toBe(false);
    expect(runsOn('http://scrimba.com/')).toBe(false);
    expect(buildMainScript(DEFAULT_RUNTIME_CONFIG, 'tok').startsWith(`if(${SCRIMBA_PAGE_CHECK})`)).toBe(true);
    expect(buildEarlyScript().startsWith(`if(${SCRIMBA_PAGE_CHECK})`)).toBe(true);
    // Commands may carry clipboard text (paste): never delivered to other pages.
    expect(buildCommandScript({ kind: 'editor', id: 1, command: { type: 'paste', text: 'x' } }).startsWith(`if(${SCRIMBA_PAGE_CHECK})`)).toBe(true);
  });

  test('native side accepts messages only while on scrimba.com', () => {
    expect(isScrimbaPageUrl('https://scrimba.com/s0abc')).toBe(true);
    expect(isScrimbaPageUrl('https://github.com/login')).toBe(false);
    expect(isScrimbaPageUrl('https://evilscrimba.com/')).toBe(false);
    expect(isScrimbaPageUrl(undefined)).toBe(false);
    expect(isScrimbaPageUrl('not a url')).toBe(false);
  });

  test('session tokens are non-trivial', () => {
    const a = createSessionToken();
    expect(a.length).toBeGreaterThan(12);
    expect(createSessionToken()).not.toBe(a);
  });
});

describe('PageBridge', () => {
  test('command → result round trip', async () => {
    const injected: string[] = [];
    const b = new PageBridge((js) => injected.push(js), 'tok');
    const p = b.command({ type: 'undo' });
    expect(injected[0]).toContain('"undo"');
    const id = Number(/"id":(\d+)/.exec(injected[0])![1]);
    b.handleRaw(env('tok', { kind: 'commandResult', id, ok: true, clipboardText: 'x' }));
    await expect(p).resolves.toEqual({ ok: true, error: undefined, clipboardText: 'x' });
    expect(b.pendingCount).toBe(0);
  });

  test('times out and resets on reload', async () => {
    jest.useFakeTimers();
    const b = new PageBridge(() => undefined, 'tok');
    const p1 = b.command({ type: 'redo' }, 100);
    jest.advanceTimersByTime(150);
    await expect(p1).resolves.toMatchObject({ ok: false, error: 'timeout' });
    const p2 = b.command({ type: 'redo' }, 10_000);
    b.reset();
    await expect(p2).resolves.toMatchObject({ ok: false, error: 'page-reloaded' });
    jest.useRealTimers();
  });

  test('a forged result from another frame cannot resolve a pending command', async () => {
    jest.useFakeTimers();
    const b = new PageBridge(() => undefined, 'tok');
    const p = b.command({ type: 'copy' }, 100);
    expect(b.handleRaw(env('other', { kind: 'commandResult', id: 1, ok: true, clipboardText: 'phish' }))).toBeNull();
    jest.advanceTimersByTime(150);
    await expect(p).resolves.toMatchObject({ ok: false });
    jest.useRealTimers();
  });

  test('injector failures are swallowed', () => {
    const b = new PageBridge(() => {
      throw new Error('not mounted');
    }, 'tok');
    expect(() => b.send({ kind: 'requestDiagnostics' })).not.toThrow();
  });
});

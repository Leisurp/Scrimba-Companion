import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, SETTINGS_KEY, toRuntimeConfig } from '../../src/state/settings';
import { clearLastLocation, loadLastLocation, saveLastLocation } from '../../src/state/session';
import { RecoveryStore, snapshotKey, type SnapshotStorage } from '../../src/state/recovery';
import { classifyNavigation, isGitHubSignIn, isGoogleOAuth, isScrimbaGitHubCallback, looksLikeLesson, sanitizeResumeUrl, scrimbaGitHubAuthorize } from '../../src/webview/urlPolicy';
import { PENDING_TTL_MS, hasBrowserSignInWorked, routeCallback, startPendingSignIn, takeCallback } from '../../src/state/browserSignIn';
import { DESKTOP_USER_AGENT, resolveMode, userAgentProps } from '../../src/webview/userAgent';
import { redactDeep, redactText, redactUrl } from '../../src/diagnostics/redact';
import { buildReport, webViewVersionFromUA } from '../../src/diagnostics/report';
import { DiagnosticsStore } from '../../src/diagnostics/store';
import { applyLineEdit, computeLineEdit } from '../../src/editor/lineDiff';
import { TOOLBAR_ACTIONS, getAction } from '../../src/editor/toolbarActions';
import { fnv1a } from '../../src/shared/hash';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('settings', () => {
  test('defaults round-trip through storage', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    await saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark', captionScale: 1.5 });
    expect(await loadSettings()).toMatchObject({ theme: 'dark', captionScale: 1.5 });
  });

  test('corrupt or hostile stored data falls back safely', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, '{nope');
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ compatMode: 'evil', captionScale: 99, captionBackgroundOpacity: -3, touchFix: 'yes', theme: 'dark' });
    expect(s.compatMode).toBe('auto');
    expect(s.captionScale).toBe(2.5);
    expect(s.captionBackgroundOpacity).toBe(0);
    expect(s.touchFix).toBe(true);
    expect(s.theme).toBe('dark');
    expect(sanitizeSettings({ captionBackgroundOpacity: null }).captionBackgroundOpacity).toBeNull();
  });

  test('maps to the page runtime config', () => {
    const c = toRuntimeConfig({ ...DEFAULT_SETTINGS, editingStrategy: 'bridge', captionPosition: 'top' }, true);
    expect(c).toMatchObject({ editingStrategy: 'bridge', debug: true, captions: { position: 'top', scale: 1 }, touchSelection: true });
    expect(toRuntimeConfig({ ...DEFAULT_SETTINGS, touchSelection: false }, false).touchSelection).toBe(false);
    expect(sanitizeSettings({ touchSelection: 'no' }).touchSelection).toBe(true);
  });
});

describe('last lesson', () => {
  test('stores only sanitised Scrimba paths', async () => {
    expect(await saveLastLocation('https://scrimba.com/learn-react-c0e/~01?token=abc#x', 'React')).toBe(true);
    expect(await loadLastLocation()).toMatchObject({ url: 'https://scrimba.com/learn-react-c0e/~01', title: 'React' });
    expect(await saveLastLocation('https://evil.example/s0abc', 'x')).toBe(false);
    expect(await saveLastLocation('https://scrimba.com/login', 'x')).toBe(false);
    await clearLastLocation();
    expect(await loadLastLocation()).toBeNull();
  });
});

describe('url policy', () => {
  test.each([
    ['https://scrimba.com/s0v687325e', true, 'allow'],
    ['https://www.scrimba.com/x', true, 'allow'],
    ['https://github.com/login/oauth/authorize?x', true, 'allow'],
    ['https://example.com', true, 'external'],
    ['mailto:a@b.c', true, 'external'],
    ['intent://scan/#Intent;scheme=zxing;end', true, 'block'],
    ['file:///etc/passwd', true, 'block'],
    ['javascript:alert(1)', true, 'block'],
    ['https://402z.local-corp.webcontainer-api.io/', false, 'allow'],
    ['https://anything.example/preview', false, 'allow'],
    ['file:///sdcard/x', false, 'block'],
    ['about:blank', true, 'allow'],
    ['http://scrimba.com/', true, 'external'],
  ])('%s (top=%s) → %s', (url, top, expected) => {
    expect(classifyNavigation(url, top)).toBe(expected);
  });

  test('google oauth detection', () => {
    expect(isGoogleOAuth('https://accounts.google.com/o/oauth2/v2/auth?client_id=1')).toBe(true);
    expect(isGoogleOAuth('https://accounts.google.com/')).toBe(false);
  });

  test('resume + lesson heuristics', () => {
    expect(sanitizeResumeUrl('https://scrimba.com/s0v687325e/s0f32m4745/head?x=1')).toBe('https://scrimba.com/s0v687325e/s0f32m4745/head');
    expect(sanitizeResumeUrl('https://scrimba.com/sign-up')).toBeNull();
    expect(looksLikeLesson('https://scrimba.com/s0v687325e')).toBe(true);
    expect(looksLikeLesson('https://scrimba.com/learn-react-c0e/~05')).toBe(true);
    expect(looksLikeLesson('https://scrimba.com/courses')).toBe(false);
  });
});

describe('GitHub sign-in page', () => {
  test('matches the sign-in form, not the OAuth consent page', () => {
    expect(isGitHubSignIn('https://github.com/login?client_id=abc&return_to=%2Flogin%2Foauth%2Fauthorize')).toBe(true);
    expect(isGitHubSignIn('https://github.com/session')).toBe(true);
    expect(isGitHubSignIn('https://github.com/login/oauth/authorize?client_id=abc')).toBe(false);
    expect(isGitHubSignIn('https://scrimba.com/login')).toBe(false);
    expect(isGitHubSignIn('https://gist.github.com/login')).toBe(false);
  });
});

describe('GitHub sign-in in the browser', () => {
  const AUTH =
    'https://github.com/login/oauth/authorize?client_id=7b945f0c7ec7ac8a60e5&redirect_uri=https%3A%2F%2Fscrimba.com%2Fauth%2Fgithub%2Fcallback&scope=user%3Aemail&state=s123';
  const LOGIN =
    'https://github.com/login?client_id=7b945f0c7ec7ac8a60e5&return_to=%2Flogin%2Foauth%2Fauthorize%3Fclient_id%3D7b945f0c7ec7ac8a60e5%26redirect_uri%3Dhttps%253A%252F%252Fscrimba.com%252Fauth%252Fgithub%252Fcallback%26scope%3Duser%253Aemail%26state%3Ds123';

  test("recognises Scrimba's authorize step, directly or via GitHub's sign-in page", () => {
    expect(scrimbaGitHubAuthorize(AUTH)).toEqual({ url: expect.stringContaining('/login/oauth/authorize?'), state: 's123' });
    const viaLogin = scrimbaGitHubAuthorize(LOGIN);
    expect(viaLogin?.state).toBe('s123');
    expect(new URL(viaLogin!.url).searchParams.get('redirect_uri')).toBe('https://scrimba.com/auth/github/callback');
  });

  test('ignores other OAuth apps and plain GitHub sign-in', () => {
    expect(scrimbaGitHubAuthorize(AUTH.replace('scrimba.com', 'evil.example'))).toBeNull();
    expect(scrimbaGitHubAuthorize('https://github.com/login')).toBeNull();
    expect(scrimbaGitHubAuthorize('https://github.com/login?return_to=%2Fsettings')).toBeNull();
    expect(scrimbaGitHubAuthorize(AUTH.replace('&state=s123', ''))).toBeNull();
    expect(scrimbaGitHubAuthorize(AUTH.replace('https://github.com', 'https://github.com.evil.example'))).toBeNull();
  });

  test('callback matching', () => {
    expect(isScrimbaGitHubCallback('https://scrimba.com/auth/github/callback?code=c&state=s')).toBe(true);
    expect(isScrimbaGitHubCallback('https://scrimba.com/auth/google/callback?code=c')).toBe(false);
    expect(isScrimbaGitHubCallback('http://scrimba.com/auth/github/callback?code=c')).toBe(false);
  });

  test('routes only the sign-in the app started back into the WebView', () => {
    const cb = 'https://scrimba.com/auth/github/callback?code=c&state=s123';
    const now = 1_000_000;
    expect(routeCallback(cb, { state: 's123', at: now - 1000 }, now)).toBe('webview');
    expect(routeCallback(cb, { state: 'other', at: now - 1000 }, now)).toBe('browser');
    expect(routeCallback(cb, { state: 's123', at: now - PENDING_TTL_MS - 1 }, now)).toBe('browser');
    expect(routeCallback(cb, null, now)).toBe('browser');
  });

  test('a matching callback is consumed once and marks the setup as working', async () => {
    const cb = 'https://scrimba.com/auth/github/callback?code=c&state=abc';
    expect(await hasBrowserSignInWorked()).toBe(false);
    await startPendingSignIn('abc');
    expect(await takeCallback(cb)).toBe('webview');
    expect(await hasBrowserSignInWorked()).toBe(true);
    expect(await takeCallback(cb)).toBe('browser');
  });
});

describe('user agent modes', () => {
  test('auto resolves to mobile; desktop replaces the UA', () => {
    expect(resolveMode('auto')).toBe('mobile');
    expect(resolveMode('desktop')).toBe('desktop');
    expect(userAgentProps('desktop')).toEqual({ userAgent: DESKTOP_USER_AGENT });
    expect(userAgentProps('mobile').userAgent).toBeUndefined();
    expect(DESKTOP_USER_AGENT).not.toMatch(/Mobile|Android|wv/);
  });
});

describe('redaction', () => {
  test('urls keep host/path but drop query and fragment', () => {
    expect(redactUrl('https://scrimba.com/s0abc?session=XYZ#t=1')).toBe('https://scrimba.com/s0abc?[redacted]#[redacted]');
    expect(redactUrl('https://x.webcontainer-api.io/402z6kqbbecylw5fwwhq4e6ntjz6fb/')).toBe('https://x.webcontainer-api.io/[id]/');
  });

  test('tokens, emails, cookies, long secrets are masked', () => {
    const t = redactText('cookie: abc=1; token=sk_live_123 user a.b@c.io jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
    expect(t).not.toMatch(/sk_live_123|a\.b@c\.io|eyJhbGci/);
    expect(t).toContain('[email]');
    expect(t).toContain('[jwt]');
  });

  test('redactDeep masks sensitive keys entirely', () => {
    expect(redactDeep({ a: { password: 'hunter2', cookie: 'c', nested: ['https://scrimba.com/?q=1'] } })).toEqual({
      a: { password: '[redacted]', cookie: '[redacted]', nested: ['https://scrimba.com/?[redacted]'] },
    });
  });

  test('report never contains snapshot code or model identity', () => {
    const store = new DiagnosticsStore();
    store.update({
      editor: { detected: true, kind: 'monaco', editorCount: 1, focused: true, dirty: true, hasSelection: false, lineNumber: 3, column: 4, language: 'js', readOnly: false, modelUri: 'file:///secret/name.js', contentHash: 'abcd1234' },
    });
    store.log('info', 'nav', 'went to https://scrimba.com/s0abc?auth=SECRET');
    const report = buildReport(store.get(), { appVersion: '1', buildVersion: '1', platform: 'android', osVersion: '15', deviceModel: 'Pixel', isDevice: true }, { theme: 'dark' });
    expect(report).not.toMatch(/SECRET|secret\/name|abcd1234/);
    expect(report).toContain('Unofficial');
  });

  test('webview version parsing', () => {
    expect(webViewVersionFromUA('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/131.0.6778.39 Mobile Safari/537.36')).toBe('Chromium 131.0.6778.39');
    expect(webViewVersionFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15')).toBe('WebKit 605.1.15 (iOS 18.1)');
  });
});

describe('line diff (native bridge)', () => {
  test.each([
    ['abc', 'abXc', { start: 2, end: 2, text: 'X' }],
    ['abc', 'ac', { start: 1, end: 2, text: '' }],
    ['hello world', 'hello there', { start: 6, end: 11, text: 'there' }],
    ['', 'x', { start: 0, end: 0, text: 'x' }],
    ['fn(a)', 'fn(a, b)', { start: 4, end: 4, text: ', b' }],
  ])('%j → %j', (prev, next, edit) => {
    const e = computeLineEdit(prev, next)!;
    expect(e).toEqual(edit);
    expect(applyLineEdit(prev, e)).toBe(next);
  });

  test('cursor hint disambiguates repeated characters', () => {
    expect(computeLineEdit('aa', 'aaa', 1)).toEqual({ start: 0, end: 0, text: 'a' });
    expect(computeLineEdit('aa', 'aaa')).toEqual({ start: 2, end: 2, text: 'a' });
  });

  test('no-op returns null', () => {
    expect(computeLineEdit('x', 'x')).toBeNull();
  });

  test('random edits always reproduce the target', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const alphabet = 'ab{}() \t;';
    for (let i = 0; i < 300; i++) {
      const mk = () => Array.from({ length: Math.floor(rnd() * 12) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
      const a = mk();
      const b = mk();
      const e = computeLineEdit(a, b);
      expect(e ? applyLineEdit(a, e) : a).toBe(b);
    }
  });
});

describe('toolbar actions', () => {
  test('contain the required coding keys with real commands', () => {
    for (const id of ['tab', 'braces', 'parens', 'brackets', 'arrow', 'semicolon', 'dquote', 'squote', 'undo', 'redo'] as const) {
      expect(getAction(id).command).not.toBeNull();
    }
    expect(getAction('braces').command).toEqual({ type: 'insertPair', open: '{', close: '}' });
    expect(new Set(TOOLBAR_ACTIONS.map((a) => a.id)).size).toBe(TOOLBAR_ACTIONS.length);
    expect(TOOLBAR_ACTIONS.every((a) => a.accessibilityLabel.length > 2)).toBe(true);
  });
});

describe('recovery snapshots', () => {
  function memoryStorage(): SnapshotStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      write: async (k, v) => void data.set(k, v),
      read: async (k) => data.get(k) ?? null,
      remove: async (k) => void data.delete(k),
      list: async () => [...data.keys()],
    };
  }

  test('save/get/discard keyed by page + model', async () => {
    let now = 1_000_000;
    const st = memoryStorage();
    const r = new RecoveryStore(st, () => now);
    await r.save('https://scrimba.com/s0a', 'file:///a.js', 'code A');
    expect((await r.get('https://scrimba.com/s0a', 'file:///a.js'))?.content).toBe('code A');
    expect(await r.get('https://scrimba.com/s0a', 'file:///b.js')).toBeNull();
    now += 8 * 24 * 3600 * 1000;
    expect(await r.get('https://scrimba.com/s0a', 'file:///a.js')).toBeNull();
    expect(st.data.size).toBe(0);
  });

  test('prunes to the newest 20', async () => {
    let now = 1;
    const st = memoryStorage();
    const r = new RecoveryStore(st, () => now++);
    for (let i = 0; i < 25; i++) await r.save(`https://scrimba.com/s0${i}`, 'file:///x', String(i));
    expect(st.data.size).toBe(20);
    expect(st.data.has(snapshotKey('https://scrimba.com/s024', 'file:///x'))).toBe(true);
    expect(st.data.has(snapshotKey('https://scrimba.com/s00', 'file:///x'))).toBe(false);
  });

  test('clearAll removes every snapshot (sign out and clear data)', async () => {
    const st = memoryStorage();
    const r = new RecoveryStore(st, () => 1);
    await r.save('https://scrimba.com/s0a', 'file:///a.js', 'A');
    await r.save('https://scrimba.com/s0b', 'file:///b.js', 'B');
    await r.clearAll();
    expect(st.data.size).toBe(0);
  });

  test('hash is stable and shared with the page runtime', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});

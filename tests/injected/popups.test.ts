/**
 * @jest-environment jsdom
 */
import { createStandInPopup, installSingleWindowPopups, isBlankPopupUrl } from '../../src/injected/popups';

function fakeWin(href = 'https://scrimba.com/learn-react-c0e') {
  const assign = jest.fn();
  const open = jest.fn(() => null);
  const win = { location: { href, assign }, open } as unknown as Window;
  return { win, assign, open };
}

describe('single-window popups (iOS)', () => {
  test('only empty popups get a stand-in', () => {
    expect(isBlankPopupUrl('about:blank')).toBe(true);
    expect(isBlankPopupUrl('')).toBe(true);
    expect(isBlankPopupUrl(undefined)).toBe(true);
    expect(isBlankPopupUrl('https://scrimba.com/auth/github')).toBe(false);
  });

  test("Scrimba's sign-in sequence navigates this window to /auth/github", () => {
    const { win, assign, open } = fakeWin();
    const realOpen = open;
    installSingleWindowPopups(win);
    // Traced on scrimba.com 2026-11-15.
    const w = win.open('about:blank', '_blank', 'popup,left=1,top=2,width=3,height=4')!;
    expect(realOpen).not.toHaveBeenCalled();
    w.addEventListener('message', () => undefined);
    w.addEventListener('load', () => undefined);
    expect(w.closed).toBe(false);
    (w as unknown as { location: string }).location = '/auth/github';
    expect(assign).toHaveBeenCalledWith('https://scrimba.com/auth/github');
  });

  test('popups with a URL still go to the WebView', () => {
    const { win, open } = fakeWin();
    installSingleWindowPopups(win);
    win.open('https://example.com/', '_blank');
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank');
  });

  test('location.href, assign and replace navigate; non-web URLs and closed popups do not', () => {
    const { win, assign } = fakeWin();
    const w = createStandInPopup(win);
    w.location.href = 'https://github.com/login';
    w.location.replace('/a');
    w.location.assign('/b');
    (w as unknown as { location: string }).location = 'javascript:alert(1)';
    expect(assign.mock.calls.map((c) => c[0])).toEqual(['https://github.com/login', 'https://scrimba.com/a', 'https://scrimba.com/b']);
    w.close();
    expect(w.closed).toBe(true);
    w.location.href = '/c';
    expect(assign).toHaveBeenCalledTimes(3);
  });
});

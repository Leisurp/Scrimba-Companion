/**
 * @jest-environment jsdom
 */
import { readPlaybackState, findPlayToggle } from '../../src/injected/modules/playback';
import { buildCaptionCss, findCaptionElement } from '../../src/injected/modules/subtitles';
import { collapse, expand, FS_ATTR, FS_CHAIN_ATTR, isTransparent, opaqueBackground } from '../../src/injected/modules/fullscreen';
import { computeMode } from '../../src/injected/modules/layout';
import { startRuntime, mergeConfig, type Runtime } from '../../src/injected/runtime';
import { resetStylesForTests } from '../../src/injected/core';
import { installEarlyHooks } from '../../src/injected/early';
import { DEFAULT_RUNTIME_CONFIG, type PageToNative } from '../../src/shared/protocol';

function playControls(state: 'playing' | 'paused') {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<scrim-play-controls><op-icon class="play"><svg class="yr_af ${state === 'playing' ? 'pause' : 'play'} phosphor filled"></svg></op-icon></scrim-play-controls>`,
  );
  return document.querySelector('scrim-play-controls op-icon.play')!;
}

afterEach(() => {
  resetStylesForTests();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-sc-cap-pos');
});

describe('playback detection', () => {
  test('reads state from Scrimba icon (pause icon = playing)', () => {
    expect(readPlaybackState(document)).toBe('unknown');
    playControls('playing');
    expect(readPlaybackState(document)).toBe('playing');
    document.querySelector('svg')!.setAttribute('class', 'yr_af play phosphor filled');
    expect(readPlaybackState(document)).toBe('paused');
  });

  test('falls back to accessible Play/Pause controls', () => {
    document.body.innerHTML = '<button aria-label="Pause"></button>';
    expect(findPlayToggle(document)).not.toBeNull();
    expect(readPlaybackState(document)).toBe('playing');
  });

  test('pause() clicks the toggle only when playing; play is never automatic', () => {
    const icon = playControls('playing');
    const clicks = jest.fn(() => document.querySelector('svg')!.setAttribute('class', 'play'));
    icon.addEventListener('click', clicks);
    const rt = startRuntime(window, { tickMs: 0 });
    rt.receive({ kind: 'playback', action: 'pause' });
    expect(clicks).toHaveBeenCalledTimes(1);
    rt.receive({ kind: 'playback', action: 'pause' });
    expect(clicks).toHaveBeenCalledTimes(1); // already paused: no toggle
    rt.receive({ kind: 'appState', state: 'active' });
    expect(clicks).toHaveBeenCalledTimes(1); // returning to the app never resumes
    rt.stop();
  });

  test('backgrounding the app pauses playback', () => {
    const icon = playControls('playing');
    const clicks = jest.fn();
    icon.addEventListener('click', clicks);
    const rt = startRuntime(window, { tickMs: 0 });
    rt.receive({ kind: 'appState', state: 'background' });
    expect(clicks).toHaveBeenCalledTimes(1);
    rt.stop();
  });

  test('early hooks track media play() and record rejections', async () => {
    installEarlyHooks(window);
    const early = (window as unknown as { __SC_EARLY__: { media: unknown[]; mediaErrors: string[] } }).__SC_EARLY__;
    const audio = document.createElement('audio');
    HTMLMediaElement.prototype.play.call(audio)?.catch?.(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(early.media.length).toBeGreaterThanOrEqual(typeof WeakRef === 'function' ? 1 : 0);
  });
});

describe('subtitles', () => {
  test('finds Scrimba caption element and generic fallbacks', () => {
    document.body.innerHTML = '<ide-clip-captions></ide-clip-captions>';
    expect(findCaptionElement(document)?.tagName.toLowerCase()).toBe('ide-clip-captions');
    document.body.innerHTML = '<x-lesson-subtitles></x-lesson-subtitles><caption-toggle></caption-toggle>';
    expect(findCaptionElement(document)?.tagName.toLowerCase()).toBe('x-lesson-subtitles');
  });

  test('CSS uses layout-neutral scale and never touches caption text', () => {
    const css = buildCaptionCss('ide-clip-captions');
    expect(css).toContain('scale:var(--sc-cap-scale,1)');
    expect(css).not.toMatch(/font-size|content:/);
  });

  test('config is applied as attributes/variables on <html>', () => {
    document.body.innerHTML = '<ide-clip-captions><div></div><div></div></ide-clip-captions>';
    const rt = startRuntime(window, { tickMs: 0 });
    rt.receive({ kind: 'config', config: mergeConfig(DEFAULT_RUNTIME_CONFIG, { captions: { scale: 1.4, backgroundOpacity: 0.8, position: 'top', whileEditing: 'hide' } }) });
    const html = document.documentElement;
    expect(html.style.getPropertyValue('--sc-cap-scale')).toBe('1.4');
    expect(html.style.getPropertyValue('--sc-cap-bg')).toBe('0.8');
    expect(html.getAttribute('data-sc-cap-pos')).toBe('top');
    expect(html.getAttribute('data-sc-cap-edit')).toBe('hide');
    expect(document.getElementById('sc-companion-style')?.textContent).toContain('ide-clip-captions');
    rt.receive({ kind: 'config', config: mergeConfig(DEFAULT_RUNTIME_CONFIG, { captions: { scale: 9, backgroundOpacity: null, position: 'default', whileEditing: 'show' } }) });
    expect(html.style.getPropertyValue('--sc-cap-scale')).toBe('2.5');
    expect(html.hasAttribute('data-sc-cap-bg')).toBe(false);
    rt.stop();
  });
});

describe('fullscreen + layout', () => {
  test('expand marks target and ancestor chain; collapse removes everything', () => {
    document.body.innerHTML = '<app-ide><div><si-file-view><si-monaco-editor><div class="monaco-editor"></div></si-monaco-editor></si-file-view></div></app-ide>';
    const host = document.querySelector('si-monaco-editor')!;
    expand(document, host);
    expect(host.hasAttribute(FS_ATTR)).toBe(true);
    expect(document.querySelectorAll(`[${FS_CHAIN_ATTR}]`).length).toBe(3);
    collapse(document);
    expect(document.querySelectorAll(`[${FS_ATTR}],[${FS_CHAIN_ATTR}]`).length).toBe(0);
  });

  test('layout command expands the real editor host and reports state', () => {
    document.body.innerHTML = '<si-file-view><si-monaco-editor><div class="monaco-editor"></div></si-monaco-editor></si-file-view>';
    (window as unknown as { __SC_OUTBOX__: PageToNative[] }).__SC_OUTBOX__ = [];
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
    const rt: Runtime = startRuntime(window, { tickMs: 0 });
    rt.receive({ kind: 'layout', fullscreenEditor: true });
    expect(document.querySelector('si-monaco-editor')!.hasAttribute(FS_ATTR)).toBe(true);
    const last = (window as unknown as { __SC_OUTBOX__: PageToNative[] }).__SC_OUTBOX__.filter((m) => m.kind === 'layoutState').pop();
    expect(last).toMatchObject({ fullscreenEditor: true, expandedPreview: false });
    rt.receive({ kind: 'layout', fullscreenEditor: false });
    expect(document.querySelector(`[${FS_ATTR}]`)).toBeNull();
    rt.stop();
  });

  test('full-screen background comes from the first opaque ancestor (Scrimba Monaco is transparent)', () => {
    expect(isTransparent('rgba(255, 255, 255, 0)')).toBe(true);
    expect(isTransparent('transparent')).toBe(true);
    expect(isTransparent('lch(11.28 5.58 125 / 0)')).toBe(true);
    expect(isTransparent('lch(11.28 5.58 125)')).toBe(false);
    expect(isTransparent('rgb(30, 30, 30)')).toBe(false);
    document.body.innerHTML = '<si-file-view style="background-color: rgb(20, 22, 24)"><si-monaco-editor><div class="monaco-editor" style="background-color: rgba(255,255,255,0)"></div></si-monaco-editor></si-file-view>';
    expect(opaqueBackground(window, document.querySelector('.monaco-editor'))).toBe('rgb(20, 22, 24)');
  });

  test('computeMode', () => {
    expect(computeMode(false, false)).toBe('watching');
    expect(computeMode(true, false)).toBe('editing');
    expect(computeMode(true, true)).toBe('previewing');
  });
});

describe('runtime robustness', () => {
  test('is idempotent (double injection returns the same runtime)', () => {
    const a = startRuntime(window, { tickMs: 0 });
    const b = startRuntime(window, { tickMs: 0 });
    expect(a).toBe(b);
    a.stop();
  });

  test('malformed native messages are logged, not thrown', () => {
    const rt = startRuntime(window, { tickMs: 0 });
    expect(() => rt.receive('{not json')).not.toThrow();
    expect(() => rt.receive({ kind: 'nope' } as never)).not.toThrow();
    expect(rt.ctx.logger.entries.some((e) => e.level === 'error' || e.level === 'warn')).toBe(true);
    rt.stop();
  });

  test('diagnostics contain no code or caption text', () => {
    document.body.innerHTML = '<ide-clip-captions>secret caption words</ide-clip-captions>';
    const rt = startRuntime(window, { tickMs: 0 });
    const d = JSON.stringify(rt.diagnostics());
    expect(d).not.toContain('secret caption words');
    expect(d).toContain('"found":true');
    rt.stop();
  });

  test('messages are wrapped with the session token when posting to native', () => {
    const posted: string[] = [];
    (window as unknown as Record<string, unknown>).ReactNativeWebView = { postMessage: (s: string) => posted.push(s) };
    (window as unknown as Record<string, unknown>).__SC_TOKEN__ = 'tok123';
    const rt = startRuntime(window, { tickMs: 0 });
    const env = JSON.parse(posted[posted.length - 1]);
    expect(env.t).toBe('tok123');
    expect(env.m.kind).toBeDefined();
    expect((window as unknown as Record<string, unknown>).__SC_TOKEN__).toBeUndefined();
    rt.stop();
    delete (window as unknown as Record<string, unknown>).ReactNativeWebView;
  });
});

describe('execution capability', () => {
  test('reports the runner as blocked without cross-origin isolation', () => {
    const { detectExecution, executionBlocked } = jest.requireActual('../../src/injected/modules/execution');
    document.body.innerHTML = '<si-runner-view></si-runner-view><iframe src="https://stackblitz.com/headless?version=1.5.3"></iframe>';
    const c = detectExecution(window);
    expect(c.webContainerExpected).toBe(true);
    // jsdom is not cross-origin isolated, like Android System WebView.
    expect(c.crossOriginIsolated).toBe(false);
    expect(executionBlocked(c)).toBe(true);
    expect(executionBlocked({ ...c, crossOriginIsolated: true, sharedArrayBuffer: true })).toBe(false);
    expect(executionBlocked({ ...c, webContainerExpected: false })).toBe(false);
  });
});

describe("Scrimba's runner DataCloneError toast", () => {
  const TOAST = (text: string) =>
    `<op-toast class="xv-af op-toast error enter"><div class="op-toast-body"><div class="xv-al"><op-tag class="otoast-body"><div>${text}</div></op-tag></div></div></op-toast>`;
  const DCE = "DataCloneError: Failed to execute 'postMessage' on 'Worker': Shar...";

  test('matches only the isolation failure toast', () => {
    const { hideRunnerIsolationToasts } = jest.requireActual('../../src/injected/modules/execution');
    document.body.innerHTML = TOAST(DCE) + TOAST('Saved') + `<div>${DCE}</div>`;
    expect(hideRunnerIsolationToasts(document)).toBe(1);
    const toasts = document.querySelectorAll<HTMLElement>('op-toast');
    expect(toasts[0].style.display).toBe('none');
    expect(toasts[1].style.display).toBe('');
    // Idempotent.
    expect(hideRunnerIsolationToasts(document)).toBe(0);
  });

  test('the runtime hides it as soon as Scrimba adds it (non-isolated page)', async () => {
    const rt: Runtime = startRuntime(window, { bridge: { post: () => undefined }, tickMs: 0 });
    document.body.insertAdjacentHTML('beforeend', TOAST(DCE));
    await Promise.resolve(); // MutationObserver callbacks are microtasks
    expect(document.querySelector<HTMLElement>('op-toast')!.style.display).toBe('none');
    rt.stop();
  });
});

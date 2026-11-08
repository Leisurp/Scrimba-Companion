/**
 * Playback/audio module.
 *
 * Evidence: Scrimba renders `scrim-play-controls` with an `op-icon.play` whose SVG class
 * contains `pause` while playing and `play` while paused. Instructor audio is a detached
 * HTMLAudioElement (`new Audio()`, WebM). Synthetic pointer sequences on the play icon
 * toggle playback (verified in Chromium).
 *
 * Policy: we only ever *pause* automatically (editing, backgrounding, audio route
 * changes, OS interruptions). Resuming is always left to the user.
 */
import type { PlaybackState } from '../../shared/protocol';
import { PAGE_EARLY_GLOBAL } from '../../shared/protocol';
import { activateElement, statusOf, type CompatModule, type Context } from '../core';

const NAME = 'playback';

export interface EarlyState {
  media: WeakRef<HTMLMediaElement>[];
  mediaErrors: string[];
  errors: string[];
}

export function getEarly(win: Window): EarlyState | null {
  return ((win as unknown as Record<string, EarlyState | undefined>)[PAGE_EARLY_GLOBAL]) || null;
}

export function findPlayToggle(doc: Document): Element | null {
  const controls = doc.querySelector('scrim-play-controls');
  const icon = controls?.querySelector('op-icon.play');
  if (icon) return icon;
  // Fallback: an accessible play/pause control.
  return doc.querySelector('[aria-label="Play"], [aria-label="Pause"], button[title="Play"], button[title="Pause"]');
}

export function readPlaybackState(doc: Document): PlaybackState {
  const toggle = findPlayToggle(doc);
  if (!toggle) return 'unknown';
  const svg = toggle.querySelector('svg');
  const cls = (svg?.getAttribute('class') || '') + ' ' + (toggle.getAttribute('class') || '');
  const label = toggle.getAttribute('aria-label') || toggle.getAttribute('title') || '';
  // The icon shows the action available: a "pause" icon means it is currently playing.
  if (/\bpause\b/i.test(cls) || /^pause$/i.test(label)) return 'playing';
  if (/\bplay\b/i.test(cls) || /^play$/i.test(label)) return 'paused';
  return 'unknown';
}

export function createPlaybackModule(): CompatModule & { pause(ctx: Context, reason: string): boolean; play(ctx: Context): boolean } {
  let observer: MutationObserver | null = null;
  let observedToggle: Element | null = null;
  const hookedMedia = new WeakSet<HTMLMediaElement>();
  let mediaCount = 0;

  function post(ctx: Context, reason?: string) {
    const s = readPlaybackState(ctx.doc);
    if (s !== ctx.state.playback) {
      ctx.state.playback = s;
      ctx.bridge.post({ kind: 'playback', state: s, reason });
      ctx.emit('playbackChanged');
    }
  }

  function pause(ctx: Context, reason: string): boolean {
    if (readPlaybackState(ctx.doc) !== 'playing') return false;
    const toggle = findPlayToggle(ctx.doc);
    if (!toggle) return false;
    activateElement(ctx.win, toggle);
    ctx.logger.log('info', NAME, `pause requested (${reason})`);
    setTimeout(() => ctx.guard(NAME, () => {
      if (readPlaybackState(ctx.doc) === 'playing') {
        ctx.logger.log('warn', NAME, `pause via control did not take effect (${reason})`);
      }
      post(ctx, reason);
    }), 350);
    return true;
  }

  function play(ctx: Context): boolean {
    if (readPlaybackState(ctx.doc) !== 'paused') return false;
    const toggle = findPlayToggle(ctx.doc);
    if (!toggle) return false;
    activateElement(ctx.win, toggle);
    setTimeout(() => ctx.guard(NAME, () => post(ctx, 'user')), 350);
    return true;
  }

  function hookMedia(ctx: Context) {
    const early = getEarly(ctx.win);
    const els: HTMLMediaElement[] = [];
    early?.media.forEach((ref) => {
      const m = ref.deref();
      if (m) els.push(m);
    });
    ctx.doc.querySelectorAll('audio, video').forEach((m) => els.push(m as HTMLMediaElement));
    mediaCount = els.length;
    for (const m of els) {
      if (hookedMedia.has(m)) continue;
      hookedMedia.add(m);
      m.addEventListener('error', () => {
        const code = m.error ? m.error.code : 0;
        early?.mediaErrors.push(`media error code=${code}`);
        ctx.logger.log('error', NAME, `audio/media error code=${code}`);
      });
      m.addEventListener('stalled', () => ctx.logger.log('warn', NAME, 'media stalled'));
      // OS-initiated pauses (audio focus loss, call, route change) can leave Scrimba's
      // timeline "playing" with silent audio. Bring Scrimba's own state in line.
      m.addEventListener('pause', () => {
        setTimeout(() => ctx.guard(NAME, () => {
          // Ignore seeks, buffering and natural ends: only a settled pause with data loaded counts.
          if (!m.paused || m.ended || m.seeking || m.readyState < 2) return;
          if (readPlaybackState(ctx.doc) === 'playing') {
            const anyPlaying = els.some((x) => !x.paused);
            if (!anyPlaying) pause(ctx, 'media-interrupted');
          }
        }), 600);
      });
    }
  }

  return {
    name: NAME,
    pause,
    play,
    init(ctx) {
      ctx.services.pausePlayback = (reason) => pause(ctx, reason);
      ctx.listen(ctx.doc, 'visibilitychange', () => ctx.guard(NAME, () => {
        if (ctx.doc.visibilityState === 'hidden') pause(ctx, 'hidden');
      }));
      const md = ctx.win.navigator.mediaDevices;
      if (md && typeof md.addEventListener === 'function') {
        ctx.listen(md, 'devicechange', () => ctx.guard(NAME, () => {
          if (ctx.config().pauseOnAudioRouteChange) pause(ctx, 'audio-route-change');
        }));
      }
    },
    tick(ctx) {
      const toggle = findPlayToggle(ctx.doc);
      if (toggle !== observedToggle) {
        observer?.disconnect();
        observedToggle = toggle;
        if (toggle && typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(() => ctx.guard(NAME, () => post(ctx)));
          observer.observe(toggle, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-label'] });
        }
      }
      post(ctx);
      hookMedia(ctx);
    },
    status(ctx) {
      const toggle = findPlayToggle(ctx.doc);
      return statusOf(ctx, NAME, !!toggle, !!toggle, `state=${readPlaybackState(ctx.doc)} media=${mediaCount}`);
    },
  };
}

export function playbackDiagnostics(ctx: Context) {
  const early = getEarly(ctx.win);
  let media = 0;
  early?.media.forEach((r) => {
    if (r.deref()) media++;
  });
  return {
    state: readPlaybackState(ctx.doc),
    controlsFound: !!findPlayToggle(ctx.doc),
    mediaElements: media + ctx.doc.querySelectorAll('audio, video').length,
    mediaErrors: (early?.mediaErrors || []).slice(-10),
  };
}

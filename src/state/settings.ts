/**
 * App preferences: types, defaults, validation and persistence.
 * Stored as JSON in AsyncStorage. Nothing sensitive lives here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CaptionPosition, CaptionsWhileEditing, EditingStrategy, RuntimeConfig } from '../shared/protocol';

export type CompatMode = 'auto' | 'mobile' | 'desktop';
export type ThemePreference = 'system' | 'light' | 'dark';
export type OrientationPreference = 'auto' | 'portrait' | 'landscape';
export type ToolbarVisibility = 'auto' | 'always' | 'never';

export interface Settings {
  compatMode: CompatMode;
  editingStrategy: EditingStrategy;
  touchFix: boolean;
  tapFocusAssist: boolean;
  touchSelection: boolean;
  autoPauseOnEdit: boolean;
  codingToolbar: ToolbarVisibility;
  captionScale: number;
  /** null = keep Scrimba's default caption background. */
  captionBackgroundOpacity: number | null;
  captionPosition: CaptionPosition;
  captionsWhileEditing: CaptionsWhileEditing;
  theme: ThemePreference;
  orientation: OrientationPreference;
  resumeLastLesson: boolean;
  pauseOnBackground: boolean;
  pauseOnAudioRouteChange: boolean;
  keepAwakeWhilePlaying: boolean;
  hideIosKeyboardAccessory: boolean;
  navBarCollapsed: boolean;
  developerMode: boolean;
}

export const SETTINGS_KEY = 'scrimba-companion.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  compatMode: 'auto',
  editingStrategy: 'direct',
  touchFix: true,
  tapFocusAssist: true,
  touchSelection: true,
  autoPauseOnEdit: true,
  codingToolbar: 'auto',
  captionScale: 1,
  captionBackgroundOpacity: null,
  captionPosition: 'default',
  captionsWhileEditing: 'dim',
  theme: 'system',
  orientation: 'auto',
  resumeLastLesson: true,
  pauseOnBackground: true,
  pauseOnAudioRouteChange: true,
  keepAwakeWhilePlaying: true,
  hideIosKeyboardAccessory: true,
  navBarCollapsed: false,
  developerMode: false,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Validates untrusted (stored or imported) data into a complete Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    compatMode: oneOf(r.compatMode, ['auto', 'mobile', 'desktop'] as const, d.compatMode),
    editingStrategy: oneOf(r.editingStrategy, ['direct', 'bridge'] as const, d.editingStrategy),
    touchFix: bool(r.touchFix, d.touchFix),
    tapFocusAssist: bool(r.tapFocusAssist, d.tapFocusAssist),
    touchSelection: bool(r.touchSelection, d.touchSelection),
    autoPauseOnEdit: bool(r.autoPauseOnEdit, d.autoPauseOnEdit),
    codingToolbar: oneOf(r.codingToolbar, ['auto', 'always', 'never'] as const, d.codingToolbar),
    captionScale: num(r.captionScale, 0.6, 2.5, d.captionScale),
    captionBackgroundOpacity:
      r.captionBackgroundOpacity === null ? null : num(r.captionBackgroundOpacity, 0, 1, d.captionBackgroundOpacity ?? 0.6),
    captionPosition: oneOf(r.captionPosition, ['default', 'raised', 'top'] as const, d.captionPosition),
    captionsWhileEditing: oneOf(r.captionsWhileEditing, ['show', 'dim', 'hide'] as const, d.captionsWhileEditing),
    theme: oneOf(r.theme, ['system', 'light', 'dark'] as const, d.theme),
    orientation: oneOf(r.orientation, ['auto', 'portrait', 'landscape'] as const, d.orientation),
    resumeLastLesson: bool(r.resumeLastLesson, d.resumeLastLesson),
    pauseOnBackground: bool(r.pauseOnBackground, d.pauseOnBackground),
    pauseOnAudioRouteChange: bool(r.pauseOnAudioRouteChange, d.pauseOnAudioRouteChange),
    keepAwakeWhilePlaying: bool(r.keepAwakeWhilePlaying, d.keepAwakeWhilePlaying),
    hideIosKeyboardAccessory: bool(r.hideIosKeyboardAccessory, d.hideIosKeyboardAccessory),
    navBarCollapsed: bool(r.navBarCollapsed, d.navBarCollapsed),
    developerMode: bool(r.developerMode, d.developerMode),
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Settings → configuration pushed into the page runtime. */
export function toRuntimeConfig(s: Settings, debug: boolean): RuntimeConfig {
  return {
    touchFix: s.touchFix,
    tapFocusAssist: s.tapFocusAssist,
    touchSelection: s.touchSelection,
    autoPauseOnEdit: s.autoPauseOnEdit,
    editingStrategy: s.editingStrategy,
    captions: {
      scale: s.captionScale,
      backgroundOpacity: s.captionBackgroundOpacity,
      position: s.captionPosition,
      whileEditing: s.captionsWhileEditing,
    },
    pauseOnAudioRouteChange: s.pauseOnAudioRouteChange,
    debug,
  };
}

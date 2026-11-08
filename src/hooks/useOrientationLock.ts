import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { OrientationPreference } from '../state/settings';

export function lockFor(pref: OrientationPreference): ScreenOrientation.OrientationLock {
  switch (pref) {
    case 'portrait':
      return ScreenOrientation.OrientationLock.PORTRAIT_UP;
    case 'landscape':
      return ScreenOrientation.OrientationLock.LANDSCAPE;
    default:
      return ScreenOrientation.OrientationLock.DEFAULT;
  }
}

/** Applies the orientation preference. 'auto' follows the device (and the OS rotation lock). */
export function useOrientationLock(pref: OrientationPreference, onError?: (e: unknown) => void): void {
  useEffect(() => {
    ScreenOrientation.lockAsync(lockFor(pref)).catch((e) => onError?.(e));
  }, [pref, onError]);
}

export function nextOrientation(pref: OrientationPreference): OrientationPreference {
  return pref === 'auto' ? 'landscape' : pref === 'landscape' ? 'portrait' : 'auto';
}

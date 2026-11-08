import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

export interface SoftKeyboardState {
  visible: boolean;
  height: number;
}

/**
 * Tracks the platform soft keyboard. Android uses `adjustResize` (see app.json) so the
 * window already shrinks; iOS needs the height to lift the coding toolbar.
 * Hardware keyboards do not fire these events.
 */
export function useSoftKeyboard(): SoftKeyboardState {
  const [state, setState] = useState<SoftKeyboardState>({ visible: false, height: 0 });
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setState({ visible: true, height: e.endCoordinates?.height ?? 0 });
    const onHide = () => setState({ visible: false, height: 0 });
    const a = Keyboard.addListener(showEvt, onShow);
    const b = Keyboard.addListener(hideEvt, onHide);
    const c = Platform.OS === 'ios' ? Keyboard.addListener('keyboardWillChangeFrame', onShow) : null;
    return () => {
      a.remove();
      b.remove();
      c?.remove();
    };
  }, []);
  return state;
}

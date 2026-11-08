import { requireOptionalNativeModule } from 'expo';

interface AudioSessionNative {
  /**
   * Sets the iOS audio session category to playback, so lesson audio in the WebView is not
   * muted by the silent switch. Returns false if iOS refused. Does not activate the session,
   * so other apps' audio keeps playing until a lesson actually plays sound.
   */
  setPlaybackCategory(): boolean;
}

/** iOS only; null on Android (not needed there), in tests and in Expo Go. */
export const AudioSession = requireOptionalNativeModule<AudioSessionNative>('AudioSessionModule');

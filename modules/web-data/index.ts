import { requireOptionalNativeModule } from 'expo';

interface WebDataNative {
  /** Removes all cookies and website data (storage, IndexedDB, caches) of the app's WebViews. */
  clearAll(): Promise<boolean>;
}

/** Null where the native module isn't built in (tests, Expo Go). */
export const WebData = requireOptionalNativeModule<WebDataNative>('WebDataModule');

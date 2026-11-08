import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { SettingsProvider, useSettings } from './src/state/SettingsContext';
import { loadLastLocation } from './src/state/session';
import { BrowserScreen } from './src/screens/BrowserScreen';
import { usePalette } from './src/theme/theme';
import { SCRIMBA_HOME } from './src/config/constants';
import { AudioSession } from './modules/audio-session';

function Root() {
  const { settings, loaded } = useSettings();
  const palette = usePalette(settings.theme);
  const [initialUrl, setInitialUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded || initialUrl) return;
    const resume = settings.resumeLastLesson ? loadLastLocation() : Promise.resolve(null);
    resume.then((last) => setInitialUrl(last?.url ?? SCRIMBA_HOME));
  }, [loaded, settings.resumeLastLesson, initialUrl]);

  if (!initialUrl) {
    return (
      <View style={[styles.splash, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  return <BrowserScreen initialUrl={initialUrl} />;
}

export default function App() {
  // iOS: lesson audio must play with the silent switch on (no-op elsewhere).
  useEffect(() => {
    AudioSession?.setPlaybackCategory();
  }, []);

  return (
    // initialMetrics: the first frame already knows the status-bar/cutout insets, so the
    // app toolbar never renders under the status bar while insets are still unknown.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SettingsProvider>
        <Root />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

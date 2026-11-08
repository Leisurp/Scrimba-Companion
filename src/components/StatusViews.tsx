import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Palette } from '../theme/theme';

export function OfflineBanner({ palette, onRetry }: { palette: Palette; onRetry(): void }) {
  return (
    <View testID="offline-banner" accessibilityRole="alert" style={[styles.banner, { backgroundColor: palette.warning }]}>
      <Text style={styles.bannerText}>You’re offline. Lessons need a connection; your settings are safe.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.bannerBtn}>
        <Text style={styles.bannerBtnText}>Retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * Shown when the lesson's code runner cannot work in this WebView (no cross-origin
 * isolation → no SharedArrayBuffer → no WebContainer). Editing still works.
 */
export function ExecutionNotice({ palette, onOpenInBrowser, onDismiss }: { palette: Palette; onOpenInBrowser(): void; onDismiss(): void }) {
  return (
    <View
      testID="execution-notice"
      accessibilityRole="alert"
      accessibilityLabel="Code can’t run in the in-app browser: it lacks cross-origin isolation, which Scrimba's code runner needs. Editing still works."
      style={[styles.notice, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}
    >
      <Text style={[styles.noticeText, { color: palette.text }]} numberOfLines={2}>
        Code can’t run in the in-app browser (no cross-origin isolation). Editing works.
      </Text>
      <Pressable testID="execution-open-browser" accessibilityRole="button" onPress={onOpenInBrowser} style={styles.noticeBtn}>
        <Text style={{ color: palette.accent, fontWeight: '700' }}>Open in browser</Text>
      </Pressable>
      <Pressable testID="execution-dismiss" accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} style={styles.noticeBtn}>
        <Text style={{ color: palette.textMuted, fontWeight: '700' }}>✕</Text>
      </Pressable>
    </View>
  );
}

/**
 * Shown on GitHub's sign-in page inside the app. GitHub hides "Continue with Google" in
 * embedded WebViews, and Google blocks its sign-in there too, so accounts that only use
 * Google need a GitHub password (set once, in a real browser).
 */
export function GitHubSignInHint({ palette, onSetPassword, onDismiss }: { palette: Palette; onSetPassword(): void; onDismiss(): void }) {
  return (
    <View testID="github-signin-hint" accessibilityRole="alert" style={[styles.notice, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
      <Text style={[styles.noticeText, { color: palette.text }]} numberOfLines={3}>
        GitHub hides “Continue with Google” in apps. Use Google for GitHub? Set a GitHub password in your browser, then sign in here.
      </Text>
      <Pressable testID="github-set-password" accessibilityRole="button" onPress={onSetPassword} style={styles.noticeBtn}>
        <Text style={{ color: palette.accent, fontWeight: '700' }}>Set password</Text>
      </Pressable>
      <Pressable testID="github-hint-dismiss" accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} style={styles.noticeBtn}>
        <Text style={{ color: palette.textMuted, fontWeight: '700' }}>✕</Text>
      </Pressable>
    </View>
  );
}

export interface ErrorScreenProps {
  palette: Palette;
  title: string;
  message: string;
  online: boolean | null;
  onRetry(): void;
  onHome(): void;
}

/** Shown instead of the WebView's own error page when a load fails. */
export function ErrorScreen({ palette, title, message, online, onRetry, onHome }: ErrorScreenProps) {
  return (
    <View testID="error-screen" style={[styles.error, { backgroundColor: palette.background }]}>
      <Text style={[styles.errTitle, { color: palette.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.errMsg, { color: palette.textMuted }]}>{message}</Text>
      {online === false ? <Text style={[styles.errMsg, { color: palette.warning }]}>No internet connection detected. The app will retry when you’re back online.</Text> : null}
      <View style={styles.errRow}>
        <Pressable testID="error-retry" accessibilityRole="button" onPress={onRetry} style={[styles.primary, { backgroundColor: palette.accent }]}>
          <Text style={{ color: palette.accentText, fontWeight: '700' }}>Try again</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onHome} style={[styles.secondary, { borderColor: palette.border }]}>
          <Text style={{ color: palette.text, fontWeight: '600' }}>Scrimba home</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingVertical: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 16 },
  noticeBtn: { paddingHorizontal: 10, paddingVertical: 10 },
  banner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  bannerText: { flex: 1, color: '#1b1300', fontSize: 13, fontWeight: '600' },
  bannerBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  bannerBtnText: { color: '#1b1300', fontWeight: '800' },
  error: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 30 },
  errTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  errMsg: { fontSize: 15, textAlign: 'center', marginBottom: 8, lineHeight: 21 },
  errRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  primary: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 },
  secondary: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
});

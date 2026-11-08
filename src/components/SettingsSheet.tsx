import { useRef, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Palette } from '../theme/theme';
import type { Settings } from '../state/settings';
import { APP_NAME } from '../config/constants';

export interface SettingsSheetProps {
  visible: boolean;
  settings: Settings;
  palette: Palette;
  appVersion: string;
  onChange(patch: Partial<Settings>): void;
  /** Mode switch needs a reload; the screen decides whether that is safe. */
  onRequestModeChange(mode: Settings['compatMode']): void;
  onClose(): void;
  onOpenDiagnostics(): void;
  onForgetLastLesson(): void;
  /** Sign out: wipe the WebView's cookies and site data plus the app's own copies. */
  onClearData(): void;
  onReset(): void;
}

function Segmented<T extends string>({ value, options, onChange, palette, testID }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; palette: Palette; testID?: string }) {
  return (
    <View style={[styles.segment, { borderColor: palette.border }]} testID={testID} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, selected && { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.segText, { color: selected ? palette.accentText : palette.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Row({ title, subtitle, palette, children }: { title: string; subtitle?: string; palette: Palette; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, { color: palette.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Toggle({ value, onChange, palette, testID, label }: { value: boolean; onChange(v: boolean): void; palette: Palette; testID?: string; label: string }) {
  return <Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: palette.accent, false: palette.border }} />;
}

function Section({ title, palette, children }: { title: string; palette: Palette; children: ReactNode }) {
  return (
    <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.sectionTitle, { color: palette.textMuted }]} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

export function SettingsSheet(p: SettingsSheetProps) {
  const { settings: s, palette: c } = p;
  const taps = useRef(0);
  const stepScale = (delta: number) => p.onChange({ captionScale: Math.round((s.captionScale + delta) * 10) / 10 });

  return (
    <Modal visible={p.visible} animationType="slide" onRequestClose={p.onClose} presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape']}>
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top', 'bottom', 'left', 'right']}>
        <View style={[styles.header, { borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
            Settings
          </Text>
          <Pressable testID="settings-close" accessibilityRole="button" accessibilityLabel="Close settings" onPress={p.onClose} style={styles.close}>
            <Text style={[styles.closeText, { color: c.accent }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Section title="Editing" palette={c}>
            <Row title="Site mode" subtitle="Mobile is recommended. Switching reloads the page; your sign-in is kept." palette={c}>
              <Segmented testID="set-mode" value={s.compatMode} palette={c} onChange={p.onRequestModeChange} options={[{ value: 'auto', label: 'Auto' }, { value: 'mobile', label: 'Mobile' }, { value: 'desktop', label: 'Desktop' }]} />
            </Row>
            <Row title="Typing method" subtitle="Direct types into Scrimba's editor. Native bridge uses an app text field that edits the same editor line by line." palette={c}>
              <Segmented testID="set-strategy" value={s.editingStrategy} palette={c} onChange={(v) => p.onChange({ editingStrategy: v })} options={[{ value: 'direct', label: 'Direct' }, { value: 'bridge', label: 'Bridge' }]} />
            </Row>
            <Row title="Touch editor fix" subtitle="Re-enables taps on the editor, which Scrimba disables on touch screens." palette={c}>
              <Toggle testID="set-touchfix" label="Touch editor fix" value={s.touchFix} palette={c} onChange={(v) => p.onChange({ touchFix: v })} />
            </Row>
            <Row title="Tap focus assist" subtitle="Focus the editor directly from a tap if needed." palette={c}>
              <Toggle label="Tap focus assist" value={s.tapFocusAssist} palette={c} onChange={(v) => p.onChange({ tapFocusAssist: v })} />
            </Row>
            <Row title="Phone-style text selection" subtitle="Double-tap or long-press a word to select it, drag the handles to change the selection, and use Cut, Copy and Paste." palette={c}>
              <Toggle testID="set-touchselection" label="Phone-style text selection" value={s.touchSelection} palette={c} onChange={(v) => p.onChange({ touchSelection: v })} />
            </Row>
            <Row title="Pause when editing" subtitle="Playback never resumes by itself." palette={c}>
              <Toggle testID="set-autopause" label="Pause when editing" value={s.autoPauseOnEdit} palette={c} onChange={(v) => p.onChange({ autoPauseOnEdit: v })} />
            </Row>
            <Row title="Coding keys" subtitle="Auto hides them when a hardware keyboard is used." palette={c}>
              <Segmented value={s.codingToolbar} palette={c} onChange={(v) => p.onChange({ codingToolbar: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }]} />
            </Row>
          </Section>

          <Section title="Subtitles" palette={c}>
            <Row title="Size" subtitle={`${Math.round(s.captionScale * 100)}%`} palette={c}>
              <View style={styles.stepper}>
                <Pressable testID="cap-smaller" accessibilityRole="button" accessibilityLabel="Smaller subtitles" onPress={() => stepScale(-0.1)} style={[styles.stepBtn, { backgroundColor: c.key }]}>
                  <Text style={[styles.stepText, { color: c.text }]}>A−</Text>
                </Pressable>
                <Pressable testID="cap-larger" accessibilityRole="button" accessibilityLabel="Larger subtitles" onPress={() => stepScale(0.1)} style={[styles.stepBtn, { backgroundColor: c.key }]}>
                  <Text style={[styles.stepText, { color: c.text }]}>A+</Text>
                </Pressable>
              </View>
            </Row>
            <Row title="Background" palette={c}>
              <Segmented
                value={s.captionBackgroundOpacity === null ? 'default' : String(s.captionBackgroundOpacity)}
                palette={c}
                onChange={(v) => p.onChange({ captionBackgroundOpacity: v === 'default' ? null : Number(v) })}
                options={[{ value: 'default', label: 'Site' }, { value: '0', label: '0%' }, { value: '0.5', label: '50%' }, { value: '0.8', label: '80%' }, { value: '1', label: '100%' }]}
              />
            </Row>
            <Row title="Position" palette={c}>
              <Segmented value={s.captionPosition} palette={c} onChange={(v) => p.onChange({ captionPosition: v })} options={[{ value: 'default', label: 'Default' }, { value: 'raised', label: 'Raised' }, { value: 'top', label: 'Top' }]} />
            </Row>
            <Row title="While editing" palette={c}>
              <Segmented value={s.captionsWhileEditing} palette={c} onChange={(v) => p.onChange({ captionsWhileEditing: v })} options={[{ value: 'show', label: 'Show' }, { value: 'dim', label: 'Dim' }, { value: 'hide', label: 'Hide' }]} />
            </Row>
          </Section>

          <Section title="Playback & audio" palette={c}>
            <Row title="Pause when leaving the app" palette={c}>
              <Toggle label="Pause when leaving the app" value={s.pauseOnBackground} palette={c} onChange={(v) => p.onChange({ pauseOnBackground: v })} />
            </Row>
            <Row title="Pause when audio output changes" subtitle="E.g. headphones disconnected." palette={c}>
              <Toggle label="Pause when audio output changes" value={s.pauseOnAudioRouteChange} palette={c} onChange={(v) => p.onChange({ pauseOnAudioRouteChange: v })} />
            </Row>
            <Row title="Keep screen on while playing" palette={c}>
              <Toggle label="Keep screen on while playing" value={s.keepAwakeWhilePlaying} palette={c} onChange={(v) => p.onChange({ keepAwakeWhilePlaying: v })} />
            </Row>
          </Section>

          <Section title="Appearance & layout" palette={c}>
            <Row title="App theme" subtitle="Scrimba's own editor theme is not changed." palette={c}>
              <Segmented testID="set-theme" value={s.theme} palette={c} onChange={(v) => p.onChange({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </Row>
            <Row title="Rotation" palette={c}>
              <Segmented value={s.orientation} palette={c} onChange={(v) => p.onChange({ orientation: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            </Row>
            {Platform.OS === 'ios' ? (
              <Row title="Hide iOS keyboard bar" subtitle="Frees space for the coding keys." palette={c}>
                <Toggle label="Hide iOS keyboard bar" value={s.hideIosKeyboardAccessory} palette={c} onChange={(v) => p.onChange({ hideIosKeyboardAccessory: v })} />
              </Row>
            ) : null}
          </Section>

          <Section title="Session" palette={c}>
            <Row title="Reopen last lesson on launch" palette={c}>
              <Toggle label="Reopen last lesson on launch" value={s.resumeLastLesson} palette={c} onChange={(v) => p.onChange({ resumeLastLesson: v })} />
            </Row>
            <Pressable accessibilityRole="button" onPress={p.onForgetLastLesson} style={styles.linkRow}>
              <Text style={{ color: c.accent }}>Forget last lesson</Text>
            </Pressable>
            <Pressable testID="clear-data" accessibilityRole="button" onPress={p.onClearData} style={styles.linkRow}>
              <Text style={{ color: c.danger }}>Sign out and clear data…</Text>
            </Pressable>
            <Text style={[styles.note, { color: c.textMuted }]}>
              Your Scrimba sign-in is kept by the system WebView. The app never reads or exports cookies or passwords. Course progress is stored by Scrimba.
            </Text>
          </Section>

          {s.developerMode ? (
            <Section title="Developer" palette={c}>
              <Pressable testID="open-diagnostics" accessibilityRole="button" onPress={p.onOpenDiagnostics} style={styles.linkRow}>
                <Text style={{ color: c.accent }}>Diagnostics…</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={p.onReset} style={styles.linkRow}>
                <Text style={{ color: c.danger }}>Reset all settings</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => p.onChange({ developerMode: false })} style={styles.linkRow}>
                <Text style={{ color: c.textMuted }}>Hide developer options</Text>
              </Pressable>
            </Section>
          ) : null}

          <Section title="About" palette={c}>
            <Pressable
              testID="about-version"
              accessibilityRole="text"
              onPress={() => {
                taps.current += 1;
                if (taps.current >= 7) {
                  taps.current = 0;
                  p.onChange({ developerMode: true });
                }
              }}
            >
              <Text style={[styles.rowTitle, { color: c.text }]}>
                {APP_NAME} {p.appVersion}
              </Text>
            </Pressable>
            <Text style={[styles.note, { color: c.textMuted }]}>
              Unofficial, open-source companion app. Not affiliated with, endorsed by or sponsored by Scrimba. Scrimba and its content belong to their owners. App code is MIT licensed.
            </Text>
          </Section>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  close: { padding: 8 },
  closeText: { fontSize: 17, fontWeight: '600' },
  scroll: { padding: 12, paddingBottom: 40 },
  section: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 8, gap: 8 },
  rowText: { flexGrow: 1, flexShrink: 1, flexBasis: 160 },
  rowTitle: { fontSize: 16, fontWeight: '500' },
  rowSub: { fontSize: 13, marginTop: 2 },
  segment: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: 'hidden', flexWrap: 'wrap' },
  segItem: { paddingHorizontal: 11, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  segText: { fontSize: 14, fontWeight: '600' },
  stepper: { flexDirection: 'row', gap: 8 },
  stepBtn: { minWidth: 48, minHeight: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 16, fontWeight: '700' },
  linkRow: { paddingVertical: 10 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 6 },
});

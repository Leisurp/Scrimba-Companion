import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Palette } from '../theme/theme';
import type { DiagnosticsSnapshot } from '../diagnostics/store';
import type { NativeInfo } from '../diagnostics/report';
import { webViewVersionFromUA } from '../diagnostics/report';

export interface DiagnosticsPanelProps {
  visible: boolean;
  palette: Palette;
  snapshot: DiagnosticsSnapshot;
  native: NativeInfo;
  onRefresh(): void;
  onExport(): void;
  onClose(): void;
}

function KV({ k, v, palette }: { k: string; v: string; palette: Palette }) {
  return (
    <View style={styles.kv}>
      <Text style={[styles.k, { color: palette.textMuted }]}>{k}</Text>
      <Text style={[styles.v, { color: palette.text }]} selectable>
        {v}
      </Text>
    </View>
  );
}

/** Hidden developer panel (Settings → tap version 7× → Diagnostics). Local only. */
export function DiagnosticsPanel({ visible, palette: c, snapshot: s, native, onRefresh, onExport, onClose }: DiagnosticsPanelProps) {
  const page = s.page;
  const input = page?.input;
  const beforeinput = useMemo(() => (input ? Object.entries(input.beforeinput).map(([k, n]) => `${k}:${n}`).join(' ') : ''), [input]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape']}>
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <View style={[styles.header, { borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]}>Diagnostics</Text>
          <Pressable testID="diag-refresh" accessibilityRole="button" onPress={onRefresh} style={styles.hbtn}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>Refresh</Text>
          </Pressable>
          <Pressable testID="diag-export" accessibilityRole="button" onPress={onExport} style={styles.hbtn}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>Export</Text>
          </Pressable>
          <Pressable testID="diag-close" accessibilityRole="button" onPress={onClose} style={styles.hbtn}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.h, { color: c.text }]}>App & platform</Text>
          <KV palette={c} k="App" v={`${native.appVersion} (${native.buildVersion})`} />
          <KV palette={c} k="Platform" v={`${native.platform} ${native.osVersion} · ${native.deviceModel}${native.isDevice ? '' : ' (emulator)'}`} />
          <KV palette={c} k="WebView" v={page ? webViewVersionFromUA(page.userAgent) : 'not reported yet'} />
          <KV palette={c} k="Site mode" v={s.compatMode} />
          <KV palette={c} k="Runtime" v={s.runtimeReady ? `ready ${page?.runtimeVersion ?? ''}` : 'not injected yet'} />

          <Text style={[styles.h, { color: c.text }]}>Navigation</Text>
          <KV palette={c} k="State" v={s.navigation.loading ? 'loading' : 'idle'} />
          <KV palette={c} k="URL" v={s.navigation.url || '—'} />
          <KV palette={c} k="Last error" v={s.navigation.lastError ?? 'none'} />

          <Text style={[styles.h, { color: c.text }]}>Editor</Text>
          <KV palette={c} k="Detected" v={s.editor ? `${s.editor.kind} ×${s.editor.editorCount}` : 'no'} />
          <KV palette={c} k="Focused / dirty" v={s.editor ? `${s.editor.focused} / ${s.editor.dirty}` : '—'} />
          <KV palette={c} k="Cursor" v={s.editor ? `${s.editor.lineNumber}:${s.editor.column} ${s.editor.language ?? ''}` : '—'} />
          <KV palette={c} k="Touch / coarse" v={page ? `${page.touch.maxTouchPoints} pts · coarse=${page.touch.coarsePointer} · touch-interface=${page.touch.touchInterfaceClass}` : '—'} />
          <KV palette={c} k="Pointer fix" v={page ? page.pointerEventsFix.join(', ') || 'none needed' : '—'} />
          <KV palette={c} k="EditContext" v={page ? `supported=${page.monaco.editContextSupported} enabled=${page.monaco.editContextEnabled}` : '—'} />
          <KV palette={c} k="Hardware keyboard" v={String(s.physicalKeyboard)} />

          <Text style={[styles.h, { color: c.text }]}>Input events (counts only)</Text>
          <KV palette={c} k="keydown / 229" v={input ? `${input.keydown} / ${input.keydownIme229}` : '—'} />
          <KV palette={c} k="beforeinput" v={beforeinput || '—'} />
          <KV palette={c} k="input / composition" v={input ? `${input.input} / ${input.compositionstart}→${input.compositionend}` : '—'} />
          <KV palette={c} k="focus / blur / tap-assist" v={input ? `${input.focus} / ${input.blur} / ${input.tapAssistFocus}` : '—'} />

          <Text style={[styles.h, { color: c.text }]}>Playback & subtitles</Text>
          <KV palette={c} k="Playback" v={`${s.playback}${page ? ` · controls=${page.playback.controlsFound} · media=${page.playback.mediaElements}` : ''}`} />
          <KV palette={c} k="Media errors" v={page?.playback.mediaErrors.join('; ') || 'none observed'} />
          <KV palette={c} k="Captions" v={page ? (page.captions.found ? `<${page.captions.tag}> enabled=${page.captions.enabled}` : 'not on this page') : '—'} />

          <Text style={[styles.h, { color: c.text }]}>Compatibility modules</Text>
          {s.modules.map((m) => (
            <KV key={m.name} palette={c} k={`${m.active ? '●' : m.applicable ? '○' : '–'} ${m.name}`} v={`${m.detail}${m.errorCount ? ` · errors=${m.errorCount}` : ''}`} />
          ))}

          <Text style={[styles.h, { color: c.text }]}>Logs</Text>
          {[...(page?.logs ?? []).map((l) => `[page/${l.module}] ${l.level}: ${l.message}`), ...s.logs.map((l) => `[app/${l.source}] ${l.level}: ${l.message}`)]
            .slice(-120)
            .map((line, i) => (
              <Text key={i} style={[styles.log, { color: c.textMuted }]} selectable>
                {line}
              </Text>
            ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 19, fontWeight: '700' },
  hbtn: { padding: 8 },
  scroll: { padding: 12, paddingBottom: 40 },
  h: { fontSize: 15, fontWeight: '700', marginTop: 14, marginBottom: 4 },
  kv: { flexDirection: 'row', paddingVertical: 3, gap: 8 },
  k: { width: 140, fontSize: 13 },
  v: { flex: 1, fontSize: 13, fontFamily: 'monospace' },
  log: { fontSize: 11, fontFamily: 'monospace', paddingVertical: 1 },
});

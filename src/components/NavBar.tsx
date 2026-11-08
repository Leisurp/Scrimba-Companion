import { StyleSheet, View } from 'react-native';
import type { Palette } from '../theme/theme';
import type { OrientationPreference } from '../state/settings';
import { IconButton } from './IconButton';

export interface NavBarProps {
  palette: Palette;
  collapsed: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  fullscreenEditor: boolean;
  expandedPreview: boolean;
  previewAvailable: boolean;
  editorAvailable: boolean;
  orientation: OrientationPreference;
  onBack(): void;
  onForward(): void;
  onRefresh(): void;
  onToggleFullscreen(): void;
  onTogglePreview(): void;
  onRotate(): void;
  onSettings(): void;
  onToggleCollapsed(): void;
}

const ORIENTATION_GLYPH: Record<OrientationPreference, string> = { auto: '⟳', portrait: '▯', landscape: '▭' };

/** Small, collapsible native toolbar. Scrimba's own navigation stays untouched. */
export function NavBar(p: NavBarProps) {
  const c = p.palette;
  if (p.collapsed) {
    return (
      <View style={[styles.handleWrap]} pointerEvents="box-none">
        <IconButton testID="nav-expand" compact label="⋯" accessibilityLabel="Show app toolbar" onPress={p.onToggleCollapsed} palette={c} style={[styles.handle, { backgroundColor: c.surface, borderColor: c.border }]} />
      </View>
    );
  }
  return (
    <View testID="navbar" style={[styles.bar, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityRole="toolbar">
      <IconButton testID="nav-back" label="‹" accessibilityLabel="Back" onPress={p.onBack} disabled={!p.canGoBack} palette={c} />
      <IconButton testID="nav-forward" label="›" accessibilityLabel="Forward" onPress={p.onForward} disabled={!p.canGoForward} palette={c} />
      <IconButton testID="nav-refresh" label="↻" accessibilityLabel="Refresh" onPress={p.onRefresh} palette={c} />
      <View style={styles.spacer} />
      <IconButton testID="nav-fullscreen" label="⛶" accessibilityLabel={p.fullscreenEditor ? 'Exit full-screen editor' : 'Full-screen editor'} onPress={p.onToggleFullscreen} active={p.fullscreenEditor} disabled={!p.editorAvailable && !p.fullscreenEditor} palette={c} />
      <IconButton testID="nav-preview" label="◧" accessibilityLabel={p.expandedPreview ? 'Exit expanded preview' : 'Expanded preview'} onPress={p.onTogglePreview} active={p.expandedPreview} disabled={!p.previewAvailable && !p.expandedPreview} palette={c} />
      <IconButton testID="nav-rotate" label={ORIENTATION_GLYPH[p.orientation]} accessibilityLabel={`Rotation: ${p.orientation}. Tap to change`} onPress={p.onRotate} palette={c} />
      <IconButton testID="nav-settings" label="⚙" accessibilityLabel="Settings" onPress={p.onSettings} palette={c} />
      <IconButton testID="nav-collapse" compact label="⌃" accessibilityLabel="Hide app toolbar" onPress={p.onToggleCollapsed} palette={c} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  spacer: { flex: 1 },
  handleWrap: { position: 'absolute', top: 4, right: 6, zIndex: 20 },
  handle: { borderWidth: StyleSheet.hairlineWidth, opacity: 0.85 },
});

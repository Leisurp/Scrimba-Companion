import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Palette } from '../theme/theme';
import { TOOLBAR_ACTIONS, type ToolbarActionId } from '../editor/toolbarActions';

export interface CodingToolbarProps {
  palette: Palette;
  onAction(id: ToolbarActionId): void;
  /** Hide actions that make no sense in the current context. */
  hidden?: ReadonlySet<ToolbarActionId>;
}

/**
 * Compact, horizontally scrollable coding keys shown directly above the soft keyboard.
 * `keyboardShouldPersistTaps` keeps the keyboard open while keys are pressed.
 */
export function CodingToolbar({ palette, onAction, hidden }: CodingToolbarProps) {
  const groups = ['insert', 'navigate', 'history', 'clipboard', 'lesson'] as const;
  return (
    <View testID="coding-toolbar" style={[styles.wrap, { backgroundColor: palette.surface, borderColor: palette.border }]} accessibilityRole="toolbar" accessibilityLabel="Coding keys">
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {groups.map((g, gi) => (
          <View key={g} style={[styles.group, gi > 0 && { borderLeftColor: palette.border, borderLeftWidth: StyleSheet.hairlineWidth }]}>
            {TOOLBAR_ACTIONS.filter((a) => a.group === g && !hidden?.has(a.id)).map((a) => (
              <Pressable
                key={a.id}
                testID={`key-${a.id}`}
                accessibilityRole="button"
                accessibilityLabel={a.accessibilityLabel}
                onPress={() => onAction(a.id)}
                style={({ pressed }) => [styles.key, { backgroundColor: pressed ? palette.keyPressed : palette.key }]}
              >
                <Text style={[styles.keyText, { color: palette.text }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: 4, paddingVertical: 5, alignItems: 'center' },
  group: { flexDirection: 'row', paddingHorizontal: 3 },
  key: { minWidth: 42, height: 38, marginHorizontal: 2, paddingHorizontal: 9, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 16, fontWeight: '600', fontFamily: 'monospace' },
});

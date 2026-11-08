import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import type { Palette } from '../theme/theme';

export interface IconButtonProps {
  label: string;
  accessibilityLabel: string;
  onPress(): void;
  palette: Palette;
  disabled?: boolean;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  compact?: boolean;
}

/** Text-glyph button (no icon font dependency). Minimum 44pt touch target. */
export function IconButton({ label, accessibilityLabel, onPress, palette, disabled, active, style, testID, compact }: IconButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.compact,
        { backgroundColor: active ? palette.accent : pressed ? palette.keyPressed : 'transparent' },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, { color: active ? palette.accentText : palette.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minWidth: 44, minHeight: 40, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  compact: { minWidth: 36, minHeight: 36, paddingHorizontal: 6 },
  label: { fontSize: 17, fontWeight: '600' },
  disabled: { opacity: 0.35 },
});

import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputKeyPressEvent, type TextInputSelectionChangeEvent } from 'react-native';
import type { EditorCommand, LineState } from '../shared/protocol';
import type { Palette } from '../theme/theme';
import { computeLineEdit, toColumn, toOffset } from '../editor/lineDiff';

export interface BridgeInputProps {
  line: LineState | null;
  palette: Palette;
  onCommand(cmd: EditorCommand): void;
  autoFocus?: boolean;
}

/**
 * Native text-input bridge (fallback editing strategy).
 *
 * A native TextInput mirrors the editor's current line. The platform keyboard, IME
 * composition and autocorrect operate on the native field; every change is reduced to a
 * single-range edit and applied to Scrimba's real Monaco model via `executeEdits`, so it
 * lands in Monaco's undo stack and Scrimba's change listeners. Enter and Backspace at the
 * line start are forwarded as Monaco commands (keeping auto-indent and line joins).
 */
export function BridgeInput({ line, palette, onCommand, autoFocus }: BridgeInputProps) {
  const [value, setValue] = useState(line?.text ?? '');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  // Adopt state from the page (new line, undo/redo, toolbar edits) when the prop changes.
  // React's "adjusting state when a prop changes" pattern: no effect, no ref writes in render.
  const [adopted, setAdopted] = useState<LineState | null>(null);
  if (line && line !== adopted) {
    setAdopted(line);
    setValue(line.text);
    setSelection({ start: toOffset(line.selectionStartColumn), end: toOffset(line.selectionEndColumn) });
  }
  // Selection we expect the native field to report after our own edit (written in handlers only).
  const expectedSelection = useRef<{ start: number; end: number } | null>(null);
  const lineNumber = line?.lineNumber ?? 0;

  const onChangeText = (next: string) => {
    const edit = computeLineEdit(value, next);
    setValue(next);
    if (!edit) return;
    const cursor = edit.start + edit.text.length;
    expectedSelection.current = { start: cursor, end: cursor };
    onCommand({
      type: 'replaceInLine',
      lineNumber,
      startColumn: toColumn(edit.start),
      endColumn: toColumn(edit.end),
      text: edit.text,
      cursorColumn: toColumn(cursor),
    });
  };

  const onSelectionChange = (e: TextInputSelectionChangeEvent) => {
    const sel = e.nativeEvent.selection;
    setSelection(sel);
    const exp = expectedSelection.current;
    if (exp && exp.start === sel.start && exp.end === sel.end) {
      expectedSelection.current = null;
      return;
    }
    // Echo of a selection we adopted from the page: nothing to send back.
    if (adopted && toOffset(adopted.selectionStartColumn) === sel.start && toOffset(adopted.selectionEndColumn) === sel.end) return;
    onCommand({ type: 'setSelectionInLine', lineNumber, startColumn: toColumn(sel.start), endColumn: toColumn(sel.end) });
  };

  const onKeyPress = (e: TextInputKeyPressEvent) => {
    if (e.nativeEvent.key === 'Backspace' && selection.start === 0 && selection.end === 0 && lineNumber > 1) {
      onCommand({ type: 'deleteLeft' });
    }
  };

  return (
    <View testID="bridge-input" style={[styles.wrap, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
      <Text style={[styles.gutter, { color: palette.textMuted }]} accessibilityElementsHidden>
        {line ? line.lineNumber : '–'}
      </Text>
      <TextInput
        testID="bridge-text"
        accessibilityLabel={line ? `Editing line ${line.lineNumber}` : 'Editor line'}
        value={value}
        selection={selection}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        onKeyPress={onKeyPress}
        onSubmitEditing={() => onCommand({ type: 'newline' })}
        submitBehavior="submit"
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        returnKeyType="default"
        style={[styles.input, { color: palette.text }]}
        placeholder={line?.multiLineSelection ? 'Multi-line selection – use toolbar' : ''}
        placeholderTextColor={palette.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6 },
  gutter: { width: 34, textAlign: 'right', marginRight: 8, fontFamily: 'monospace', fontSize: 13 },
  input: { flex: 1, minHeight: 44, fontFamily: 'monospace', fontSize: 16, paddingVertical: 8 },
});

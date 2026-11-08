import { fireEvent, render, screen } from '@testing-library/react-native';
import { CodingToolbar } from '../../src/components/CodingToolbar';
import { NavBar, type NavBarProps } from '../../src/components/NavBar';
import { BridgeInput } from '../../src/components/BridgeInput';
import { SettingsSheet } from '../../src/components/SettingsSheet';
import { palettes } from '../../src/theme/theme';
import { DEFAULT_SETTINGS } from '../../src/state/settings';
import type { EditorCommand, LineState } from '../../src/shared/protocol';

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, initialWindowMetrics: null, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const palette = palettes.dark;

describe('CodingToolbar', () => {
  test('every key reports its action id', async () => {
    const onAction = jest.fn();
    await render(<CodingToolbar palette={palette} onAction={onAction} />);
    for (const id of ['tab', 'braces', 'parens', 'brackets', 'arrow', 'semicolon', 'dquote', 'undo', 'redo', 'paste', 'run']) {
      await fireEvent.press(screen.getByTestId(`key-${id}`));
      expect(onAction).toHaveBeenLastCalledWith(id);
    }
  });

  test('keys are accessible buttons with labels', async () => {
    await render(<CodingToolbar palette={palette} onAction={jest.fn()} />);
    expect(screen.getByLabelText('Insert braces')).toBeTruthy();
    expect(screen.getByLabelText('Undo')).toBeTruthy();
  });

  test('hidden keys are not rendered', async () => {
    await render(<CodingToolbar palette={palette} onAction={jest.fn()} hidden={new Set(['run'])} />);
    expect(screen.queryByTestId('key-run')).toBeNull();
  });
});

describe('NavBar', () => {
  const base: NavBarProps = {
    palette,
    collapsed: false,
    canGoBack: true,
    canGoForward: false,
    fullscreenEditor: false,
    expandedPreview: false,
    previewAvailable: false,
    editorAvailable: true,
    orientation: 'auto',
    onBack: jest.fn(),
    onForward: jest.fn(),
    onRefresh: jest.fn(),
    onToggleFullscreen: jest.fn(),
    onTogglePreview: jest.fn(),
    onRotate: jest.fn(),
    onSettings: jest.fn(),
    onToggleCollapsed: jest.fn(),
  };

  test('buttons fire handlers; disabled ones do not', async () => {
    const p = { ...base, onBack: jest.fn(), onForward: jest.fn(), onToggleFullscreen: jest.fn(), onSettings: jest.fn() };
    await render(<NavBar {...p} />);
    await fireEvent.press(screen.getByTestId('nav-back'));
    await fireEvent.press(screen.getByTestId('nav-forward'));
    await fireEvent.press(screen.getByTestId('nav-fullscreen'));
    await fireEvent.press(screen.getByTestId('nav-settings'));
    expect(p.onBack).toHaveBeenCalled();
    expect(p.onForward).not.toHaveBeenCalled();
    expect(p.onToggleFullscreen).toHaveBeenCalled();
    expect(p.onSettings).toHaveBeenCalled();
  });

  test('collapsed shows only an expand handle', async () => {
    const onToggleCollapsed = jest.fn();
    await render(<NavBar {...base} collapsed onToggleCollapsed={onToggleCollapsed} />);
    expect(screen.queryByTestId('navbar')).toBeNull();
    await fireEvent.press(screen.getByTestId('nav-expand'));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });
});

describe('BridgeInput', () => {
  const line: LineState = { lineNumber: 3, lineCount: 9, text: 'return a;', selectionStartColumn: 10, selectionEndColumn: 10, multiLineSelection: false };

  test('typing sends a minimal replaceInLine edit to Monaco', async () => {
    const cmds: EditorCommand[] = [];
    await render(<BridgeInput line={line} palette={palette} onCommand={(c) => cmds.push(c)} />);
    await fireEvent.changeText(screen.getByTestId('bridge-text'), 'return a + b;');
    expect(cmds.at(-1)).toEqual({ type: 'replaceInLine', lineNumber: 3, startColumn: 9, endColumn: 9, text: ' + b', cursorColumn: 13 });
  });

  test('Enter becomes a Monaco newline (keeps auto-indent)', async () => {
    const cmds: EditorCommand[] = [];
    await render(<BridgeInput line={line} palette={palette} onCommand={(c) => cmds.push(c)} />);
    await fireEvent(screen.getByTestId('bridge-text'), 'submitEditing');
    expect(cmds.at(-1)).toEqual({ type: 'newline' });
  });

  test('Backspace at column 1 joins with the previous line', async () => {
    const cmds: EditorCommand[] = [];
    const atStart = { ...line, selectionStartColumn: 1, selectionEndColumn: 1 };
    await render(<BridgeInput line={atStart} palette={palette} onCommand={(c) => cmds.push(c)} />);
    await fireEvent(screen.getByTestId('bridge-text'), 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(cmds.at(-1)).toEqual({ type: 'deleteLeft' });
  });

  test('user selection changes are mirrored to Monaco', async () => {
    const cmds: EditorCommand[] = [];
    await render(<BridgeInput line={line} palette={palette} onCommand={(c) => cmds.push(c)} />);
    await fireEvent(screen.getByTestId('bridge-text'), 'selectionChange', { nativeEvent: { selection: { start: 0, end: 6 } } });
    expect(cmds.at(-1)).toEqual({ type: 'setSelectionInLine', lineNumber: 3, startColumn: 1, endColumn: 7 });
  });
});

describe('SettingsSheet', () => {
  const props = () => ({
    visible: true,
    settings: DEFAULT_SETTINGS,
    palette,
    appVersion: '1.0.0',
    onChange: jest.fn(),
    onRequestModeChange: jest.fn(),
    onClose: jest.fn(),
    onOpenDiagnostics: jest.fn(),
    onForgetLastLesson: jest.fn(),
    onClearData: jest.fn(),
    onReset: jest.fn(),
  });

  test('mode changes go through the guarded handler, not straight to settings', async () => {
    const p = props();
    await render(<SettingsSheet {...p} />);
    await fireEvent.press(screen.getByTestId('set-mode-desktop'));
    expect(p.onRequestModeChange).toHaveBeenCalledWith('desktop');
    expect(p.onChange).not.toHaveBeenCalled();
  });

  test('subtitle size and theme update settings', async () => {
    const p = props();
    await render(<SettingsSheet {...p} />);
    await fireEvent.press(screen.getByTestId('cap-larger'));
    expect(p.onChange).toHaveBeenCalledWith({ captionScale: 1.1 });
    await fireEvent.press(screen.getByTestId('set-theme-dark'));
    expect(p.onChange).toHaveBeenCalledWith({ theme: 'dark' });
  });

  test('diagnostics are hidden until the version is tapped 7 times', async () => {
    const p = props();
    const { rerender } = await render(<SettingsSheet {...p} />);
    expect(screen.queryByTestId('open-diagnostics')).toBeNull();
    for (let i = 0; i < 7; i++) await fireEvent.press(screen.getByTestId('about-version'));
    expect(p.onChange).toHaveBeenCalledWith({ developerMode: true });
    await rerender(<SettingsSheet {...p} settings={{ ...DEFAULT_SETTINGS, developerMode: true }} />);
    expect(screen.getByTestId('open-diagnostics')).toBeTruthy();
  });

  test('sign out and clear data is always available (not only in developer mode)', async () => {
    const p = props();
    await render(<SettingsSheet {...p} />);
    await fireEvent.press(screen.getByTestId('clear-data'));
    expect(p.onClearData).toHaveBeenCalledTimes(1);
  });

  test('states the unofficial status', async () => {
    await render(<SettingsSheet {...props()} />);
    expect(screen.getByText(/Not affiliated with, endorsed by or sponsored by Scrimba/)).toBeTruthy();
  });
});

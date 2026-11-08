import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Keyboard, Linking, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewErrorEvent, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { File, Paths } from 'expo-file-system';

import { ScrimbaWebView, type WebViewHandle } from '../components/ScrimbaWebView';
import { NavBar } from '../components/NavBar';
import { CodingToolbar } from '../components/CodingToolbar';
import { BridgeInput } from '../components/BridgeInput';
import { SettingsSheet } from '../components/SettingsSheet';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { ErrorScreen, ExecutionNotice, GitHubSignInHint, OfflineBanner } from '../components/StatusViews';
import { useSettings } from '../state/SettingsContext';
import { toRuntimeConfig, type Settings } from '../state/settings';
import { clearLastLocation, saveLastLocation } from '../state/session';
import { RecoveryStore, fileSnapshotStorage } from '../state/recovery';
import { usePalette } from '../theme/theme';
import { useSoftKeyboard } from '../hooks/useSoftKeyboard';
import { useConnectivity } from '../hooks/useConnectivity';
import { nextOrientation, useOrientationLock } from '../hooks/useOrientationLock';
import { PageBridge } from '../webview/PageBridge';
import { buildEarlyScript, buildMainScript, createSessionToken, isScrimbaPageUrl } from '../webview/messages';
import {
  GITHUB_SET_PASSWORD_URL,
  classifyNavigation,
  isGitHubSignIn,
  isGoogleOAuth,
  isScrimbaGitHubCallback,
  isScrimbaUrl,
  looksLikeLesson,
  sanitizeResumeUrl,
  scrimbaGitHubAuthorize,
} from '../webview/urlPolicy';
import { clearPendingSignIn, hasBrowserSignInWorked, startPendingSignIn, takeCallback } from '../state/browserSignIn';
import { WebData } from '../../modules/web-data';
import { resolveMode } from '../webview/userAgent';
import { diagnostics } from '../diagnostics/store';
import { buildReport, type NativeInfo } from '../diagnostics/report';
import { getAction, type ToolbarActionId } from '../editor/toolbarActions';
import { fnv1a } from '../shared/hash';
import type { EditorCommand, EditorState, LineState, PageToNative, PlaybackState } from '../shared/protocol';
import { SCRIMBA_HOME } from '../config/constants';

const EARLY_SCRIPT = buildEarlyScript();

interface LoadError {
  title: string;
  message: string;
}

export interface BrowserScreenProps {
  initialUrl: string;
}

export function BrowserScreen({ initialUrl }: BrowserScreenProps) {
  const { settings, update, reset } = useSettings();
  const palette = usePalette(settings.theme);
  const insets = useSafeAreaInsets();
  const kb = useSoftKeyboard();
  const { online } = useConnectivity();

  const webRef = useRef<WebViewHandle>(null);
  const [token] = useState(createSessionToken);
  const [bridge] = useState(() => new PageBridge(() => undefined, token));
  const [recovery] = useState(() => new RecoveryStore(fileSnapshotStorage()));
  const recoveryChecked = useRef(new Set<string>());
  const currentLocation = useRef('');
  const navUrlRef = useRef(initialUrl);
  /** Scrimba page to return to after a browser sign-in completes in the WebView. */
  const signInReturnRef = useRef<string | null>(null);
  const callbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNavUrl = useRef(initialUrl);
  const callbackWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True from loading GitHub's callback until any page starts loading in response. */
  const callbackRequested = useRef(false);

  const [webKey, setWebKey] = useState(0);
  const [uri, setUri] = useState(initialUrl);
  const [mode, setMode] = useState(resolveMode(settings.compatMode));
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false, url: initialUrl, loading: true });
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [line, setLine] = useState<LineState | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>('unknown');
  const [physicalKeyboard, setPhysicalKeyboard] = useState(false);
  const [layout, setLayout] = useState({ fullscreenEditor: false, expandedPreview: false, previewAvailable: false });
  const [executionBlocked, setExecutionBlocked] = useState(false);
  const [executionNoticeDismissed, setExecutionNoticeDismissed] = useState(false);
  const [githubHintDismissed, setGithubHintDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagSnapshot, setDiagSnapshot] = useState(diagnostics.get());
  const [rootHeight, setRootHeight] = useState({ base: 0, current: 0 });

  // Latest editor state for event handlers (updated where state is set, not during render).
  const editorRef = useRef<EditorState | null>(null);

  useEffect(() => diagnostics.subscribe(() => setDiagSnapshot(diagnostics.get())), []);
  useEffect(() => {
    bridge.setInjector((js) => webRef.current?.injectJavaScript(js));
  }, [bridge, webKey]);

  const onOrientationError = useCallback((e: unknown) => diagnostics.log('warn', 'orientation', String(e)), []);
  useOrientationLock(settings.orientation, onOrientationError);

  // --- Runtime configuration -------------------------------------------------------
  const runtimeConfig = useMemo(() => toRuntimeConfig(settings, settings.developerMode || __DEV__), [settings]);
  const mainScript = useMemo(() => buildMainScript(runtimeConfig, token), [runtimeConfig, token]);
  useEffect(() => {
    bridge.send({ kind: 'config', config: runtimeConfig });
  }, [bridge, runtimeConfig]);

  // --- Lifecycle: pause on background (never auto-resume) --------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (settings.pauseOnBackground) bridge.send({ kind: 'appState', state: 'background' });
      } else if (state === 'active') {
        bridge.send({ kind: 'appState', state: 'active' });
      }
    });
    return () => sub.remove();
  }, [bridge, settings.pauseOnBackground]);

  // --- Keep the screen on while a screencast plays ---------------------------------
  useEffect(() => {
    const tag = 'scrimba-playback';
    if (settings.keepAwakeWhilePlaying && playback === 'playing') activateKeepAwakeAsync(tag).catch(() => undefined);
    else deactivateKeepAwake(tag).catch(() => undefined);
  }, [playback, settings.keepAwakeWhilePlaying]);

  // --- Soft keyboard → page (lets the runtime keep the cursor visible) --------------
  useEffect(() => {
    bridge.send({ kind: 'softKeyboard', visible: kb.visible, height: kb.height });
  }, [bridge, kb.visible, kb.height]);
  // A visible soft keyboard means the user is not (only) on a hardware keyboard.
  const hardwareKeyboard = physicalKeyboard && !kb.visible;

  // --- Connection recovery ----------------------------------------------------------
  useEffect(() => {
    if (online && loadError) {
      diagnostics.log('info', 'network', 'back online; reloading');
      webRef.current?.reload(); // onLoadStart clears the error screen
    }
  }, [online, loadError]);

  useEffect(() => {
    diagnostics.update({ compatMode: mode, physicalKeyboard: hardwareKeyboard });
  }, [mode, hardwareKeyboard]);

  // --- Unsaved-changes guard --------------------------------------------------------
  const runCommand = useCallback(
    async (command: EditorCommand) => {
      const r = await bridge.command(command);
      if (!r.ok) diagnostics.log('warn', 'editor', `command ${command.type} failed: ${r.error}`);
      return r;
    },
    [bridge],
  );

  const confirmIfDirty = useCallback(
    (actionLabel: string, action: () => void) => {
      if (!editorRef.current?.dirty) {
        action();
        return;
      }
      Alert.alert('Unsaved changes', `You have edits the app hasn't seen saved. ${actionLabel} anyway?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save first',
          onPress: () => {
            runCommand({ type: 'save' }).then(() => setTimeout(action, 800));
          },
        },
        { text: actionLabel, style: 'destructive', onPress: action },
      ]);
    },
    [runCommand],
  );

  // --- Navigation -------------------------------------------------------------------
  const goBack = useCallback(() => confirmIfDirty('Go back', () => webRef.current?.goBack()), [confirmIfDirty]);
  const goForward = useCallback(() => confirmIfDirty('Go forward', () => webRef.current?.goForward()), [confirmIfDirty]);
  const refresh = useCallback(() => confirmIfDirty('Reload', () => { setLoadError(null); webRef.current?.reload(); }), [confirmIfDirty]);
  const goHome = useCallback(() => {
    setLoadError(null);
    webRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(SCRIMBA_HOME)};true;`);
  }, []);

  const setFullscreen = useCallback(
    (on: boolean) => {
      bridge.send({ kind: 'layout', fullscreenEditor: on });
      setLayout((l) => ({ ...l, fullscreenEditor: on, expandedPreview: on ? false : l.expandedPreview }));
    },
    [bridge],
  );
  const setPreview = useCallback(
    (on: boolean) => {
      bridge.send({ kind: 'layout', expandedPreview: on });
      setLayout((l) => ({ ...l, expandedPreview: on, fullscreenEditor: on ? false : l.fullscreenEditor }));
    },
    [bridge],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (layout.fullscreenEditor || layout.expandedPreview) {
        setFullscreen(false);
        setPreview(false);
        return true;
      }
      if (nav.canGoBack) {
        goBack();
        return true;
      }
      if (editorRef.current?.dirty) {
        confirmIfDirty('Exit', () => BackHandler.exitApp());
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [layout, nav.canGoBack, goBack, confirmIfDirty, setFullscreen, setPreview]);

  // --- GitHub sign-in through the system browser (Android) ----------------------------
  // GitHub hides "Continue with Google" in WebViews, so the authorize step runs in a Chrome
  // Custom Tab; GitHub's redirect to scrimba.com/auth/github/callback comes back to the app
  // (app.json intent filter) and is completed in the WebView, which owns Scrimba's session.
  const openSignInInBrowser = useCallback((auth: { url: string; state: string }) => {
    signInReturnRef.current = sanitizeResumeUrl(currentLocation.current) ?? SCRIMBA_HOME;
    const go = () => {
      startPendingSignIn(auth.state)
        .catch(() => undefined)
        .then(() => WebBrowser.openBrowserAsync(auth.url, { createTask: false, showTitle: true }))
        .then(() => diagnostics.log('info', 'auth', 'GitHub sign-in opened in the browser'))
        .catch((err) => {
          diagnostics.log('error', 'auth', `could not open the browser: ${String(err)}`);
          Alert.alert('GitHub sign-in', 'Could not open the browser for GitHub sign-in.');
        });
    };
    hasBrowserSignInWorked()
      .catch(() => false)
      .then((worked) => {
        if (worked) {
          go();
          return;
        }
        Alert.alert(
          'Sign in with GitHub in your browser',
          'GitHub sign-in (including “Continue with Google”) opens in your browser, then returns here.\n\n' +
            'One-time setup so Android can send you back: App settings → Open by default → Add link → tick scrimba.com. Then come back and tap Continue with GitHub again.',
          [
            { text: 'Open app settings', onPress: () => Linking.openSettings().catch(() => undefined) },
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue', onPress: go },
          ],
        );
      });
  }, []);

  const handleIncomingUrl = useCallback(async (url: string | null | undefined) => {
    if (!url || !isScrimbaGitHubCallback(url)) return;
    const route = await takeCallback(url).catch(() => 'browser' as const);
    if (route === 'webview') {
      diagnostics.log('info', 'auth', 'GitHub sign-in returned; finishing in the app');
      setLoadError(null);
      setUri(url); // the WebView navigates to the new source URI with its own cookies
      // If Scrimba never answers (seen on the emulator with an invalid code), don't leave the
      // user on a frozen page: stop, go back, and say so.
      if (callbackWatchdog.current) clearTimeout(callbackWatchdog.current);
      callbackRequested.current = true;
      callbackWatchdog.current = setTimeout(() => {
        callbackWatchdog.current = null;
        if (!callbackRequested.current) return;
        callbackRequested.current = false;
        diagnostics.log('warn', 'auth', 'GitHub callback did not finish loading; returning');
        webRef.current?.stopLoading();
        webRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(signInReturnRef.current ?? SCRIMBA_HOME)});true;`);
        Alert.alert('GitHub sign-in', 'Scrimba did not finish signing you in. Please try “Continue with GitHub” again.');
      }, 20_000);
    } else {
      // Not a sign-in the app started (e.g. signing in to Scrimba in Chrome): give it back.
      diagnostics.log('info', 'auth', 'unrelated GitHub callback handed back to the browser');
      WebBrowser.openBrowserAsync(url).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    Linking.getInitialURL()
      .then((u) => handleIncomingUrl(u))
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => void handleIncomingUrl(url));
    return () => sub.remove();
  }, [handleIncomingUrl]);

  useEffect(
    () => () => {
      if (callbackTimer.current) clearTimeout(callbackTimer.current);
      if (callbackWatchdog.current) clearTimeout(callbackWatchdog.current);
    },
    [],
  );

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    if (Platform.OS === 'android' && req.isTopFrame !== false) {
      const auth = scrimbaGitHubAuthorize(req.url);
      if (auth) {
        openSignInInBrowser(auth);
        // Scrimba's sign-in "popup" navigates this same WebView (no multi-window support);
        // if cancelling the redirect left it on a blank page, return to the Scrimba page.
        setTimeout(() => {
          if (!sanitizeResumeUrl(latestNavUrl.current) && signInReturnRef.current) {
            webRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(signInReturnRef.current)});true;`);
          }
        }, 600);
        return false;
      }
    }
    const decision = classifyNavigation(req.url, req.isTopFrame !== false);
    if (decision === 'allow' && req.isTopFrame !== false && isGoogleOAuth(req.url)) {
      Alert.alert(
        'Google sign-in',
        'Google blocks its sign-in page inside embedded app browsers, so it will probably fail here. Sign in to Scrimba with email/password or GitHub instead. If your GitHub account uses Google, set a GitHub password in your browser first.',
        [{ text: 'OK' }],
      );
      return true; // let Google show its own message; we do not spoof the user agent
    }
    if (decision === 'external') {
      Linking.openURL(req.url).catch(() => undefined);
      diagnostics.log('info', 'navigation', `opened externally: ${req.url}`);
      return false;
    }
    if (decision === 'block') {
      diagnostics.log('warn', 'navigation', `blocked: ${req.url.slice(0, 40)}`);
      return false;
    }
    return true;
  }, [openSignInInBrowser]);

  const onNavigationStateChange = useCallback((n: WebViewNavigation) => {
    setNav({ canGoBack: n.canGoBack, canGoForward: n.canGoForward, url: n.url, loading: n.loading });
    latestNavUrl.current = n.url;
    if (isScrimbaUrl(n.url) && !isScrimbaGitHubCallback(n.url)) navUrlRef.current = n.url;
    // Scrimba's callback page is built for its sign-in popup (it reports to the opener and
    // closes). In the single WebView there is no popup, so go back to where the user was.
    if (callbackTimer.current) {
      clearTimeout(callbackTimer.current);
      callbackTimer.current = null;
    }
    if (!n.loading && isScrimbaGitHubCallback(n.url)) {
      const back = signInReturnRef.current ?? SCRIMBA_HOME;
      callbackTimer.current = setTimeout(() => {
        callbackTimer.current = null;
        webRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(back)});true;`);
      }, 1500);
    }
    diagnostics.navigation({ canGoBack: n.canGoBack, canGoForward: n.canGoForward, url: n.url, loading: n.loading });
  }, []);

  const onLoadStart = useCallback(() => {
    // Scrimba answered the GitHub callback (the callback page or wherever it redirects).
    if (callbackRequested.current) {
      callbackRequested.current = false;
      if (callbackWatchdog.current) clearTimeout(callbackWatchdog.current);
      callbackWatchdog.current = null;
    }
    setLoadError(null);
    editorRef.current = null;
    bridge.reset();
    recoveryChecked.current.clear();
    setEditor(null);
    setLine(null);
    setLayout({ fullscreenEditor: false, expandedPreview: false, previewAvailable: false });
    setExecutionBlocked(false);
    diagnostics.update({ runtimeReady: false });
  }, [bridge]);

  const onLoadEnd = useCallback(() => diagnostics.navigation({ loading: false }), []);

  const onError = useCallback((e: WebViewErrorEvent) => {
    const d = e.nativeEvent;
    const offline = /INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|offline|-1009|not connected/i.test(`${d.description} ${d.code}`);
    setLoadError({
      title: offline ? "Can't reach Scrimba" : 'Page failed to load',
      message: offline ? 'Check your connection. Your settings and last lesson are saved on this device.' : d.description || 'Unknown error',
    });
    diagnostics.navigation({ lastError: `${d.code} ${d.description}` });
    diagnostics.log('error', 'webview', `load error ${d.code}: ${d.description}`);
  }, []);

  const onHttpError = useCallback((e: WebViewHttpErrorEvent) => {
    diagnostics.log('warn', 'webview', `HTTP ${e.nativeEvent.statusCode} for ${e.nativeEvent.url}`);
  }, []);

  const onProcessGone = useCallback((reason: string) => {
    diagnostics.log('error', 'webview', `web process ended: ${reason}; recreating WebView`);
    bridge.reset();
    // Re-open where the user was, not the launch URL.
    setUri(navUrlRef.current);
    setWebKey((k) => k + 1);
  }, [bridge]);

  // --- Sign out and clear data ----------------------------------------------------------
  const clearAllData = useCallback(() => {
    Alert.alert(
      'Sign out and clear data?',
      "Signs you out of Scrimba on this phone and deletes the app's cookies, website data and cache, its saved copies of unsaved code and your last lesson. Your app settings are kept.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out and clear',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const failures: string[] = [];
              webRef.current?.clearCache?.(true);
              if (!WebData) failures.push('cookies (native module missing)');
              else await WebData.clearAll().catch((e) => failures.push(`cookies (${String(e)})`));
              await recovery.clearAll().catch(() => failures.push('saved code copies'));
              await clearLastLocation().catch(() => failures.push('last lesson'));
              await clearPendingSignIn().catch(() => undefined);
              editorRef.current = null;
              currentLocation.current = '';
              signInReturnRef.current = null;
              setSettingsOpen(false);
              setLoadError(null);
              setUri(SCRIMBA_HOME);
              setWebKey((k) => k + 1); // fresh WebView with the cleared stores
              diagnostics.log(failures.length ? 'warn' : 'info', 'privacy', failures.length ? `clear data incomplete: ${failures.join(', ')}` : 'browsing data cleared');
              if (failures.length) Alert.alert('Not everything was cleared', `Could not clear: ${failures.join(', ')}. You can also clear the app's storage in Android settings.`);
            })();
          },
        },
      ],
    );
  }, [recovery]);

  // --- Recovery ---------------------------------------------------------------------
  const maybeOfferRecovery = useCallback(
    async (state: EditorState) => {
      if (!state.modelUri || !state.contentHash || state.dirty) return;
      const location = diagnostics.get().page?.location || currentLocation.current;
      if (!location) return;
      const key = `${location}|${state.modelUri}`;
      if (recoveryChecked.current.has(key)) return;
      recoveryChecked.current.add(key);
      const snap = await recovery.get(location, state.modelUri).catch(() => null);
      if (!snap || fnv1a(snap.content) === state.contentHash) return;
      const when = new Date(snap.savedAt).toLocaleString();
      Alert.alert('Restore unsaved edits?', `The app kept a local copy of edits to this file from ${when}. Restoring replaces the editor content (you can undo it).`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Discard copy', style: 'destructive', onPress: () => recovery.discard(location, state.modelUri!).catch(() => undefined) },
        { text: 'Restore', onPress: () => runCommand({ type: 'restoreSnapshot', modelUri: snap.modelUri, content: snap.content }) },
      ]);
    },
    [recovery, runCommand],
  );
  // --- Messages from the page -------------------------------------------------------
  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      // Defence in depth: the runtime only runs on Scrimba, so anything else is not ours.
      if (!isScrimbaPageUrl(e.nativeEvent.url)) return;
      const msg: PageToNative | null = bridge.handleRaw(e.nativeEvent.data);
      if (!msg) return;
      switch (msg.kind) {
        case 'ready':
          diagnostics.update({ runtimeReady: true });
          currentLocation.current = msg.location;
          bridge.send({ kind: 'config', config: runtimeConfig });
          break;
        case 'location':
          currentLocation.current = msg.location;
          if (looksLikeLesson(msg.location)) saveLastLocation(msg.location, msg.title).catch(() => undefined);
          break;
        case 'editorState': {
          const prev = editorRef.current;
          editorRef.current = msg.state;
          setEditor(msg.state);
          diagnostics.update({ editor: msg.state });
          if (prev?.dirty && !msg.state.dirty && msg.state.modelUri && currentLocation.current) {
            recovery.discard(currentLocation.current, msg.state.modelUri).catch(() => undefined);
          }
          if (msg.state.detected) maybeOfferRecovery(msg.state);
          break;
        }
        case 'lineState':
          setLine(msg.line);
          break;
        case 'playback':
          setPlayback(msg.state);
          diagnostics.update({ playback: msg.state });
          break;
        case 'physicalKeyboard':
          setPhysicalKeyboard(msg.detected);
          break;
        case 'modules': {
          diagnostics.update({ modules: msg.modules });
          // Fallback path for the execution notice: module statuses are re-sent on change.
          const ex = msg.modules.find((m) => m.name === 'execution');
          if (ex) setExecutionBlocked(ex.applicable && !ex.active);
          break;
        }
        case 'log':
          diagnostics.log(msg.level === 'error' ? 'error' : msg.level === 'warn' ? 'warn' : 'info', `page/${msg.module}`, msg.message);
          break;
        case 'diagnostics':
          diagnostics.update({ page: msg.report });
          break;
        case 'snapshot':
          recovery.save(msg.location, msg.modelUri, msg.content).catch((err) => diagnostics.log('warn', 'recovery', String(err)));
          break;
        case 'execution':
          setExecutionBlocked(msg.blocked);
          if (msg.blocked) diagnostics.log('warn', 'execution', `code runner unavailable: crossOriginIsolated=${msg.crossOriginIsolated} SharedArrayBuffer=${msg.sharedArrayBuffer}`);
          break;
        case 'clipboard':
          Clipboard.setStringAsync(msg.text).catch((err) => diagnostics.log('warn', 'selection', `copy failed: ${String(err)}`));
          break;
        case 'pasteRequest':
          Clipboard.getStringAsync()
            .then((text) => (text ? runCommand({ type: 'paste', text }) : undefined))
            .catch((err) => diagnostics.log('warn', 'selection', `paste failed: ${String(err)}`));
          break;
        case 'layoutState':
          setLayout({ fullscreenEditor: msg.fullscreenEditor, expandedPreview: msg.expandedPreview, previewAvailable: msg.previewAvailable });
          break;
        default:
          break;
      }
    },
    [bridge, runtimeConfig, recovery, maybeOfferRecovery, runCommand],
  );

  // --- Coding toolbar ---------------------------------------------------------------
  const onToolbarAction = useCallback(
    async (id: ToolbarActionId) => {
      if (id === 'paste') {
        const text = await Clipboard.getStringAsync().catch(() => '');
        if (text) await runCommand({ type: 'paste', text });
        return;
      }
      if (id === 'done') {
        await runCommand({ type: 'blur' });
        Keyboard.dismiss();
        return;
      }
      const action = getAction(id);
      if (!action.command) return;
      const r = await runCommand(action.command);
      if ((id === 'copy' || id === 'cut') && r.ok && typeof r.clipboardText === 'string') {
        await Clipboard.setStringAsync(r.clipboardText).catch(() => undefined);
      }
      if (id === 'save' && r.ok) diagnostics.log('info', 'editor', 'save shortcut sent');
    },
    [runCommand],
  );

  // --- Compatibility mode switching (needs a reload) --------------------------------
  const requestModeChange = useCallback(
    (next: Settings['compatMode']) => {
      const resolved = resolveMode(next);
      if (resolved === mode) {
        update({ compatMode: next });
        return;
      }
      const apply = () => {
        update({ compatMode: next });
        setMode(resolved);
        // userAgent prop change applies to the next load; reload keeps the same URL and cookies.
        setTimeout(() => webRef.current?.reload(), 50);
      };
      if (editorRef.current?.dirty) {
        Alert.alert('Unsaved changes', 'Switching site mode reloads the page. Save your code first to keep it.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save, then switch', onPress: () => runCommand({ type: 'save' }).then(() => setTimeout(apply, 800)) },
          { text: 'Switch anyway', style: 'destructive', onPress: apply },
        ]);
      } else apply();
    },
    [mode, update, runCommand],
  );

  // --- Diagnostics export -----------------------------------------------------------
  const nativeInfo: NativeInfo = useMemo(
    () => ({
      appVersion: Application.nativeApplicationVersion ?? 'dev',
      buildVersion: Application.nativeBuildVersion ?? 'dev',
      platform: Platform.OS,
      osVersion: String(Device.osVersion ?? Platform.Version),
      deviceModel: Device.modelName ?? 'unknown',
      isDevice: Device.isDevice,
    }),
    [],
  );
  const exportDiagnostics = useCallback(async () => {
    const text = buildReport(diagnostics.get(), nativeInfo, { ...settings });
    try {
      const file = new File(Paths.cache, `scrimba-companion-diagnostics-${Date.now()}.txt`);
      file.create();
      await file.write(text);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: 'Diagnostic report' });
      else {
        await Clipboard.setStringAsync(text);
        Alert.alert('Copied', 'Sharing is unavailable; the redacted report was copied to the clipboard.');
      }
    } catch (err) {
      await Clipboard.setStringAsync(text).catch(() => undefined);
      Alert.alert('Export', `Could not create a file (${String(err)}). The redacted report was copied to the clipboard instead.`);
    }
  }, [nativeInfo, settings]);

  // --- Layout -----------------------------------------------------------------------
  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setRootHeight((r) => (kb.visible ? { ...r, current: h } : { base: h, current: h }));
  }, [kb.visible]);

  // Android edge-to-edge does not resize the window for the IME; iOS never does. Pad by
  // whatever part of the keyboard the window did not already shrink for.
  // Measured on Android 16 (emulator): RN's keyboard height excludes the navigation bar,
  // so the bottom safe-area inset must stay applied. On iOS the keyboard frame includes
  // the home-indicator area, which the bottom inset already covers.
  const shrink = Math.max(0, rootHeight.base - rootHeight.current);
  const keyboardPad = kb.visible ? Math.max(0, kb.height - shrink - (Platform.OS === 'ios' ? insets.bottom : 0)) : 0;

  const editing = !!editor?.focused;
  const bridgeMode = settings.editingStrategy === 'bridge';
  const toolbarVisible =
    editing &&
    settings.codingToolbar !== 'never' &&
    (settings.codingToolbar === 'always' || (!hardwareKeyboard && (kb.visible || bridgeMode)));
  const bridgeVisible = bridgeMode && (editing || kb.visible) && !!line;
  const fullscreen = layout.fullscreenEditor || layout.expandedPreview;

  return (
    // Insets come from the hook (JS padding) rather than the native SafeAreaView: the native
    // view could keep a stale top inset on cold start (toolbar drawn under the status bar).
    <View
      testID="browser-root"
      style={[
        styles.root,
        {
          backgroundColor: fullscreen ? '#000' : palette.surface,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      onLayout={onRootLayout}
    >
      <StatusBar style={palette.dark ? 'light' : 'dark'} hidden={fullscreen} />
      {!fullscreen ? (
        <NavBar
          palette={palette}
          collapsed={settings.navBarCollapsed}
          canGoBack={nav.canGoBack}
          canGoForward={nav.canGoForward}
          fullscreenEditor={layout.fullscreenEditor}
          expandedPreview={layout.expandedPreview}
          previewAvailable={layout.previewAvailable}
          editorAvailable={!!editor?.detected}
          orientation={settings.orientation}
          onBack={goBack}
          onForward={goForward}
          onRefresh={refresh}
          onToggleFullscreen={() => setFullscreen(!layout.fullscreenEditor)}
          onTogglePreview={() => setPreview(!layout.expandedPreview)}
          onRotate={() => update({ orientation: nextOrientation(settings.orientation) })}
          onSettings={() => setSettingsOpen(true)}
          onToggleCollapsed={() => update({ navBarCollapsed: !settings.navBarCollapsed })}
        />
      ) : null}
      {executionBlocked && !executionNoticeDismissed && !fullscreen ? (
        <ExecutionNotice
          palette={palette}
          onDismiss={() => setExecutionNoticeDismissed(true)}
          onOpenInBrowser={() =>
            confirmIfDirty('Open in browser', () => {
              if (isScrimbaUrl(navUrlRef.current)) Linking.openURL(navUrlRef.current).catch(() => undefined);
            })
          }
        />
      ) : null}
      {isGitHubSignIn(nav.url) && !githubHintDismissed && !fullscreen ? (
        <GitHubSignInHint
          palette={palette}
          onDismiss={() => setGithubHintDismissed(true)}
          onSetPassword={() => Linking.openURL(GITHUB_SET_PASSWORD_URL).catch(() => undefined)}
        />
      ) : null}
      {online === false && !loadError ? <OfflineBanner palette={palette} onRetry={() => webRef.current?.reload()} /> : null}
      <View style={styles.webWrap}>
        <ScrimbaWebView
          key={webKey}
          ref={webRef}
          uri={uri}
          mode={mode}
          earlyScript={EARLY_SCRIPT}
          mainScript={mainScript}
          debuggable={__DEV__ || settings.developerMode}
          hideKeyboardAccessory={settings.hideIosKeyboardAccessory}
          backgroundColor={palette.dark ? '#1b1f25' : '#ffffff'}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onNavigationStateChange={onNavigationStateChange}
          onLoadStart={onLoadStart}
          onLoadEnd={onLoadEnd}
          onError={onError}
          onHttpError={onHttpError}
          onProcessGone={onProcessGone}
        />
        {fullscreen ? (
          <Pressable
            testID="exit-fullscreen"
            accessibilityRole="button"
            accessibilityLabel={layout.fullscreenEditor ? 'Exit full-screen editor' : 'Exit expanded preview'}
            onPress={() => (layout.fullscreenEditor ? setFullscreen(false) : setPreview(false))}
            style={[styles.exitFs, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <Text style={{ color: palette.text, fontWeight: '700' }}>✕ Exit</Text>
          </Pressable>
        ) : null}
        {loadError ? <ErrorScreen palette={palette} title={loadError.title} message={loadError.message} online={online} onRetry={() => { setLoadError(null); webRef.current?.reload(); }} onHome={goHome} /> : null}
      </View>
      {bridgeVisible ? <BridgeInput line={line} palette={palette} onCommand={(c) => void runCommand(c)} autoFocus /> : null}
      {toolbarVisible ? <CodingToolbar palette={palette} onAction={(id) => void onToolbarAction(id)} /> : null}
      {keyboardPad > 0 ? <View style={{ height: keyboardPad }} /> : null}

      <SettingsSheet
        visible={settingsOpen}
        settings={settings}
        palette={palette}
        appVersion={nativeInfo.appVersion}
        onChange={update}
        onRequestModeChange={requestModeChange}
        onClose={() => setSettingsOpen(false)}
        onOpenDiagnostics={() => {
          setSettingsOpen(false);
          bridge.send({ kind: 'requestDiagnostics' });
          setDiagOpen(true);
        }}
        onForgetLastLesson={() => clearLastLocation().catch(() => undefined)}
        onClearData={clearAllData}
        onReset={() =>
          Alert.alert('Reset settings?', 'All app preferences return to defaults. Your Scrimba sign-in is not affected.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: reset },
          ])
        }
      />
      <DiagnosticsPanel
        visible={diagOpen}
        palette={palette}
        snapshot={diagSnapshot}
        native={nativeInfo}
        onRefresh={() => bridge.send({ kind: 'requestDiagnostics' })}
        onExport={() => void exportDiagnostics()}
        onClose={() => setDiagOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  webWrap: { flex: 1 },
  exitFs: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, opacity: 0.92, zIndex: 25 },
});

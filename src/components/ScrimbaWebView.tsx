import { forwardRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigationEvent,
  WebViewRenderProcessGoneEvent,
  WebViewTerminatedEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { userAgentProps, type ResolvedMode } from '../webview/userAgent';

// react-native-webview 14 declares `WebView<P = undefined>`, which makes its props
// `WebViewProps & undefined` (= never). Instantiate with `object` to get the real props.
const TypedWebView = WebView<object>;
export type WebViewHandle = WebView<object>;

export interface ScrimbaWebViewProps {
  uri: string;
  mode: ResolvedMode;
  earlyScript: string;
  mainScript: string;
  debuggable: boolean;
  hideKeyboardAccessory: boolean;
  backgroundColor: string;
  onMessage(e: WebViewMessageEvent): void;
  onShouldStartLoadWithRequest(req: ShouldStartLoadRequest): boolean;
  onNavigationStateChange(nav: WebViewNavigation): void;
  onLoadStart(e: WebViewNavigationEvent): void;
  onLoadEnd(): void;
  onError(e: WebViewErrorEvent): void;
  onHttpError(e: WebViewHttpErrorEvent): void;
  onProcessGone(reason: string): void;
}

/**
 * The single, long-lived WebView that hosts the real Scrimba site.
 * Cookies/session stay in the platform WebView store (never read by the app).
 */
export const ScrimbaWebView = forwardRef<WebViewHandle, ScrimbaWebViewProps>(function ScrimbaWebView(p, ref) {
  return (
    <TypedWebView
      ref={ref}
      source={{ uri: p.uri }}
      style={[styles.web, { backgroundColor: p.backgroundColor }]}
      containerStyle={{ backgroundColor: p.backgroundColor }}
      originWhitelist={['https://*', 'http://*', 'about:*', 'blob:*', 'data:*']}
      javaScriptEnabled
      domStorageEnabled
      cacheEnabled
      incognito={false}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      {...userAgentProps(p.mode)}
      injectedJavaScriptBeforeContentLoaded={p.earlyScript}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      injectedJavaScript={p.mainScript}
      injectedJavaScriptForMainFrameOnly
      onMessage={p.onMessage}
      onShouldStartLoadWithRequest={p.onShouldStartLoadWithRequest}
      onNavigationStateChange={p.onNavigationStateChange}
      onLoadStart={p.onLoadStart}
      onLoadEnd={p.onLoadEnd}
      onError={p.onError}
      onHttpError={p.onHttpError}
      onRenderProcessGone={(e: WebViewRenderProcessGoneEvent) => p.onProcessGone(e.nativeEvent.didCrash ? 'renderer crashed' : 'renderer killed')}
      onContentProcessDidTerminate={(_e: WebViewTerminatedEvent) => p.onProcessGone('content process terminated')}
      // Audio: Scrimba starts instructor audio from the user's own tap on Play; allowing
      // programmatic play avoids gesture-propagation failures in WebViews.
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      // Keyboard: let focus() from our tap-assist summon the iOS keyboard.
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView={p.hideKeyboardAccessory}
      // Horizontal swipes belong to the code editor, not history navigation.
      allowsBackForwardNavigationGestures={false}
      setSupportMultipleWindows={false}
      // iOS: Scrimba's "Continue with GitHub" uses window.open; WKWebView drops popups opened
      // outside a direct tap unless this is set. react-native-webview then loads the popup's
      // URL in this same WebView, like Android does with multiple windows off.
      javaScriptCanOpenWindowsAutomatically={Platform.OS === 'ios'}
      allowsLinkPreview={false}
      dataDetectorTypes={['none']}
      textZoom={100}
      setBuiltInZoomControls={false}
      setDisplayZoomControls={false}
      overScrollMode="never"
      pullToRefreshEnabled={false}
      bounces={false}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      allowFileAccess={false}
      mixedContentMode="never"
      webviewDebuggingEnabled={p.debuggable}
      nestedScrollEnabled={Platform.OS === 'android'}
    />
  );
});

const styles = StyleSheet.create({
  web: { flex: 1 },
});

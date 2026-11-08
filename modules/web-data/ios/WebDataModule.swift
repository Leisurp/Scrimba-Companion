import ExpoModulesCore
import WebKit

/// Clears what WKWebView keeps for websites: cookies (the Scrimba session), local storage,
/// IndexedDB, caches and service workers. Untested: iOS has not been built yet.
public class WebDataModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WebDataModule")

    AsyncFunction("clearAll") { (promise: Promise) in
      let store = WKWebsiteDataStore.default()
      store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: Date(timeIntervalSince1970: 0)) {
        HTTPCookieStorage.shared.removeCookies(since: Date(timeIntervalSince1970: 0))
        promise.resolve(true)
      }
    }.runOnQueue(.main)
  }
}

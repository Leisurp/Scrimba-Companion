package io.github.leisurp.scrimbacompanion.webdata

import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebViewDatabase
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Clears what the app's WebView keeps for websites: cookies (the Scrimba session),
 * DOM storage / IndexedDB / Cache API data, and saved HTTP auth. The HTTP cache is cleared
 * from JS with the WebView's own `clearCache(true)`.
 */
class WebDataModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WebDataModule")

    AsyncFunction("clearAll") { promise: Promise ->
      val cookies = CookieManager.getInstance()
      cookies.removeAllCookies { _ ->
        cookies.flush()
        WebStorage.getInstance().deleteAllData()
        appContext.reactContext?.let { ctx ->
          runCatching { WebViewDatabase.getInstance(ctx).clearHttpAuthUsernamePassword() }
        }
        promise.resolve(true)
      }
    }.runOnQueue(Queues.MAIN)
  }
}

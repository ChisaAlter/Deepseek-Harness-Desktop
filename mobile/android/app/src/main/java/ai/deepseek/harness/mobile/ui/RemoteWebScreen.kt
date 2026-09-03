package ai.deepseek.harness.mobile.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun RemoteWebScreen(
    url: String,
    chromeClient: WebChromeClient,
    onLeave: () -> Unit,
    onLoadError: (String) -> Unit,
    onOpenExternal: (Uri) -> Unit,
) {
    val context = LocalContext.current
    val appOrigin = remember(url) { Uri.parse(url).origin() }
    val assetLoader = remember {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
    }
    val webView = remember {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = true
            settings.setSupportMultipleWindows(false)
            // The SPA is served from the HTTPS asset origin (crypto.subtle for
            // the E2EE handshake needs a secure context), but the product
            // relay is plain ws://<host>:8411 and a LAN desktop is plain http.
            // Chromium classifies both as blockable mixed content and would
            // silently drop the socket, leaving a blank page. The relay hop is
            // already end-to-end encrypted at the DaemonClient layer, so
            // allowing mixed content here does not weaken the channel.
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.userAgentString = "${settings.userAgentString} DshAndroid/2"
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        }
    }

    DisposableEffect(webView, chromeClient, appOrigin) {
        webView.webChromeClient = chromeClient
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)
                    ?: super.shouldInterceptRequest(view, request)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val target = request.url
                if (target.origin() == appOrigin) return false
                if (target.scheme == "http" || target.scheme == "https") {
                    onOpenExternal(target)
                }
                return true
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    onLoadError("无法打开电脑上的手机页：${error.description}")
                }
            }
        }
        onDispose {
            webView.stopLoading()
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            webView.destroy()
        }
    }

    BackHandler {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            onLeave()
        }
    }

    AndroidView(
        factory = {
            webView.apply { loadUrl(url) }
        },
        update = { view ->
            // A warm singleTask Activity receives a new scan through
            // MainActivity.onNewIntent. The ViewModel URL changes while the
            // same WebView instance remains mounted; only checking for an
            // empty URL leaves the old offer (or the blank landing page)
            // visible and never starts the new pairing handshake.
            if (view.url != url) view.loadUrl(url)
        },
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing),
    )
}

private fun Uri.origin(): String =
    if (scheme == null || authority == null) "" else "${scheme!!.lowercase()}://${authority!!.lowercase()}"

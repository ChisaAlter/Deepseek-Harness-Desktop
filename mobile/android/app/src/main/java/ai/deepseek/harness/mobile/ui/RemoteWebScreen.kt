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
import android.webkit.RenderProcessGoneDetail
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.ByteArrayInputStream

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun RemoteWebScreen(
    url: String,
    requestId: Long,
    chromeClient: WebChromeClient,
    onLeave: () -> Unit,
    onLoadError: (String) -> Unit,
    onOpenExternal: (Uri) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
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
            // Local HTTPS assets must reach the configured plain-WS relay.
            // DaemonClient encrypts the relay payload; this setting itself
            // does not provide transport security for other HTTP resources.
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.userAgentString = "${settings.userAgentString} DshAndroid/2"
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        }
    }
    val navigation = remember(webView) { RemoteWebNavigation() }

    DisposableEffect(webView, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    webView.onResume()
                    webView.evaluateJavascript("window.dispatchEvent(new Event('dshd-resume'))", null)
                }
                Lifecycle.Event.ON_PAUSE -> webView.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(webView) {
        onDispose {
            webView.stopLoading()
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            webView.destroy()
        }
    }

    DisposableEffect(webView, chromeClient, appOrigin) {
        webView.webChromeClient = chromeClient
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                val asset = assetLoader.shouldInterceptRequest(request.url)
                if (asset != null) return asset
                if (request.url.origin() == appOrigin) {
                    return WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                return super.shouldInterceptRequest(view, request)
            }

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
                    onLoadError("无法加载内置手机页：${error.description}")
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) onLoadError("内置手机页加载失败（${response.statusCode}）")
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                onLoadError("手机页面已停止，请重新打开；已保存的配对仍保留")
                return true
            }
        }
        // The WebView lifetime effect owns cleanup, including destruction.
        onDispose { }
    }

    BackHandler {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            onLeave()
        }
    }

    AndroidView(
        factory = { webView },
        update = { view ->
            // A warm singleTask Activity receives a new scan through
            // MainActivity.onNewIntent. The ViewModel URL changes while the
            // same WebView instance remains mounted; only checking for an
            // empty URL leaves the old offer (or the blank landing page)
            // visible and never starts the new pairing handshake.
            when (navigation.next(requestId, view.url, url)) {
                WebNavigationAction.Load -> view.loadUrl(url)
                WebNavigationAction.Reload -> view.reload()
                WebNavigationAction.None -> Unit
            }
        },
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing),
    )
}

private fun Uri.origin(): String =
    if (scheme == null || authority == null) "" else "${scheme!!.lowercase()}://${authority!!.lowercase()}"

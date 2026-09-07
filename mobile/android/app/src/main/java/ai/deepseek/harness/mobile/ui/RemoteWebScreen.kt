package ai.deepseek.harness.mobile.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.ByteArrayInputStream

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun RemoteWebScreen(
    url: String,
    requestId: Long,
    getCurrentRequestId: () -> Long?,
    chromeClient: WebChromeClient,
    onCancelFileChooser: () -> Unit,
    onLeave: () -> Unit,
    onFatalLoadError: (String) -> Unit,
    onOpenExternal: (Uri) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val appOrigin = "https://appassets.androidplatform.net"
    val readRequestId by rememberUpdatedState(getCurrentRequestId)
    val currentLeave by rememberUpdatedState(onLeave)
    val currentFatalLoadError by rememberUpdatedState(onFatalLoadError)
    val cancelFileChooser by rememberUpdatedState(onCancelFileChooser)
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
    val back = remember(webView) { RemoteWebBack() }
    val recovery = remember(webView) { RemoteWebBackRecovery() }
    val backTimeouts = remember(webView) { Handler(Looper.getMainLooper()) }

    DisposableEffect(webView, requestId) {
        back.invalidate()
        recovery.dismiss()
        cancelFileChooser()
        onDispose {
            back.invalidate()
            backTimeouts.removeCallbacksAndMessages(null)
            cancelFileChooser()
        }
    }

    DisposableEffect(webView, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    webView.onResume()
                    if (isTrustedAssetPage(webView.url)) {
                        webView.evaluateJavascript("window.dispatchEvent(new Event('dshd-resume'))", null)
                    }
                }
                Lifecycle.Event.ON_PAUSE -> {
                    back.invalidate()
                    recovery.paused()
                    backTimeouts.removeCallbacksAndMessages(null)
                    webView.onPause()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(webView) {
        onDispose {
            back.dispose()
            backTimeouts.removeCallbacksAndMessages(null)
            cancelFileChooser()
            webView.stopLoading()
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            webView.destroy()
        }
    }

    DisposableEffect(webView, chromeClient, appOrigin) {
        webView.webChromeClient = chromeClient
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                back.invalidate()
                recovery.dismiss()
                backTimeouts.removeCallbacksAndMessages(null)
                cancelFileChooser()
            }

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
                if (request.isForMainFrame && isTrustedAssetPage(target.toString())) return false
                if (mayOpenExternalPage(target.toString(), request.isForMainFrame, request.hasGesture())) {
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
                    currentFatalLoadError("无法加载内置手机页：${error.description}")
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) currentFatalLoadError("内置手机页加载失败（${response.statusCode}）")
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                currentFatalLoadError("手机页面已停止，请重新打开；已保存的配对仍保留")
                return true
            }
        }
        // The WebView lifetime effect owns cleanup, including destruction.
        onDispose { }
    }

    fun dismissRecovery() {
        back.invalidate()
        backTimeouts.removeCallbacksAndMessages(null)
        recovery.dismiss()
    }

    fun requestBack() {
        val now = SystemClock.uptimeMillis()
        if (ViewCompat.getRootWindowInsets(webView)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
            back.keyboardDismissed(now)
            ViewCompat.getWindowInsetsController(webView)?.hide(WindowInsetsCompat.Type.ime())
        } else {
            val activeRequest = readRequestId()
            val ticket = if (activeRequest == requestId) back.begin(requestId, now) else null
            if (ticket != null) {
                recovery.started()
                fun receive(value: String?) {
                    // Read the ViewModel now; a new VIEW intent can precede recomposition.
                    val latestRequest = readRequestId() ?: return
                    if (!back.isPending(ticket, latestRequest)) return
                    recovery.accept(
                        back.complete(ticket, latestRequest, webView.url, value, SystemClock.uptimeMillis()),
                        currentLeave,
                    )
                }
                if (!isTrustedAssetPage(webView.url)) {
                    receive(null)
                } else {
                    val timeout = Runnable { receive(null) }
                    backTimeouts.postDelayed(timeout, 2_000)
                    try {
                        webView.evaluateJavascript(RemoteWebBack.SCRIPT) { value ->
                            backTimeouts.removeCallbacks(timeout)
                            receive(value)
                        }
                    } catch (_: Exception) {
                        backTimeouts.removeCallbacks(timeout)
                        receive(null)
                    }
                }
            }
        }
    }

    BackHandler {
        if (recovery.visible && ViewCompat.getRootWindowInsets(webView)?.isVisible(WindowInsetsCompat.Type.ime()) != true) {
            dismissRecovery()
        } else {
            requestBack()
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        val recoveryMaxHeight = maxHeight / 2
        Column(Modifier.fillMaxSize()) {
            if (recovery.visible) {
                NavigationRecoveryBanner(
                    waiting = recovery.waiting,
                    onRetry = ::requestBack,
                    onDismiss = ::dismissRecovery,
                    modifier = Modifier.heightIn(max = recoveryMaxHeight),
                )
            }
            AndroidView(
                factory = { webView },
                update = { view ->
                    // Only an explicit native request can load an offer; banner updates
                    // and retries keep this WebView and its live document mounted.
                    when (navigation.next(requestId, view.url, url)) {
                        WebNavigationAction.Load -> {
                            back.invalidate()
                            cancelFileChooser()
                            if (isTrustedAssetPage(url)) view.loadUrl(url)
                            else currentFatalLoadError("无法打开内置手机页，请重新打开")
                        }
                        WebNavigationAction.Reload -> {
                            back.invalidate()
                            cancelFileChooser()
                            if (isTrustedAssetPage(view.url)) view.reload()
                            else currentFatalLoadError("无法打开内置手机页，请重新打开")
                        }
                        WebNavigationAction.None -> Unit
                    }
                },
                modifier = Modifier.fillMaxWidth().weight(1f),
            )
        }
    }
}

private fun Uri.origin(): String =
    if (scheme == null || authority == null) "" else "${scheme!!.lowercase()}://${authority!!.lowercase()}"

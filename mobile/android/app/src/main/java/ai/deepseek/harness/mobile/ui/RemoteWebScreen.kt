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
import android.view.View
import android.webkit.WebViewClient
import android.webkit.RenderProcessGoneDetail
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.ByteArrayInputStream
import java.util.UUID
import org.json.JSONObject

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun RemoteWebScreen(
    url: String,
    requestId: Long,
    getCurrentRequestId: () -> Long?,
    chromeClient: WebChromeClient,
    onCancelFileChooser: () -> Unit,
    onLeave: () -> Unit,
    onRequestScan: () -> Unit,
    onFatalLoadError: (String) -> Unit,
    onOpenExternal: (Uri) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val appOrigin = "https://appassets.androidplatform.net"
    val readRequestId by rememberUpdatedState(getCurrentRequestId)
    val currentLeave by rememberUpdatedState(onLeave)
    val currentRequestScan by rememberUpdatedState(onRequestScan)
    val currentFatalLoadError by rememberUpdatedState(onFatalLoadError)
    val cancelFileChooser by rememberUpdatedState(onCancelFileChooser)
    var nativeState by remember { mutableStateOf(NativeChatState()) }
    val nativeDrafts = remember { mutableStateMapOf<String, String>() }
    val nativeSubmitted = remember { mutableStateMapOf<String, NativeSubmittedDraft>() }
    var legacyPage by remember { mutableStateOf(false) }
    var documentRequestId by remember { mutableStateOf<Long?>(null) }
    var documentEpoch by remember { mutableStateOf<String?>(null) }
    val bridgeSupported = remember { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
    val nativeVisible = nativeState.route == "chat" && nativeState.connected && !legacyPage
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
            // Register before AndroidView's first loadUrl. A later effect can
            // miss the initial document and leave paired chat in WebView.
            if (bridgeSupported) {
                WebViewCompat.addWebMessageListener(this, "DshdNativeBridge", setOf(appOrigin)) {
                        view, message, sourceOrigin, isMainFrame, _ ->
                    if (isMainFrame && sourceOrigin.toString() == appOrigin && isTrustedAssetPage(view.url)
                        && documentRequestId != null && documentRequestId == readRequestId()) {
                        val next = message.data?.let(NativeChatState::parse)
                        if (next != null) {
                            val receivedFor = documentRequestId
                            val accept = {
                                if (receivedFor != null && receivedFor == documentRequestId
                                    && receivedFor == readRequestId() && next.epoch == documentEpoch
                                    && next.seq > nativeState.seq) {
                                    nativeState = next
                                }
                            }
                            if (Looper.myLooper() == Looper.getMainLooper()) accept()
                            else Handler(Looper.getMainLooper()).post { accept() }
                        }
                    }
                }
            }
        }
    }
    // Unlike addJavascriptInterface, the listener reports sender frame/origin.
    DisposableEffect(bridgeSupported) {
        if (!bridgeSupported) {
            currentFatalLoadError("系统 WebView 不支持安全的原生聊天桥接；请更新 Android System WebView")
        }
        onDispose { }
    }
    val navigation = remember(webView) { RemoteWebNavigation() }
    val back = remember(webView) { RemoteWebBack() }
    val recovery = remember(webView) { RemoteWebBackRecovery() }
    val backTimeouts = remember(webView) { Handler(Looper.getMainLooper()) }

    DisposableEffect(webView, requestId) {
        back.invalidate()
        recovery.dismiss()
        cancelFileChooser()
        nativeState = NativeChatState()
        nativeDrafts.clear()
        nativeSubmitted.clear()
        legacyPage = false
        documentRequestId = null
        documentEpoch = null
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
                nativeState = NativeChatState()
                legacyPage = false
                documentRequestId = readRequestId().takeIf { isTrustedAssetPage(url) }
                documentEpoch = documentRequestId?.let { UUID.randomUUID().toString() }
                back.invalidate()
                recovery.dismiss()
                backTimeouts.removeCallbacksAndMessages(null)
                cancelFileChooser()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                val epoch = documentEpoch ?: return
                if (!isTrustedAssetPage(url) || documentRequestId != readRequestId()) return
                fun bootstrap(attempt: Int) {
                    if (documentEpoch != epoch || documentRequestId != readRequestId()
                        || !isTrustedAssetPage(view.url)) return
                    view.evaluateJavascript(
                        "window.__dshdNativeBootstrap?.(${JSONObject.quote(epoch)})",
                    ) { result ->
                        if (result == "true" || documentEpoch != epoch) return@evaluateJavascript
                        if (attempt < 3) Handler(Looper.getMainLooper()).postDelayed({ bootstrap(attempt + 1) }, 200)
                        else currentFatalLoadError("原生聊天桥接未就绪，请重新打开")
                    }
                }
                bootstrap(0)
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
                if (shouldOpenNativeScan(target.toString(), request.isForMainFrame, request.hasGesture())) {
                    currentRequestScan()
                    return true
                }
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

    BackHandler(enabled = !nativeVisible) {
        if (legacyPage) {
            if (ViewCompat.getRootWindowInsets(webView)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                ViewCompat.getWindowInsetsController(webView)?.hide(WindowInsetsCompat.Type.ime())
                return@BackHandler
            }
            legacyPage = false
            return@BackHandler
        }
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
            Box(Modifier.fillMaxWidth().weight(1f)) {
                AndroidView(
                    factory = { webView },
                    update = { view ->
                        // The transport document is never a second interactive
                        // surface behind Compose, including for TalkBack.
                        view.isEnabled = !nativeVisible
                        // Alpha alone hides pixels, not WebView's virtual
                        // accessibility nodes on Android. INVISIBLE keeps the
                        // transport document alive without exposing its UI.
                        view.visibility = if (nativeVisible) View.INVISIBLE else View.VISIBLE
                        view.isFocusable = !nativeVisible
                        view.isFocusableInTouchMode = !nativeVisible
                        view.importantForAccessibility = if (nativeVisible)
                            View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                        else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                        view.setOnTouchListener(if (nativeVisible) View.OnTouchListener { _, _ -> true } else null)
                        if (nativeVisible && view.hasFocus()) view.clearFocus()
                        // Only an explicit native request can load an offer; snapshots
                        // and Compose recomposition keep the live document mounted.
                        when (navigation.next(requestId, view.url, url)) {
                            WebNavigationAction.Load -> {
                                back.invalidate()
                                cancelFileChooser()
                                documentRequestId = null
                                documentEpoch = null
                                if (isTrustedAssetPage(url)) view.loadUrl(url)
                                else currentFatalLoadError("无法打开内置手机页，请重新打开")
                            }
                            WebNavigationAction.Reload -> {
                                back.invalidate()
                                cancelFileChooser()
                                documentRequestId = null
                                documentEpoch = null
                                if (isTrustedAssetPage(view.url)) view.reload()
                                else currentFatalLoadError("无法打开内置手机页，请重新打开")
                            }
                            WebNavigationAction.None -> Unit
                        }
                    },
                    modifier = if (nativeVisible) Modifier.fillMaxSize().alpha(0f)
                        else Modifier.fillMaxSize(),
                )
                if (nativeVisible) NativeChatScreen(
                    state = nativeState,
                    drafts = nativeDrafts,
                    submitted = nativeSubmitted,
                    onAction = { action ->
                        if (isTrustedAssetPage(webView.url) && readRequestId() == requestId
                            && documentRequestId == requestId) {
                            val payload = JSONObject().put("type", action.type)
                            when (action.type) {
                                "open", "cancel", "older", "retry" -> payload.put("sessionId", action.sessionId)
                                "draft", "send" -> payload.put("sessionId", action.sessionId).put("text", action.text)
                                "approve" -> payload.put("sessionId", action.sessionId)
                                    .put("approvalId", action.approvalId).put("actionId", action.actionId)
                                "model" -> {
                                    payload.put("sessionId", action.sessionId).put("provider", action.provider)
                                        .put("model", action.model)
                                    if (action.reasoningEffort.isNotBlank()) payload.put("reasoningEffort", action.reasoningEffort)
                                }
                                "permission" -> payload.put("sessionId", action.sessionId).put("id", action.id)
                                "planOff" -> payload.put("sessionId", action.sessionId)
                                "slash" -> payload.put("sessionId", action.sessionId).put("line", action.line)
                                "new", "refresh" -> Unit
                                else -> return@NativeChatScreen
                            }
                            webView.evaluateJavascript(
                                "window.__dshdNativeAction?.(${JSONObject.quote(payload.toString())})", null,
                            )
                        }
                    },
                    onLegacyPage = { legacyPage = true },
                    onLeave = currentLeave,
                )
                if (legacyPage && nativeState.route == "chat") {
                    androidx.compose.material3.Surface(
                        onClick = { legacyPage = false },
                        modifier = Modifier.align(Alignment.TopCenter).heightIn(min = 48.dp),
                        color = ai.deepseek.harness.mobile.ui.theme.dsh().bgLayer1,
                    ) {
                        androidx.compose.material3.Text("‹ 返回原生聊天", Modifier.padding(horizontal = 18.dp, vertical = 12.dp))
                    }
                }
            }
        }
    }
}

private fun Uri.origin(): String =
    if (scheme == null || authority == null) "" else "${scheme!!.lowercase()}://${authority!!.lowercase()}"

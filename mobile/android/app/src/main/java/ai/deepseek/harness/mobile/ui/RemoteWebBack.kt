package ai.deepseek.harness.mobile.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.net.URI

internal fun isTrustedAssetPage(url: String?): Boolean = runCatching {
    val uri = URI(url ?: return false)
    uri.scheme == "https" && uri.rawAuthority == "appassets.androidplatform.net" &&
        uri.path == "/assets/index.html"
}.getOrDefault(false)

internal enum class WebBackResult { Ignore, Handled, Busy, Root, Recover }

/** Navigation recovery cannot invoke the fatal-load path or recreate the page. */
internal class RemoteWebBackRecovery {
    var visible by mutableStateOf(false)
        private set
    var waiting by mutableStateOf(false)
        private set

    fun started() { waiting = true }
    fun paused() { waiting = false }
    fun dismiss() {
        visible = false
        waiting = false
    }

    fun accept(result: WebBackResult, onLeave: () -> Unit) {
        if (result == WebBackResult.Ignore) return
        waiting = false
        visible = result == WebBackResult.Recover
        if (result == WebBackResult.Root) onLeave()
    }
}

internal fun mayOpenExternalPage(url: String, mainFrame: Boolean, gesture: Boolean): Boolean =
    mainFrame && gesture && runCatching {
        val uri = URI(url)
        uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null
    }.getOrDefault(false)

/** A Back result belongs to one native request and one loaded document. */
internal class RemoteWebBack {
    data class Ticket(val requestId: Long, val document: Long, val sequence: Long)

    private var document = 0L
    private var sequence = 0L
    private var pending: Ticket? = null
    private var blockedUntil = 0L
    private var disposed = false

    fun invalidate() {
        document += 1
        pending = null
    }

    fun dispose() {
        disposed = true
        invalidate()
    }

    fun keyboardDismissed(now: Long) {
        blockedUntil = now + 350
    }

    fun begin(requestId: Long, now: Long): Ticket? {
        if (disposed || pending != null || now < blockedUntil) return null
        return Ticket(requestId, document, ++sequence).also { pending = it }
    }

    fun isPending(ticket: Ticket, requestId: Long): Boolean =
        !disposed && pending == ticket && ticket.requestId == requestId && ticket.document == document

    fun complete(ticket: Ticket, requestId: Long, url: String?, value: String?, now: Long): WebBackResult {
        if (disposed || pending != ticket) return WebBackResult.Ignore
        pending = null
        if (ticket.requestId != requestId || ticket.document != document) return WebBackResult.Ignore
        blockedUntil = now + 350
        if (!isTrustedAssetPage(url)) return WebBackResult.Recover
        // evaluateJavascript returns JSON, not an unquoted JS string.
        return when (value) {
            "\"handled\"" -> WebBackResult.Handled
            "\"busy\"" -> WebBackResult.Busy
            "\"root\"" -> WebBackResult.Root
            else -> WebBackResult.Recover
        }
    }

    companion object {
        const val SCRIPT = """(function(){try{if(!window.__dshdNavigation||typeof window.__dshdNavigation.back!=='function')return null;return window.__dshdNavigation.back();}catch(error){return null;}})()"""
    }
}

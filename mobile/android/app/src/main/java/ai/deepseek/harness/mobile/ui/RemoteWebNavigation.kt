package ai.deepseek.harness.mobile.ui

internal enum class WebNavigationAction { None, Load, Reload }

/** Track explicit native requests, not the URL that the SPA cleans after pairing. */
internal class RemoteWebNavigation {
    private var lastRequestId: Long? = null

    fun next(requestId: Long, currentUrl: String?, targetUrl: String): WebNavigationAction {
        if (lastRequestId == requestId) return WebNavigationAction.None
        lastRequestId = requestId
        return if (currentUrl == targetUrl) WebNavigationAction.Reload else WebNavigationAction.Load
    }
}

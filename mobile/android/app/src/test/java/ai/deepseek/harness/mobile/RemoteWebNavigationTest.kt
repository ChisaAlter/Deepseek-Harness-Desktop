package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.RemoteWebNavigation
import ai.deepseek.harness.mobile.ui.WebNavigationAction
import ai.deepseek.harness.mobile.ui.isNativeScanRequest
import ai.deepseek.harness.mobile.ui.shouldOpenNativeScan
import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteWebNavigationTest {
    private val base = "https://appassets.androidplatform.net/assets/index.html"

    @Test
    fun cleanedOfferIsNotRestoredByRecomposition() {
        val navigation = RemoteWebNavigation()
        val offer = "$base#offer=first"
        assertEquals(WebNavigationAction.Load, navigation.next(1, null, offer))
        assertEquals(WebNavigationAction.None, navigation.next(1, base, offer))
    }

    @Test
    fun explicitRetryAndNewOfferAreBothHandled() {
        val navigation = RemoteWebNavigation()
        val offer = "$base#offer=first"
        navigation.next(1, null, offer)
        assertEquals(WebNavigationAction.Reload, navigation.next(2, offer, offer))
        assertEquals(WebNavigationAction.Load, navigation.next(3, offer, "$base#offer=second"))
        assertEquals(WebNavigationAction.Load, navigation.next(4, offer, base))
    }

    @Test
    fun onlyExactNativeScanNavigationIsAccepted() {
        assertEquals(true, isNativeScanRequest("dshd://scan"))
        assertEquals(false, isNativeScanRequest("dshd://scan/again"))
        assertEquals(false, isNativeScanRequest("https://example.com/?next=dshd://scan"))
        assertEquals(false, isNativeScanRequest(null))
    }

    @Test
    fun nativeScanRequiresMainFrameAndUserGesture() {
        assertEquals(true, shouldOpenNativeScan("dshd://scan", isForMainFrame = true, hasGesture = true))
        assertEquals(false, shouldOpenNativeScan("dshd://scan", isForMainFrame = false, hasGesture = true))
        assertEquals(false, shouldOpenNativeScan("dshd://scan", isForMainFrame = true, hasGesture = false))
        assertEquals(false, shouldOpenNativeScan("dshd://scan/again", isForMainFrame = true, hasGesture = true))
    }
}

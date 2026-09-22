package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.RemoteWebNavigation
import ai.deepseek.harness.mobile.ui.WebNavigationAction
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
}

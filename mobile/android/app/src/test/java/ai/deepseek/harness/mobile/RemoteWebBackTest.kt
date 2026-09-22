package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.RemoteWebBack
import ai.deepseek.harness.mobile.ui.RemoteWebBackRecovery
import ai.deepseek.harness.mobile.ui.WebBackResult
import ai.deepseek.harness.mobile.ui.isTrustedAssetPage
import ai.deepseek.harness.mobile.ui.mayOpenExternalPage
import org.junit.Assert.*
import org.junit.Test

class RemoteWebBackTest {
    private val url = "https://appassets.androidplatform.net/assets/index.html"

    @Test fun onlyExplicitRootLeaves() {
        mapOf("\"root\"" to WebBackResult.Root, "\"handled\"" to WebBackResult.Handled,
            "\"busy\"" to WebBackResult.Busy).forEach { (value, expected) ->
            val back = RemoteWebBack()
            assertEquals(expected, back.complete(back.begin(1, 1000)!!, 1, url, value, 1001))
        }
    }

    @Test fun missingInvalidAndErrorResponsesRecoverWithoutLeaving() {
        listOf(null, "null", "undefined", "true", "root", "{}", "\"error\"", "\"ROOT\"", "\"root\" ").forEach { value ->
            val back = RemoteWebBack()
            assertEquals(WebBackResult.Recover, back.complete(back.begin(1, 1000)!!, 1, url, value, 1001))
        }
    }

    @Test fun pendingAndRapidSecondPressAreIgnored() {
        val back = RemoteWebBack()
        val first = back.begin(1, 1000)!!
        assertNull(back.begin(1, 1001))
        assertEquals(WebBackResult.Handled, back.complete(first, 1, url, "\"handled\"", 1002))
        assertNull(back.begin(1, 1003))
        assertNotNull(back.begin(1, 1400))
        assertEquals(WebBackResult.Ignore, back.complete(first, 1, url, "\"root\"", 1401))
    }

    @Test fun keyboardDismissalDoesNotAlsoNavigate() {
        val back = RemoteWebBack()
        back.keyboardDismissed(1000)
        assertNull(back.begin(1, 1001))
        assertNotNull(back.begin(1, 1400))
    }

    @Test fun newRequestAndDocumentInvalidateOldCallbacks() {
        val back = RemoteWebBack()
        val first = back.begin(1, 1000)!!
        assertFalse(back.isPending(first, 2))
        assertEquals(WebBackResult.Ignore, back.complete(first, 2, url, "\"root\"", 1001))
        val second = back.begin(2, 1002)!!
        back.invalidate()
        val current = back.begin(2, 1003)!!
        assertFalse(back.isPending(second, 2))
        assertEquals(WebBackResult.Ignore, back.complete(second, 2, url, "\"root\"", 1004))
        assertTrue(back.isPending(current, 2))
        assertEquals(WebBackResult.Root, back.complete(current, 2, url, "\"root\"", 1005))
    }

    @Test fun destructionRejectsCallbackAndFuturePresses() {
        val back = RemoteWebBack()
        val ticket = back.begin(1, 1000)!!
        back.dispose()
        assertFalse(back.isPending(ticket, 1))
        assertEquals(WebBackResult.Ignore, back.complete(ticket, 1, url, "\"root\"", 1001))
        assertNull(back.begin(1, 2000))
    }

    @Test fun timeoutWinsOverLateRoot() {
        val back = RemoteWebBack()
        val ticket = back.begin(1, 1000)!!
        assertEquals(WebBackResult.Recover, back.complete(ticket, 1, url, null, 3000))
        assertEquals(WebBackResult.Ignore, back.complete(ticket, 1, url, "\"root\"", 3001))
    }

    @Test fun validatesAssetPageAgainAtCallback() {
        listOf(null, "about:blank", "http://appassets.androidplatform.net/assets/index.html",
            "https://appassets.androidplatform.net.evil/assets/index.html", "https://evil@appassets.androidplatform.net/assets/index.html",
            "https://appassets.androidplatform.net/assets/other.html", "https://appassets.androidplatform.net:444/assets/index.html").forEach { untrusted ->
            assertFalse(isTrustedAssetPage(untrusted))
            val back = RemoteWebBack()
            assertEquals(WebBackResult.Recover, back.complete(back.begin(1, 1000)!!, 1, untrusted, "\"root\"", 1001))
        }
        assertTrue(isTrustedAssetPage(url))
        assertTrue(isTrustedAssetPage("$url#offer=new"))
    }

    @Test fun recoveryRetainsMountedPageAndDraftUntilExplicitRoot() {
        val recovery = RemoteWebBackRecovery()
        var mounted = true
        var draft = "unsent text"
        val leave = { mounted = false; draft = "" }
        recovery.started()
        recovery.accept(WebBackResult.Recover, leave)
        assertTrue(recovery.visible)
        assertFalse(recovery.waiting)
        assertTrue(mounted)
        assertEquals("unsent text", draft)
        recovery.started() // explicit Retry Back; no page reload or native request change
        recovery.accept(WebBackResult.Handled, leave)
        assertFalse(recovery.visible)
        assertTrue(mounted)
        assertEquals("unsent text", draft)
        recovery.accept(WebBackResult.Root, leave)
        assertFalse(mounted)
    }

    @Test fun dismissingRecoveryInvalidatesInFlightRetryWithoutLeaving() {
        val back = RemoteWebBack()
        val recovery = RemoteWebBackRecovery()
        var leaves = 0
        recovery.accept(WebBackResult.Recover) { leaves++ }
        val retry = back.begin(1, 1000)!!
        recovery.started()
        back.invalidate()
        recovery.dismiss()
        recovery.accept(back.complete(retry, 1, url, "\"root\"", 1001)) { leaves++ }
        assertEquals(0, leaves)
        assertFalse(recovery.visible)
        assertFalse(recovery.waiting)
    }

    @Test fun pausingRetryKeepsRecoveryActionAvailable() {
        val recovery = RemoteWebBackRecovery()
        recovery.accept(WebBackResult.Recover) { fail("unexpected exit") }
        recovery.started()
        recovery.paused()
        assertTrue(recovery.visible)
        assertFalse(recovery.waiting)
    }

    @Test fun onlyUserInitiatedMainFrameHttpLinksOpenExternally() {
        assertTrue(mayOpenExternalPage("https://example.com/path", true, true))
        assertFalse(mayOpenExternalPage("https://example.com/path", false, true))
        assertFalse(mayOpenExternalPage("https://example.com/path", true, false))
        listOf("intent://app", "javascript:alert(1)", "file:///private", "https://user:secret@example.com").forEach {
            assertFalse(mayOpenExternalPage(it, true, true))
        }
    }
}

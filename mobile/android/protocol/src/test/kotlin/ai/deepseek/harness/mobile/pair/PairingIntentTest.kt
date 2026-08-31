package ai.deepseek.harness.mobile.pair

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

class PairingIntentTest {
    private fun b64url(json: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))

    private val raw = b64url(
        """{"v":2,"serverId":"server-1","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"125.124.85.212:8411","useTls":false}}""",
    )
    private val url = "http://192.168.1.8:3180/#offer=$raw"

    @Test
    fun viewIntentWithPairingUrlYieldsTheLink() {
        val link = PairingIntent.fromViewIntent(PairingIntent.ACTION_VIEW, url)
        assertEquals(url, link?.url)
        assertEquals("server-1", link?.offer?.serverId)
    }

    @Test
    fun nonViewActionsNeverPair() {
        assertNull(PairingIntent.fromViewIntent("android.intent.action.MAIN", url))
        assertNull(PairingIntent.fromViewIntent(null, url))
    }

    @Test
    fun landingPageWithoutOfferFragmentIsNotAPairingLink() {
        assertNull(PairingIntent.fromViewIntent(PairingIntent.ACTION_VIEW, "http://192.168.1.8:3180/"))
        assertNull(PairingIntent.fromViewIntent(PairingIntent.ACTION_VIEW, null))
    }

    @Test
    fun wideHostMatchStillRejectsNonOfferGrammar() {
        // The manifest matches any http://*:3180 URL; the grammar gate here is
        // what keeps junk links from reaching the pairing WebView.
        assertNull(PairingIntent.fromViewIntent(PairingIntent.ACTION_VIEW, "javascript:alert(1)#offer=$raw"))
        assertNull(PairingIntent.fromViewIntent(PairingIntent.ACTION_VIEW, "http://user@192.168.1.8:3180/#offer=$raw"))
        assertNull(PairingIntent.fromViewIntent(PairingIntent.ACTION_VIEW, "http://192.168.1.8:3180/#offer=$raw&x=1"))
    }
}

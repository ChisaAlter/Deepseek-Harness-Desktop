package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.store.DeviceStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class DshViewModelTest {
    @Test
    fun rememberedSpaOpensForStickyReconnectAndClearsLegacyCredentials() {
        val store = FakeStore(webAppUrl = "http://192.168.1.8:3180/")

        val vm = DshViewModel(store)

        assertEquals(Route.Web, vm.route)
        assertEquals(DshViewModel.WEB_APP_URL, vm.webUrl)
        assertEquals(DshViewModel.WEB_APP_URL, store.webAppUrl)
        assertEquals(1, store.legacyClearCalls)
    }

    @Test
    fun v2PairingLoadsFullUrlButPersistsOnlyLandingPage() {
        val store = FakeStore()
        val vm = DshViewModel(store)
        val raw = Base64.getUrlEncoder().withoutPadding().encodeToString(
            """{"v":2,"serverId":"server-1","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"125.124.85.212:8411","useTls":false},"authBootstrap":{"version":1,"pairingToken":"one-time-token-123","expiresAtMs":1787817600000}}"""
                .toByteArray(),
        )
        val url = "http://192.168.1.8:3180/#offer=$raw"

        vm.pair(url)

        assertEquals(Route.Web, vm.route)
        assertEquals("${DshViewModel.WEB_APP_URL}#offer=$raw", vm.webUrl)
        assertEquals(DshViewModel.WEB_APP_URL, store.webAppUrl)
    }

    @Test
    fun pairRejectsBareOfferBecauseWebViewNeedsTheDesktopLandingUrl() {
        val store = FakeStore()
        val vm = DshViewModel(store)

        vm.pair("#offer=abc")

        assertEquals(Route.Connect, vm.route)
        assertTrue(vm.error.contains("完整"))
        assertEquals("", store.webAppUrl)
    }

    @Test
    fun viewIntentHandoffPairsExactlyLikeTheInAppScanner() {
        val store = FakeStore()
        val vm = DshViewModel(store)
        val raw = Base64.getUrlEncoder().withoutPadding().encodeToString(
            """{"v":2,"serverId":"server-1","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"125.124.85.212:8411","useTls":false}}"""
                .toByteArray(),
        )
        val url = "http://192.168.1.8:3180/#offer=$raw"

        vm.openPairingLink("android.intent.action.VIEW", url)

        assertEquals(Route.Web, vm.route)
        assertEquals("${DshViewModel.WEB_APP_URL}#offer=$raw", vm.webUrl)
    }

    @Test
    fun awayPublicSpaQrOpensBundledWebAppNotPublicOrigin() {
        val store = FakeStore()
        val vm = DshViewModel(store)
        val raw = Base64.getUrlEncoder().withoutPadding().encodeToString(
            """{"v":2,"serverId":"server-away","daemonPublicKeyB64":"daemon-key","relay":{"endpoint":"125.124.85.212:8411","useTls":false}}"""
                .toByteArray(),
        )
        val url = "http://125.124.85.212:3389/dshd/#offer=$raw"

        vm.pair(url)

        assertEquals(Route.Web, vm.route)
        assertEquals("${DshViewModel.WEB_APP_URL}#offer=$raw", vm.webUrl)
        assertTrue(!vm.webUrl.contains("125.124.85.212"))
        assertEquals(DshViewModel.WEB_APP_URL, store.webAppUrl)
    }

    @Test
    fun viewIntentWithoutOfferShowsAHintAndNeverLeavesAConnectedWebSession() {
        val store = FakeStore()
        val vm = DshViewModel(store)

        // Bare landing URL (no fragment): hint on the connect screen.
        vm.openPairingLink("android.intent.action.VIEW", "http://192.168.1.8:3180/")
        assertEquals(Route.Connect, vm.route)
        assertTrue(vm.error.contains("配对密钥"))

        // Already inside the WebView session: junk links must not yank the user out.
        val connected = DshViewModel(FakeStore(webAppUrl = "remembered"))
        assertEquals(Route.Web, connected.route)
        connected.openPairingLink("android.intent.action.VIEW", "http://192.168.1.8:3180/")
        assertEquals(Route.Web, connected.route)

        // Non-VIEW launches (e.g. plain LAUNCHER) never touch pairing state.
        val idle = DshViewModel(FakeStore())
        idle.openPairingLink("android.intent.action.MAIN", null)
        assertEquals("", idle.error)
        assertEquals(Route.Connect, idle.route)
    }

    private class FakeStore(
        override var webAppUrl: String = "",
        override var scheme: String = "system",
    ) : DeviceStore {
        var legacyClearCalls = 0

        override fun clearLegacyHttpCredentials() {
            legacyClearCalls += 1
        }
    }
}

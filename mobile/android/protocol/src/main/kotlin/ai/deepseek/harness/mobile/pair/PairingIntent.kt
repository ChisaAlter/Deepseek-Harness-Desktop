package ai.deepseek.harness.mobile.pair

/**
 * System-camera / browser handoff for the one-QR entry split: the manifest
 * claims `VIEW` on `http://<any host>:3180` (Android intent filters cannot match URI
 * fragments and the desktop's LAN IP is dynamic, so the match is
 * deliberately wide), which makes the system chooser offer
 * "App = link device / browser = web client". Everything that actually
 * matters is re-validated here through the same `parsePairingLink` grammar
 * the in-app scanner and paste box use — no second protocol.
 */
object PairingIntent {
    /** `android.content.Intent.ACTION_VIEW` without depending on the SDK. */
    const val ACTION_VIEW = "android.intent.action.VIEW"

    /**
     * Full pairing link from a VIEW intent, or null when the intent is not a
     * VIEW, carries no data, or the data is not a valid offer-v2 pairing URL
     * (e.g. the bare `:3180` landing page without a fragment).
     */
    fun fromViewIntent(action: String?, dataString: String?): PairingLink? {
        if (action != ACTION_VIEW) return null
        return OfferCodec.parsePairingLink(dataString)
    }
}

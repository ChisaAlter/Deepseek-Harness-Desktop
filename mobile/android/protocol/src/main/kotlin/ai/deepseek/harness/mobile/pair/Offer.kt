package ai.deepseek.harness.mobile.pair

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.util.Base64

data class RelayOffer(
    val endpoint: String,
    val useTls: Boolean,
)

data class AuthBootstrap(
    val version: Int,
    val pairingToken: String,
    val expiresAtMs: Long,
)

data class Offer(
    val v: Int,
    val serverId: String,
    val daemonPublicKeyB64: String,
    val relay: RelayOffer,
    val authBootstrap: AuthBootstrap?,
)

data class PairingLink(
    val url: String,
    val landingUrl: String,
    val offer: Offer,
)

object OfferCodec {
    const val VERSION = 2

    fun decode(raw: String?): Offer? {
        if (raw.isNullOrBlank()) return null
        return try {
            val padded = raw.replace('-', '+').replace('_', '/')
            val pad = (4 - padded.length % 4) % 4
            val bytes = Base64.getDecoder().decode(padded + "=".repeat(pad))
            val value = Json.parseToJsonElement(String(bytes, Charsets.UTF_8)).jsonObject
            val v = value["v"]?.jsonPrimitive?.intOrNull
            val serverId = value.string("serverId") ?: return null
            val daemonPublicKeyB64 = value.string("daemonPublicKeyB64") ?: return null
            val relayValue = value["relay"] as? JsonObject ?: return null
            val endpoint = relayValue.string("endpoint") ?: return null
            val useTlsValue = relayValue["useTls"]
            val useTls = useTlsValue?.jsonPrimitive?.booleanOrNull ?: false
            if (useTlsValue != null && useTlsValue.jsonPrimitive.booleanOrNull == null) return null
            val authBootstrap = value["authBootstrap"]?.let { element ->
                val auth = element as? JsonObject ?: return null
                val version = auth["version"]?.jsonPrimitive?.intOrNull
                val pairingToken = auth.string("pairingToken")
                val expiresAtMs = auth["expiresAtMs"]?.jsonPrimitive?.longOrNull
                if (
                    version != 1 ||
                    pairingToken == null ||
                    pairingToken.length !in 16..256 ||
                    expiresAtMs == null ||
                    expiresAtMs <= 0
                ) {
                    return null
                }
                AuthBootstrap(version, pairingToken, expiresAtMs)
            }
            if (v != VERSION) return null
            Offer(
                v = VERSION,
                serverId = serverId,
                daemonPublicKeyB64 = daemonPublicKeyB64,
                relay = RelayOffer(endpoint, useTls),
                authBootstrap = authBootstrap,
            )
        } catch (_: Exception) {
            null
        }
    }

    fun fromHash(hash: String?): Offer? {
        val match = Regex("(?:^|#|&)offer=([^&]+)").find(hash ?: "") ?: return null
        return decode(match.groupValues[1])
    }

    fun fromPaste(value: String?): Offer? {
        val text = value?.trim().orEmpty()
        if (text.isEmpty()) return null
        fromHash(if (text.startsWith("#")) text else "#$text")?.let { return it }
        return try {
            fromHash(URI(text).rawFragment?.let { "#$it" } ?: "")
        } catch (_: Exception) {
            null
        }
    }

    fun parsePairingLink(value: String?): PairingLink? {
        val text = value?.trim().orEmpty()
        if (text.isEmpty()) return null
        return try {
            val uri = URI(text)
            if (
                uri.scheme?.lowercase() !in setOf("http", "https") ||
                uri.host.isNullOrEmpty() ||
                uri.userInfo != null
            ) {
                return null
            }
            val rawFragment = uri.rawFragment ?: return null
            if (!rawFragment.matches(Regex("^offer=[A-Za-z0-9_-]+$"))) return null
            val offer = decode(rawFragment.removePrefix("offer=")) ?: return null
            PairingLink(
                url = text,
                landingUrl = text.substringBefore('#'),
                offer = offer,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun JsonObject.string(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }
}

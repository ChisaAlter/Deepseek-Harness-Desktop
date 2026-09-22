package ai.deepseek.harness.mobile.store

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class EncryptedDeviceStore(context: Context) : DeviceStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "dsh_remote_device",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override var webAppUrl: String
        get() = prefs.getString("webAppUrl", "").orEmpty()
        set(value) { prefs.edit().putString("webAppUrl", value).apply() }

    override var scheme: String
        get() = prefs.getString("scheme", "system").orEmpty().ifEmpty { "system" }
        set(value) { prefs.edit().putString("scheme", value).apply() }

    override fun clearLegacyHttpCredentials() {
        if (prefs.getBoolean("httpV1CredentialsCleared", false)) return
        prefs.edit()
            .remove("origin")
            .remove("deviceToken")
            .putBoolean("httpV1CredentialsCleared", true)
            .apply()
    }
}

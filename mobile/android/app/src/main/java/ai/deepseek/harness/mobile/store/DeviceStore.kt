package ai.deepseek.harness.mobile.store

interface DeviceStore {
    var webAppUrl: String
    var scheme: String
    fun clearLegacyHttpCredentials()
}

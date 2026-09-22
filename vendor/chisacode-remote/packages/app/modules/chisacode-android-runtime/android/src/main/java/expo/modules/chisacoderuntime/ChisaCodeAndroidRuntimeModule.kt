package expo.modules.chisacoderuntime

import android.app.ForegroundServiceStartNotAllowedException
import android.app.PendingIntent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

class ChisaCodeAndroidRuntimeModule : Module() {
    companion object {
        private const val TAG = "ChisaCodeRuntime"
        private const val NOTIFICATION_DATA_EXTRA = "chisacode.notification.data"
        private const val NOTIFICATION_RESPONSE_EVENT = "onNotificationResponse"
        private const val MAX_NOTIFICATION_ID_LENGTH = 512
    }

    private val alertIdCounter = AtomicInteger(ChisaCodeForegroundService.ALERT_NOTIFICATION_ID_BASE)
    private val notificationDataLock = Any()
    // Bounded latest-wins slot. A wake event is advisory; data remains until JavaScript drains it.
    private var pendingNotificationData: String? = null

    private fun canonicalNotificationData(data: String?): String? {
        if (data == null) return null
        return try {
            val parsed = JSONObject(data)
            val serverId = (parsed.get("serverId") as? String)?.trim() ?: return null
            val agentId = (parsed.get("agentId") as? String)?.trim() ?: return null
            if (
                serverId.isEmpty() || agentId.isEmpty() ||
                serverId.length > MAX_NOTIFICATION_ID_LENGTH || agentId.length > MAX_NOTIFICATION_ID_LENGTH
            ) {
                null
            } else {
                JSONObject().put("serverId", serverId).put("agentId", agentId).toString()
            }
        } catch (_: JSONException) {
            null
        }
    }

    private fun consumeNotificationData(intent: android.content.Intent): String? {
        return try {
            canonicalNotificationData(intent.extras?.get(NOTIFICATION_DATA_EXTRA) as? String)
        } catch (_: RuntimeException) {
            null
        } finally {
            intent.removeExtra(NOTIFICATION_DATA_EXTRA)
        }
    }

    override fun definition() = ModuleDefinition {
        Name("ChisaCodeAndroidRuntime")
        Events(NOTIFICATION_RESPONSE_EVENT)

        OnNewIntent { intent ->
            val stored = synchronized(notificationDataLock) {
                consumeNotificationData(intent)?.let { data ->
                    pendingNotificationData = data
                    true
                } ?: false
            }
            if (stored) {
                sendEvent(NOTIFICATION_RESPONSE_EVENT)
            }
        }

        AsyncFunction("startForegroundService") { text: String ->
            val context = appContext.reactContext
                ?: throw IllegalStateException("Android runtime context is unavailable")
            try {
                ChisaCodeForegroundService.ensureChannels(context)
                ChisaCodeForegroundService.start(context, text)
            } catch (error: RuntimeException) {
                if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    error is ForegroundServiceStartNotAllowedException
                ) {
                    Log.e(TAG, "Android disallowed foreground service start", error)
                } else if (error is SecurityException) {
                    Log.e(TAG, "Foreground service start lacks required permission", error)
                } else {
                    Log.e(TAG, "Foreground service start failed", error)
                }
                throw error
            }
        }

        AsyncFunction("updateForegroundServiceText") { text: String ->
            ChisaCodeForegroundService.update(appContext.reactContext!!, text)
        }

        AsyncFunction("stopForegroundService") {
            ChisaCodeForegroundService.stop(appContext.reactContext!!)
        }

        AsyncFunction("sendLocalNotification") { title: String, body: String, data: String? ->
            val context = appContext.reactContext
                ?: throw IllegalStateException("Android runtime context is unavailable")
            ChisaCodeForegroundService.ensureChannels(context)

            val notificationId = alertIdCounter.incrementAndGet()
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: throw IllegalStateException("App launch intent is unavailable")
            canonicalNotificationData(data)?.let { intent.putExtra(NOTIFICATION_DATA_EXTRA, it) }
            val pendingIntent = PendingIntent.getActivity(
                context, notificationId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val builder = NotificationCompat.Builder(context, ChisaCodeForegroundService.CHANNEL_ID_ALERTS)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(context.resources.getIdentifier("notification_icon", "drawable", context.packageName))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pendingIntent)

            if (intent.hasExtra(NOTIFICATION_DATA_EXTRA)) {
                builder.setCategory(NotificationCompat.CATEGORY_MESSAGE)
            }

            NotificationManagerCompat.from(context).notify(notificationId, builder.build())
        }

        AsyncFunction("consumeInitialNotificationData") {
            synchronized(notificationDataLock) {
                val pendingData = pendingNotificationData
                pendingNotificationData = null
                val coldLaunchData = appContext.currentActivity?.intent?.let { intent ->
                    consumeNotificationData(intent)
                }
                pendingData ?: coldLaunchData
            }
        }
    }
}

package expo.modules.chisacoderuntime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

class ChisaCodeForegroundService : Service() {

    companion object {
        const val CHANNEL_ID_RUNTIME = "chisacode.runtime"
        const val CHANNEL_ID_ALERTS = "chisacode.alerts"
        const val NOTIFICATION_ID = 1
        const val ALERT_NOTIFICATION_ID_BASE = 1000
        private const val TAG = "ChisaCodeRuntime"

        private var serviceText: String = "ChisaCode"

        fun start(context: Context, text: String) {
            serviceText = text
            val intent = Intent(context, ChisaCodeForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun update(context: Context, text: String) {
            serviceText = text
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, buildOngoingNotification(context, text))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ChisaCodeForegroundService::class.java))
        }

        fun ensureChannels(context: Context) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val runtimeChannel = NotificationChannel(
                CHANNEL_ID_RUNTIME,
                "Agent Runtime",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Ongoing notification while ChisaCode is running agents"
                setShowBadge(false)
            }
            manager.createNotificationChannel(runtimeChannel)

            val alertsChannel = NotificationChannel(
                CHANNEL_ID_ALERTS,
                "Agent Alerts",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Agent completion and error notifications"
            }
            manager.createNotificationChannel(alertsChannel)
        }

        fun buildOngoingNotification(context: Context, text: String): Notification {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pendingIntent = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            return NotificationCompat.Builder(context, CHANNEL_ID_RUNTIME)
                .setContentTitle("ChisaCode")
                .setContentText(text)
                .setSmallIcon(context.resources.getIdentifier("notification_icon", "drawable", context.packageName))
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pendingIntent)
                .build()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannels(this)
        val notification = buildOngoingNotification(this, serviceText)
        startForeground(NOTIFICATION_ID, notification)
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "Foreground service timed out (startId=$startId, type=$fgsType)")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}

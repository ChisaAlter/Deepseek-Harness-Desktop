package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.store.EncryptedDeviceStore
import ai.deepseek.harness.mobile.ui.DshRoot
import ai.deepseek.harness.mobile.ui.RemoteWebScreen
import ai.deepseek.harness.mobile.ui.ScanScreen
import ai.deepseek.harness.mobile.ui.theme.DshTheme
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.DisposableEffect
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

class MainActivity : ComponentActivity() {
    private val store by lazy { EncryptedDeviceStore(applicationContext) }
    private val vm: DshViewModel by viewModels { DshVmFactory(store) }
    private val fileChooser by lazy {
        WebFileChooser(this, { vm.webRequestId.takeIf { vm.route == Route.Web } }) {
            Toast.makeText(this, it, Toast.LENGTH_LONG).show()
        }
    }

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        vm.route = if (granted) Route.Scan else Route.Permission
    }

    private val webChromeClient = object : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: WebChromeClient.FileChooserParams,
        ): Boolean {
            fileChooser.show(webView, filePathCallback, fileChooserParams)
            return true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        // Cold-start entry from the system camera / a browser link
        // (VIEW http://*:3180). Runs before setContent so the first
        // composition already lands on the pairing WebView.
        if (savedInstanceState == null) {
            vm.openPairingLink(intent?.action, intent?.dataString)
        } else if (vm.route == Route.Web) {
            // A restored Activity must not replay a consumed one-time offer.
            vm.reopenWebApp()
        }
        if (intent?.action == Intent.ACTION_VIEW) intent.data = null
        setContent {
            val dark = when (vm.scheme) {
                "dark" -> true
                "light" -> false
                else -> isSystemInDarkTheme()
            }
            DisposableEffect(dark) {
                val insets = WindowCompat.getInsetsController(window, window.decorView)
                insets.isAppearanceLightStatusBars = !dark
                onDispose { }
            }
            DshTheme(dark) {
                when (vm.route) {
                    Route.Scan -> ScanScreen(
                        onFound = vm::onScanned,
                        onClose = { vm.route = Route.Connect },
                        onPaste = { vm.route = Route.Connect },
                    )
                    Route.Web -> RemoteWebScreen(
                        url = vm.webUrl,
                        requestId = vm.webRequestId,
                        getCurrentRequestId = { vm.webRequestId.takeIf { vm.route == Route.Web } },
                        chromeClient = webChromeClient,
                        onCancelFileChooser = fileChooser::cancel,
                        onLeave = vm::leaveWebApp,
                        onFatalLoadError = {
                            vm.error = it
                            vm.leaveWebApp()
                        },
                        onOpenExternal = {
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, it))
                            } catch (_: android.content.ActivityNotFoundException) {
                                Toast.makeText(this, "未找到可打开链接的应用", Toast.LENGTH_LONG).show()
                            } catch (_: SecurityException) {
                                Toast.makeText(this, "无法打开此链接", Toast.LENGTH_LONG).show()
                            }
                        },
                    )
                    else -> DshRoot(
                        vm = vm,
                        onRequestScan = ::requestScan,
                        onOpenAppSettings = {
                            startActivity(
                                Intent(
                                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", packageName, null),
                                ),
                            )
                        },
                    )
                }
            }
        }
    }

    // Warm entry: singleTask reroutes VIEW intents here instead of stacking
    // a second activity.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        fileChooser.cancel()
        setIntent(intent)
        vm.openPairingLink(intent.action, intent.dataString)
        if (intent.action == Intent.ACTION_VIEW) intent.data = null
    }

    private fun requestScan() {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) vm.route = Route.Scan else cameraPermission.launch(Manifest.permission.CAMERA)
    }

    override fun onDestroy() {
        fileChooser.cancel()
        super.onDestroy()
    }
}

class DshVmFactory(private val store: EncryptedDeviceStore) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = DshViewModel(store) as T
}

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
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        vm.route = if (granted) Route.Scan else Route.Permission
    }

    private val filePicker = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        fileChooserCallback?.onReceiveValue(uris.toTypedArray())
        fileChooserCallback = null
    }

    private val webChromeClient = object : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: WebChromeClient.FileChooserParams,
        ): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback
            val accepted = fileChooserParams.acceptTypes
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .toTypedArray()
                .ifEmpty { arrayOf("image/*") }
            filePicker.launch(accepted)
            return true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        // Cold-start entry from the system camera / a browser link
        // (VIEW http://*:3180). Runs before setContent so the first
        // composition already lands on the pairing WebView.
        vm.openPairingLink(intent?.action, intent?.dataString)
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
                    )
                    Route.Web -> RemoteWebScreen(
                        url = vm.webUrl,
                        chromeClient = webChromeClient,
                        onLeave = vm::leaveWebApp,
                        onLoadError = {
                            vm.error = it
                            vm.leaveWebApp()
                        },
                        onOpenExternal = {
                            startActivity(Intent(Intent.ACTION_VIEW, it))
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
        setIntent(intent)
        vm.openPairingLink(intent.action, intent.dataString)
    }

    private fun requestScan() {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) vm.route = Route.Scan else cameraPermission.launch(Manifest.permission.CAMERA)
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        super.onDestroy()
    }
}

class DshVmFactory(private val store: EncryptedDeviceStore) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = DshViewModel(store) as T
}

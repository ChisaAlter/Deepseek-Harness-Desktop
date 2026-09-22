package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.isTrustedAssetPage
import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

class WebCaptureProvider : FileProvider()

/** System activities are registered per request so an old result cannot complete a replacement. */
internal class WebFileChooser(
    private val activity: ComponentActivity,
    private val currentRequest: () -> Long?,
    private val onError: (String) -> Unit,
) {
    private var pending: Selection? = null

    fun cancel() {
        pending?.finish(null)
    }

    fun show(view: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams) {
        cancel()
        val requestId = currentRequest()
        if (requestId == null || !isTrustedAssetPage(view.url)) {
            callback.onReceiveValue(null)
            return
        }
        val selection = Selection(view, requestId, callback, WebFileSelection.from(
            params.acceptTypes.toList(), params.isCaptureEnabled, params.mode,
        ))
        pending = selection
        selection.start()
    }

    private inner class Selection(
        private val view: WebView,
        private val requestId: Long,
        callback: ValueCallback<Array<Uri>>,
        private val plan: WebFileSelection,
    ) {
        private val key = "web-file-${UUID.randomUUID()}"
        private var resultLauncher: ActivityResultLauncher<Intent>? = null
        private var permissionLauncher: ActivityResultLauncher<String>? = null
        private var validationJob: Job? = null
        private var captureFile: File? = null
        private var captureUri: Uri? = null
        private val request = WebFileRequest<Array<Uri>>(callback::onReceiveValue) { success ->
            validationJob?.cancel()
            resultLauncher?.unregister()
            permissionLauncher?.unregister()
            captureUri?.let { runCatching { activity.revokeUriPermission(it, URI_FLAGS) } }
            if (!success) captureFile?.delete()
        }

        private fun isCurrent() = !request.completed && pending === this &&
            currentRequest() == requestId && isTrustedAssetPage(view.url)

        fun finish(value: Array<Uri>?) {
            if (pending === this) pending = null
            runCatching { request.complete(value) }
        }

        private fun fail(message: String) {
            val report = isCurrent()
            finish(null)
            if (report) onError(message)
        }

        fun start() {
            if (!isCurrent()) return finish(null)
            when (plan.source) {
                WebFileSource.Unsupported -> fail("不支持此附件来源或文件类型，请选择图片文件")
                WebFileSource.Documents -> launchDocuments()
                WebFileSource.Camera -> {
                    if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        launchCamera()
                    } else {
                        permissionLauncher = activity.activityResultRegistry.register(
                            "$key-permission", ActivityResultContracts.RequestPermission(),
                        ) { granted ->
                            if (!isCurrent()) finish(null)
                            else if (granted) launchCamera()
                            else fail("未授予相机权限，仍可从相册选择图片")
                        }
                        try {
                            permissionLauncher?.launch(Manifest.permission.CAMERA)
                        } catch (_: Exception) {
                            fail("无法请求相机权限，请从相册选择图片")
                        }
                    }
                }
            }
        }

        private fun launchDocuments() {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = plan.types.singleOrNull() ?: "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, plan.types.toTypedArray())
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, plan.multiple)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            launch(intent) { data ->
                val uris = buildList<Uri?> {
                    data?.data?.let(::add)
                    data?.clipData?.let { clip ->
                        for (index in 0 until clip.itemCount) add(clip.getItemAt(index).uri)
                    }
                }
                val selected = selectWebDocuments(uris, plan.multiple)
                if (selected.isEmpty()) {
                    finish(null)
                } else {
                    validationJob = activity.lifecycleScope.launch {
                        val readable = withContext(Dispatchers.IO) { selected.all(::isReadableDocument) }
                        if (!isCurrent()) finish(null)
                        else if (readable) finish(selected.toTypedArray())
                        else fail("无法读取所选文件，请重新选择")
                    }
                }
            }
        }

        private fun isReadableDocument(uri: Uri): Boolean = runCatching {
            // Never forward file:// or a picker-supplied URI into our own private provider.
            if (!isSelectableDocumentUri(uri.toString(), "${activity.packageName}.web-capture")) return false
            val provider = activity.packageManager.resolveContentProvider(uri.authority!!, 0)
            if (provider?.applicationInfo?.uid == activity.applicationInfo.uid) return false
            val mime = activity.contentResolver.getType(uri)
            if (!plan.types.any { it == "*/*" || it == mime || (it.endsWith("/*") && mime?.startsWith(it.removeSuffix("*")) == true) }) return false
            activity.contentResolver.openAssetFileDescriptor(uri, "r")?.use { true } ?: false
        }.getOrDefault(false)

        private fun launchCamera() {
            if (!isCurrent()) return finish(null)
            try {
                val directory = File(activity.cacheDir, "web-capture").apply { mkdirs() }
                // Successful captures must remain readable while the SPA uploads them.
                directory.listFiles()?.filter { it.isFile && it.lastModified() < System.currentTimeMillis() - 86_400_000L }
                    ?.forEach { it.delete() }
                val file = File.createTempFile("image-", ".jpg", directory)
                captureFile = file
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.web-capture", file)
                captureUri = uri
                launch(Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    clipData = ClipData.newRawUri("capture", uri)
                    addFlags(URI_FLAGS)
                }) {
                    if (file.length() > 0L) finish(arrayOf(uri))
                    else fail("未取得照片，请重试或从相册选择")
                }
            } catch (_: Exception) {
                fail("无法打开相机，请从相册选择图片")
            }
        }

        private fun launch(intent: Intent, receive: (Intent?) -> Unit) {
            resultLauncher = activity.activityResultRegistry.register(
                key, ActivityResultContracts.StartActivityForResult(),
            ) { result ->
                try {
                    if (!isCurrent() || result.resultCode != Activity.RESULT_OK) finish(null)
                    else receive(result.data)
                } catch (_: Exception) {
                    fail("无法读取附件来源返回的文件，请重新选择")
                }
            }
            try {
                resultLauncher?.launch(intent)
            } catch (_: Exception) {
                fail("无法打开附件来源，请重试或选择其他来源")
            }
        }
    }

    companion object {
        private const val URI_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    }
}

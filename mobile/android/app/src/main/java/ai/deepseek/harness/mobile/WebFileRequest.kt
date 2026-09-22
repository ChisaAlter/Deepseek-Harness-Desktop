package ai.deepseek.harness.mobile

import java.net.URI

internal fun <T : Any> selectWebDocuments(candidates: List<T?>, multiple: Boolean): List<T> {
    val selected = candidates.map { requireNotNull(it) { "Missing document URI" } }.distinct()
    return if (multiple) selected else selected.take(1)
}

internal fun isSelectableDocumentUri(value: String, privateAuthority: String): Boolean = runCatching {
    val uri = URI(value)
    uri.scheme == "content" && !uri.authority.isNullOrBlank() &&
        !uri.authority.contains('@') && !uri.authority.equals(privateAuthority, ignoreCase = true)
}.getOrDefault(false)

internal enum class WebFileSource { Documents, Camera, Unsupported }

internal data class WebFileSelection(val source: WebFileSource, val types: List<String>, val multiple: Boolean) {
    companion object {
        fun from(acceptTypes: List<String>, capture: Boolean, mode: Int): WebFileSelection {
            val types = acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }
                .filter { it.isNotEmpty() }.map {
                    when (it) {
                        ".jpg", ".jpeg" -> "image/jpeg"
                        ".png" -> "image/png"
                        ".gif" -> "image/gif"
                        ".webp" -> "image/webp"
                        else -> it
                    }
                }.distinct().ifEmpty { listOf("*/*") }
            val supported = mode == 0 || mode == 1 // FileChooserParams MODE_OPEN / MODE_OPEN_MULTIPLE
            val source = when {
                !supported -> WebFileSource.Unsupported
                capture && types.any { it == "image/*" || it == "image/jpeg" } -> WebFileSource.Camera
                capture -> WebFileSource.Unsupported
                else -> WebFileSource.Documents
            }
            return WebFileSelection(source, types, mode == 1)
        }
    }
}

/** Clears ownership before invoking user code, including reentrant cancellation. */
internal class WebFileRequest<T>(private val callback: (T?) -> Unit, private val cleanup: (Boolean) -> Unit) {
    var completed: Boolean = false
        private set

    fun complete(value: T?) {
        if (completed) return
        completed = true
        var delivered = false
        try {
            callback(value)
            delivered = value != null
        } finally {
            cleanup(delivered)
        }
    }
}

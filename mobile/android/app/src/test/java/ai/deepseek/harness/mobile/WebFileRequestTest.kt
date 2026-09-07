package ai.deepseek.harness.mobile

import org.junit.Assert.*
import org.junit.Test

class WebFileRequestTest {
    @Test fun captureAndGalleryAreDistinctAndRespectMultiplicity() {
        assertEquals(WebFileSource.Camera, WebFileSelection.from(listOf("image/*"), true, 0).source)
        assertEquals(WebFileSource.Camera, WebFileSelection.from(listOf(".jpeg"), true, 0).source)
        val gallery = WebFileSelection.from(listOf("image/png, image/jpeg", ""), false, 1)
        assertEquals(WebFileSource.Documents, gallery.source)
        assertEquals(listOf("image/png", "image/jpeg"), gallery.types)
        assertTrue(gallery.multiple)
        assertFalse(WebFileSelection.from(listOf("image/*"), false, 0).multiple)
    }

    @Test fun unsupportedCaptureAndSaveDoNotPretendToOpenCamera() {
        assertEquals(WebFileSource.Unsupported, WebFileSelection.from(listOf("video/*"), true, 0).source)
        assertEquals(WebFileSource.Unsupported, WebFileSelection.from(listOf("image/png"), true, 0).source)
        assertEquals(WebFileSource.Unsupported, WebFileSelection.from(listOf("image/*"), false, 3).source)
        assertEquals(listOf("*/*"), WebFileSelection.from(emptyList(), false, 0).types)
    }

    @Test fun cancelledReplacedOrDestroyedRequestsCompleteExactlyOnce() {
        val oldValues = mutableListOf<String?>()
        val newValues = mutableListOf<String?>()
        val cleanups = mutableListOf<Boolean>()
        val old = WebFileRequest<String>({ oldValues.add(it) }, { cleanups.add(it) })
        old.complete(null) // replacement cancels the previous callback
        val replacement = WebFileRequest<String>({ newValues.add(it) }, { cleanups.add(it) })
        old.complete("late old result")
        old.complete(null) // destruction after cancellation
        replacement.complete("new image")
        replacement.complete(null)
        assertEquals(listOf<String?>(null), oldValues)
        assertEquals(listOf("new image"), newValues)
        assertEquals(listOf(false, true), cleanups)
    }

    @Test fun reentrantCallbackCannotReceiveOrCleanUpTwice() {
        var calls = 0
        var cleanups = 0
        lateinit var request: WebFileRequest<String>
        request = WebFileRequest({ calls++; request.complete(null) }, { cleanups++ })
        request.complete("image")
        assertEquals(1, calls)
        assertEquals(1, cleanups)
    }

    @Test fun cleanupStillRunsWhenReceiverThrows() {
        var cleanups = 0
        val request = WebFileRequest<String>({ error("receiver destroyed") }, { cleanups++ })
        runCatching { request.complete(null) }
        request.complete(null)
        assertTrue(request.completed)
        assertEquals(1, cleanups)
    }

    @Test fun failedDeliveryDoesNotRetainCapturedFileAsSuccess() {
        val retained = mutableListOf<Boolean>()
        val request = WebFileRequest<String>({ error("receiver destroyed") }, { retained.add(it) })
        runCatching { request.complete("capture") }
        request.complete(null)
        assertEquals(listOf(false), retained)
    }

    @Test fun malformedPickerItemsAreRejectedInsteadOfBecomingNullUris() {
        assertThrows(IllegalArgumentException::class.java) { selectWebDocuments(listOf("one", null), true) }
        assertEquals(listOf("one"), selectWebDocuments(listOf("one", "one", "two"), false))
        assertEquals(listOf("one", "two"), selectWebDocuments(listOf("one", "one", "two"), true))
    }

    @Test fun pickerCannotReturnPrivateOrNonContentUris() {
        val privateAuthority = "ai.deepseek.harness.mobile.web-capture"
        assertTrue(isSelectableDocumentUri("content://media/external/images/1", privateAuthority))
        listOf("file:///data/private", "https://example.com/image", "content:///image",
            "content://$privateAuthority/capture/image.jpg", "content://10@media/image",
            "content://10%40media/image", "content://ai.deepseek.harness.mobile.%77eb-capture/capture/image.jpg",
            "content://AI.DEEPSEEK.HARNESS.MOBILE.WEB-CAPTURE/capture/image.jpg").forEach {
            assertFalse(isSelectableDocumentUri(it, privateAuthority))
        }
    }
}

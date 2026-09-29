package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.NativeChatState
import org.junit.Assert.*
import org.junit.Test

class NativeChatStateTest {
    @Test fun parsesOnlyPresentationFields() {
        val state = NativeChatState.parse("""
            {"seq":1,"epoch":"doc-1","route":"chat","connected":true,"sessionId":"s1","title":"Test",
             "deviceSecret":"must-not-cross","sessions":[{"id":"s1","title":"Test","workspace":"Project","running":true,"readOnly":false}],
             "rows":[{"id":"m1","role":"assistant","text":"hello","running":true,"rawCredential":"hidden"}],
             "approval":{"id":"a1","title":"Run?","command":"git status","actions":[{"id":"yes","label":"允许一次"}]}}
        """.trimIndent())!!
        assertTrue(state.connected)
        assertEquals("doc-1", state.epoch)
        assertEquals("Test", state.sessions.single().title)
        assertEquals("hello", state.rows.single().text)
        assertEquals("yes", state.approval!!.actions.single().id)
        assertFalse(state.toString().contains("must-not-cross"))
        assertFalse(state.toString().contains("hidden"))
    }

    @Test fun invalidAndOversizedMessagesCannotBecomeNativeState() {
        assertNull(NativeChatState.parse("{}"))
        assertNull(NativeChatState.parse("{\"seq\":1,\"route\":\"external\",\"connected\":true}"))
        assertNull(NativeChatState.parse("{\"route\":\"chat\",\"connected\":true}"))
        assertNull(NativeChatState.parse("{\"seq\":1,\"route\":\"chat\",\"connected\":true}"))
        assertNull(NativeChatState.parse("x".repeat(1_500_001)))
    }

    @Test fun boundsRowsAndText() {
        val state = NativeChatState.parse("""{"seq":1,"epoch":"doc-1","route":"chat","rows":[{"id":"1","role":"assistant","text":"${"a".repeat(33_000)}"}]}""")!!
        assertEquals(32_000, state.rows.single().text.length)
    }
}

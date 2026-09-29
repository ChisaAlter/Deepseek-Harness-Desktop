package ai.deepseek.harness.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.deepseek.harness.mobile.ui.theme.dsh

/** The paired Android conversation is Compose; WebView remains a transport, not its UI. */
@Composable
internal fun NativeChatScreen(
    state: NativeChatState,
    drafts: MutableMap<String, String>,
    submitted: MutableMap<String, NativeSubmittedDraft>,
    onAction: (JSONObjectAction) -> Unit,
    onLegacyPage: () -> Unit,
    onLeave: () -> Unit,
) {
    val colors = dsh()
    var sessionsOpen by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf("") }
    var selectedModel by remember { mutableStateOf<NativeModelOption?>(null) }
    val sessionId = state.sessionId
    val draft = drafts[sessionId] ?: state.draft
    val keyboard = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    val imeVisible = WindowInsets.ime.getBottom(density) > 0

    LaunchedEffect(sessionId, state.seq, state.draft, submitted[sessionId]) {
        if (sessionId.isNotBlank()) {
            val sent = submitted[sessionId]
            if (sent != null && state.seq > sent.afterSeq) {
                if (state.draft == sent.text && !sent.seenInWeb) {
                    submitted[sessionId] = sent.copy(seenInWeb = true)
                } else if (state.draft.isEmpty() && sent.seenInWeb) {
                    if (drafts[sessionId] == sent.text) drafts[sessionId] = ""
                    submitted.remove(sessionId)
                }
            }
            if (!drafts.containsKey(sessionId)) {
                drafts[sessionId] = state.draft
            }
        }
    }
    BackHandler {
        when {
            imeVisible -> keyboard?.hide()
            picker.isNotBlank() -> {
                if (selectedModel != null) selectedModel = null else picker = ""
            }
            sessionsOpen -> sessionsOpen = false
            else -> onLeave()
        }
    }

    Column(Modifier.fillMaxSize().background(colors.sidebarFill).imePadding()) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).background(colors.bgLayer1).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            NativeRoundButton("☰", "会话列表", { picker = ""; sessionsOpen = !sessionsOpen })
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (sessionsOpen) "会话" else state.title, color = colors.labelPrimary,
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
                if (!sessionsOpen && state.hostName.isNotBlank()) {
                    Text(state.hostName, color = colors.labelTertiary, fontSize = 12.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            NativeRoundButton("＋", "新会话", {
                sessionsOpen = false
                onAction(JSONObjectAction("new"))
            })
        }

        if (sessionsOpen) {
            if (state.sessions.isEmpty()) {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Text(if (state.connected) "还没有会话" else "等待电脑连接…", color = colors.labelSecondary)
                }
            } else {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
                    items(state.sessions, key = { it.id }) { session ->
                        Surface(
                            onClick = {
                                sessionsOpen = false
                                onAction(JSONObjectAction("open", session.id))
                            },
                            shape = RoundedCornerShape(14.dp),
                            color = if (session.id == sessionId) colors.navActive else colors.bgLayer1,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp).heightIn(min = 54.dp),
                        ) {
                            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (session.running) {
                                    Box(Modifier.size(7.dp).background(colors.success, CircleShape))
                                    Spacer(Modifier.width(10.dp))
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(session.title, fontSize = 15.sp, color = colors.labelPrimary,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (session.workspace.isNotBlank() || session.readOnly) {
                                        Text(if (session.readOnly) "只读 · ${session.workspace}" else session.workspace,
                                            fontSize = 12.sp, color = colors.labelTertiary, maxLines = 1,
                                            overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Surface(onClick = onLegacyPage, color = colors.bgLayer1,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Text("打开旧版工作页 · Git／文件／设置", fontSize = 13.sp, color = colors.labelSecondary)
                }
            }
        } else {
            if (state.banner.isNotBlank() || state.offline || state.error.isNotBlank()) {
                val message = state.error.ifBlank { state.banner.ifBlank { "连接已断开，草稿已保留" } }
                Row(Modifier.fillMaxWidth().background(colors.warnTertiary).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(message, Modifier.weight(1f), color = colors.labelPrimary, fontSize = 13.sp)
                    if (state.offline || state.error.isNotBlank()) {
                        Text("重试", Modifier.clickable {
                            onAction(JSONObjectAction(if (state.error.isNotBlank() && sessionId.isNotBlank()) "retry" else "refresh", sessionId))
                        }.padding(8.dp), color = colors.buttonInfoFill, fontSize = 13.sp)
                    }
                }
            }
            val listState = remember(sessionId) { LazyListState() }
            var initialTimelineShown by remember(sessionId) { mutableStateOf(false) }
            LaunchedEffect(sessionId, state.loading, state.rows.size, state.rows.lastOrNull()?.text) {
                if (!state.olderLoading && state.rows.isNotEmpty()) {
                    val bottom = state.rows.lastIndex + if (state.hasOlder) 1 else 0
                    if (!initialTimelineShown && !state.loading) {
                        // A newly opened conversation starts at its latest answer.
                        listState.scrollToItem(bottom)
                        initialTimelineShown = true
                    } else if (initialTimelineShown &&
                        listState.firstVisibleItemIndex >= (state.rows.size - 5).coerceAtLeast(0)) {
                        // A streaming answer follows only while the reader is at the tail.
                        listState.scrollToItem(bottom)
                    }
                }
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.hasOlder) item(key = "older") {
                    Text(if (state.olderLoading) "正在加载…" else "加载更早消息",
                        Modifier.fillMaxWidth().clickable(enabled = !state.olderLoading) {
                            onAction(JSONObjectAction("older", sessionId))
                        }.padding(14.dp), color = colors.labelSecondary, fontSize = 13.sp)
                }
                if (state.loading && state.rows.isEmpty()) item(key = "loading") {
                    Text("正在载入会话…", color = colors.labelSecondary, fontSize = 14.sp)
                }
                if (!state.loading && state.rows.isEmpty() && state.error.isEmpty()) item(key = "empty") {
                    Box(Modifier.fillMaxWidth().height(240.dp), contentAlignment = Alignment.Center) {
                        Text("从这里开始对话", fontSize = 17.sp, color = colors.labelSecondary)
                    }
                }
                items(state.rows, key = { it.id }) { row -> NativeMessage(row) }
            }

            val approval = state.approval
            if (picker.isNotBlank() && approval == null && state.readOnly.isBlank()) {
                Surface(shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                    color = colors.bgLayer1, border = BorderStroke(1.dp, colors.borderL2),
                    modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (selectedModel != null) "思考强度" else if (picker == "model") "选择模型" else "权限",
                                Modifier.weight(1f), color = colors.labelPrimary, fontSize = 17.sp,
                                fontWeight = FontWeight.SemiBold)
                            NativeRoundButton("×", "关闭选择", { picker = ""; selectedModel = null })
                        }
                        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 350.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            val chosen = selectedModel
                            if (picker == "model" && chosen != null) {
                                items(chosen.efforts, key = { it.id }) { effort ->
                                    NativePickerRow(effort.label, effort.id == state.modelCurrentEffort) {
                                        onAction(JSONObjectAction("model", sessionId, provider = chosen.provider,
                                            model = chosen.id, reasoningEffort = effort.id))
                                        picker = ""; selectedModel = null
                                    }
                                }
                            } else if (picker == "model") {
                                items(state.modelOptions, key = { "${it.provider}:${it.id}" }) { model ->
                                    NativePickerRow(model.label, model.provider == state.modelCurrentProvider &&
                                        model.id == state.modelCurrentId) {
                                        if (model.efforts.isNotEmpty()) selectedModel = model
                                        else {
                                            onAction(JSONObjectAction("model", sessionId, provider = model.provider,
                                                model = model.id))
                                            picker = ""
                                        }
                                    }
                                }
                            } else {
                                items(state.permissionOptions, key = { it.id }) { option ->
                                    NativePickerRow(option.label, option.id == state.permissionCurrent) {
                                        onAction(JSONObjectAction("permission", sessionId, id = option.id))
                                        picker = ""
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (approval != null) {
                Surface(shape = RoundedCornerShape(20.dp), color = colors.bgLayer1,
                    border = BorderStroke(1.dp, colors.borderL2),
                    modifier = Modifier.fillMaxWidth().padding(10.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(approval.title.ifBlank { "需要审批" }, fontWeight = FontWeight.SemiBold,
                            color = colors.labelPrimary)
                        if (approval.command.isNotBlank()) Text(approval.command, fontSize = 13.sp,
                            color = colors.labelSecondary, maxLines = 5, overflow = TextOverflow.Ellipsis)
                        if (approval.error.isNotBlank()) Text(approval.error, fontSize = 13.sp, color = colors.error)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            approval.actions.forEach { action ->
                                Surface(onClick = {
                                    onAction(JSONObjectAction("approve", sessionId, approvalId = approval.id,
                                        actionId = action.id))
                                }, shape = RoundedCornerShape(16.dp), color = colors.navHover,
                                    modifier = Modifier.heightIn(min = 48.dp)) {
                                    Box(Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                                        Text(action.label, fontSize = 14.sp, color = colors.labelPrimary)
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (state.readOnly.isNotBlank()) {
                Text(state.readOnly, Modifier.fillMaxWidth().padding(16.dp),
                    color = colors.labelSecondary, fontSize = 13.sp)
            } else {
                Surface(shape = RoundedCornerShape(20.dp), color = colors.bgLayer1,
                    border = BorderStroke(1.dp, colors.borderL2),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp)
                        .shadow(2.dp, RoundedCornerShape(20.dp))) {
                    Column(Modifier.padding(start = 14.dp, end = 8.dp, top = 12.dp, bottom = 7.dp)) {
                        BasicTextField(
                            value = draft,
                            onValueChange = { value ->
                                drafts[sessionId] = value
                                if (sessionId.isNotBlank()) onAction(JSONObjectAction("draft", sessionId, text = value))
                            },
                            enabled = sessionId.isNotBlank(),
                            textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.labelPrimary, fontSize = 16.sp,
                                lineHeight = 24.sp),
                            cursorBrush = SolidColor(colors.buttonInfoFill),
                            keyboardOptions = KeyboardOptions.Default,
                            minLines = 2,
                            maxLines = 6,
                            decorationBox = { inner ->
                                Box {
                                    if (draft.isEmpty()) Text("给电脑发送消息…", fontSize = 16.sp,
                                        color = colors.labelTertiary)
                                    inner()
                                }
                            },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp, max = 156.dp),
                        )
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Surface(onClick = { keyboard?.hide(); picker = "model" },
                                enabled = sessionId.isNotBlank() && state.modelOptions.isNotEmpty() && !state.offline,
                                shape = RoundedCornerShape(16.dp), color = colors.navHover,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                Box(Modifier.padding(horizontal = 10.dp), contentAlignment = Alignment.CenterStart) {
                                    Text(state.model.ifBlank { "选择模型" }, color = colors.labelSecondary,
                                        fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            if (state.planOn) NativeRoundButton("P", "关闭 Plan", {
                                onAction(JSONObjectAction("planOff", sessionId))
                            })
                            NativeRoundButton("◇", "切换权限：${state.permission}", {
                                keyboard?.hide(); picker = "permission"
                            }, enabled = sessionId.isNotBlank() && state.permissionOptions.isNotEmpty() && !state.offline)
                            if (state.running) NativeRoundButton("■", "停止生成", {
                                onAction(JSONObjectAction("cancel", sessionId))
                            }, filled = true)
                            NativeRoundButton("↑", "发送消息", {
                                val text = drafts[sessionId] ?: state.draft
                                submitted[sessionId] = NativeSubmittedDraft(
                                    text = text, afterSeq = state.seq,
                                    // Require the post-action Web snapshot before treating an
                                    // empty draft as send acknowledgement; an older empty
                                    // snapshot may still be queued when the button is tapped.
                                    seenInWeb = false,
                                )
                                onAction(JSONObjectAction("send", sessionId, text = text))
                            }, enabled = draft.isNotBlank() && sessionId.isNotBlank() && !state.offline,
                                filled = true)
                        }
                    }
                }
            }
        }
    }
}

internal data class NativeSubmittedDraft(
    val text: String,
    val afterSeq: Long,
    val seenInWeb: Boolean,
)

/** A typed action prevents arbitrary JavaScript from being assembled by UI controls. */
internal data class JSONObjectAction(
    val type: String,
    val sessionId: String = "",
    val text: String = "",
    val approvalId: String = "",
    val actionId: String = "",
    val provider: String = "",
    val model: String = "",
    val reasoningEffort: String = "",
    val id: String = "",
    val line: String = "",
)

@Composable
private fun NativePickerRow(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = dsh()
    Surface(onClick = onClick, shape = RoundedCornerShape(14.dp),
        color = if (selected) colors.navActive else colors.bgModule,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = colors.labelPrimary, fontSize = 14.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (selected) Text("✓", color = colors.buttonInfoFill)
        }
    }
}

@Composable
private fun NativeMessage(row: NativeRow) {
    val colors = dsh()
    val user = row.role == "user"
    val background = when {
        user -> colors.bubble
        row.role == "error" -> colors.warnTertiary
        else -> colors.bgLayer1
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
        if (row.role !in setOf("user", "assistant")) {
            Text(when (row.role) { "tool" -> "工具"; "error" -> "运行失败"; else -> "过程" },
                Modifier.padding(start = 8.dp, bottom = 3.dp), color = colors.labelTertiary, fontSize = 12.sp)
        }
        Surface(shape = RoundedCornerShape(16.dp), color = background,
            border = if (user) null else BorderStroke(1.dp, colors.borderHair)) {
            Text(row.text.ifBlank { if (row.running) "正在思考…" else " " },
                Modifier.padding(horizontal = 13.dp, vertical = 10.dp), color = colors.labelPrimary,
                fontSize = 15.sp, lineHeight = 22.sp)
        }
    }
}

@Composable
private fun NativeRoundButton(label: String, description: String, onClick: () -> Unit,
    enabled: Boolean = true, filled: Boolean = false) {
    val colors = dsh()
    Box(Modifier.size(48.dp).clickable(enabled = enabled, onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center) {
        Box(Modifier.size(32.dp).background(
            if (filled && enabled) colors.buttonPrimaryFill else colors.navHover, CircleShape),
            contentAlignment = Alignment.Center) {
            Text(label, fontSize = 18.sp, color = if (filled && enabled) colors.labelPrimaryForeground
                else if (enabled) colors.labelPrimary else colors.labelCaption)
        }
    }
}

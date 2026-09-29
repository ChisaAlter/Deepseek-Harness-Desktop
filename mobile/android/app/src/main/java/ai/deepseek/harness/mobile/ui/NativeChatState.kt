package ai.deepseek.harness.mobile.ui

import org.json.JSONObject

internal data class NativeSession(
    val id: String,
    val title: String,
    val workspace: String,
    val running: Boolean,
    val readOnly: Boolean,
)

internal data class NativeRow(
    val id: String,
    val role: String,
    val text: String,
    val running: Boolean,
)

internal data class NativeApprovalAction(val id: String, val label: String)
internal data class NativeModelEffort(val id: String, val label: String)
internal data class NativeModelOption(
    val provider: String,
    val id: String,
    val label: String,
    val efforts: List<NativeModelEffort>,
)
internal data class NativePermissionOption(val id: String, val label: String)
internal data class NativeApproval(
    val id: String,
    val title: String,
    val command: String,
    val error: String,
    val actions: List<NativeApprovalAction>,
)

/** A presentation-only projection. Never deserialize the paired client or its secret. */
internal data class NativeChatState(
    val seq: Long = 0,
    val epoch: String = "",
    val route: String = "connect",
    val connected: Boolean = false,
    val hostName: String = "",
    val connLabel: String = "",
    val sessions: List<NativeSession> = emptyList(),
    val sessionId: String = "",
    val title: String = "新会话",
    val rows: List<NativeRow> = emptyList(),
    val loading: Boolean = false,
    val error: String = "",
    val hasOlder: Boolean = false,
    val olderLoading: Boolean = false,
    val running: Boolean = false,
    val readOnly: String = "",
    val approval: NativeApproval? = null,
    val model: String = "",
    val modelOptions: List<NativeModelOption> = emptyList(),
    val modelCurrentProvider: String = "",
    val modelCurrentId: String = "",
    val modelCurrentEffort: String = "",
    val permission: String = "",
    val permissionCurrent: String = "",
    val permissionOptions: List<NativePermissionOption> = emptyList(),
    val planOn: Boolean = false,
    val offline: Boolean = false,
    val banner: String = "",
    val draft: String = "",
) {
    companion object {
        /** Bound untrusted WebView messages before they enter Compose state. */
        fun parse(raw: String): NativeChatState? = runCatching {
            if (raw.length > 1_500_000) return null
            val json = JSONObject(raw)
            if (json.optString("route") !in setOf("connect", "scan", "permission", "chat")) return null
            if (json.optLong("seq") <= 0) return null
            val epoch = json.safeText("epoch", 64)
            if (epoch.isBlank()) return null
            val sessions = json.optJSONArray("sessions")
            val rows = json.optJSONArray("rows")
            val approval = json.optJSONObject("approval")
            val models = json.optJSONArray("modelOptions")
            val permissions = json.optJSONArray("permissionOptions")
            val modelCurrent = json.optJSONObject("modelCurrent")
            NativeChatState(
                seq = json.optLong("seq"),
                epoch = epoch,
                route = json.optString("route"),
                connected = json.optBoolean("connected"),
                hostName = json.safeText("hostName", 256),
                connLabel = json.safeText("connLabel", 512),
                sessions = (0 until minOf(sessions?.length() ?: 0, 500)).mapNotNull { index ->
                    sessions?.optJSONObject(index)?.let { row ->
                        row.safeText("id", 256).takeIf(String::isNotBlank)?.let { id ->
                            NativeSession(id, row.safeText("title", 512), row.safeText("workspace", 512),
                                row.optBoolean("running"), row.optBoolean("readOnly"))
                        }
                    }
                },
                sessionId = json.safeText("sessionId", 256),
                title = json.safeText("title", 512).ifBlank { "新会话" },
                rows = (0 until minOf(rows?.length() ?: 0, 500)).mapNotNull { index ->
                    rows?.optJSONObject(index)?.let { row ->
                        row.safeText("id", 256).takeIf(String::isNotBlank)?.let { id ->
                            NativeRow(id, row.safeText("role", 32), row.safeText("text", 32_000),
                                row.optBoolean("running"))
                        }
                    }
                },
                loading = json.optBoolean("loading"),
                error = json.safeText("error", 1_000),
                hasOlder = json.optBoolean("hasOlder"),
                olderLoading = json.optBoolean("olderLoading"),
                running = json.optBoolean("running"),
                readOnly = json.safeText("readOnly", 512),
                approval = approval?.let { pending ->
                    val actions = pending.optJSONArray("actions")
                    NativeApproval(
                        pending.safeText("id", 256), pending.safeText("title", 512),
                        pending.safeText("command", 2_000), pending.safeText("error", 1_000),
                        (0 until minOf(actions?.length() ?: 0, 8)).mapNotNull { index ->
                            actions?.optJSONObject(index)?.let { action ->
                                action.safeText("id", 256).takeIf(String::isNotBlank)?.let { id ->
                                    NativeApprovalAction(id, action.safeText("label", 128))
                                }
                            }
                        },
                    )
                },
                model = json.safeText("model", 256),
                modelOptions = (0 until minOf(models?.length() ?: 0, 100)).mapNotNull { index ->
                    models?.optJSONObject(index)?.let { model ->
                        val provider = model.safeText("provider", 128)
                        val id = model.safeText("id", 256)
                        if (provider.isBlank() || id.isBlank()) null else {
                            val efforts = model.optJSONArray("efforts")
                            NativeModelOption(provider, id, model.safeText("label", 256),
                                (0 until minOf(efforts?.length() ?: 0, 12)).mapNotNull { effortIndex ->
                                    efforts?.optJSONObject(effortIndex)?.let { effort ->
                                        effort.safeText("id", 64).takeIf(String::isNotBlank)?.let { effortId ->
                                            NativeModelEffort(effortId, effort.safeText("label", 64))
                                        }
                                    }
                                })
                        }
                    }
                },
                modelCurrentProvider = modelCurrent?.safeText("provider", 128).orEmpty(),
                modelCurrentId = modelCurrent?.safeText("id", 256).orEmpty(),
                modelCurrentEffort = modelCurrent?.safeText("reasoningEffort", 64).orEmpty(),
                permission = json.safeText("permission", 128),
                permissionCurrent = json.safeText("permissionCurrent", 128),
                permissionOptions = (0 until minOf(permissions?.length() ?: 0, 16)).mapNotNull { index ->
                    permissions?.optJSONObject(index)?.let { option ->
                        option.safeText("id", 128).takeIf(String::isNotBlank)?.let { id ->
                            NativePermissionOption(id, option.safeText("label", 128))
                        }
                    }
                },
                planOn = json.optBoolean("planOn"),
                offline = json.optBoolean("offline"),
                banner = json.safeText("banner", 1_000),
                draft = json.safeText("draft", 32_000),
            )
        }.getOrNull()
    }
}

private fun JSONObject.safeText(key: String, maxLength: Int): String =
    optString(key, "").take(maxLength)

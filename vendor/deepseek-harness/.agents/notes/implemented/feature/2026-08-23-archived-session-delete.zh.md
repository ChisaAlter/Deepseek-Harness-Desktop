# Agent Note: 已归档会话日志删除

Status: implemented

[English](2026-08-23-archived-session-delete.md) | 中文

## 问题

归档会把会话从所有分组视图中隐藏，同时保留其持久日志与 workspace `sessionIds` 席位。用户仍需要在把该行停到「已归档」之后销毁这份日志。`host/session-removed` 不能承载该含义：它只是卸下实时 owner（并可能让持久 subagent 摘要保持空闲）。`parentSession` 同时是 fork 与 subagent 的 seed 谱系，朴素子树遍历会删掉 fork。只返回 `.agent` 并丢弃 `AgentHandle` 的 `ctx.agents.create` / `resume` 会让断链前的 dispose（资源释放）没有 owner。

## 决策

**销毁仅针对已归档根、在侧栏确认、由 Host 按先 dispose 再持久删除编排，并以 `host/session-deleted` 发布。** 持久化 `delete` 只移除一个会话自有的持久日志；子树范围与实时 owner 生命周期由 Host 决定。

### 产品界面

活会话行菜单只有归档、重命名和 fork，没有删除。恢复与销毁只出现在底部 **已归档** / **Archived** 分区。点击已归档行仍会先取消归档再打开；删除仅在该行仍处于归档时经菜单暴露（`⋯` → **删除会话** / **Delete session**，`danger: true`）。确认 Modal 与 Workspace 注册删除同款：pending 期间禁用取消与确认；失败保持对话框打开；提交前 Escape / 取消 / 关闭不会调用 `session.delete`；仅当归档集合回声不再包含已提交 id 时才关闭对话框。文案声明对话记录永久消失，工作区文件夹不受影响。已知 Host 错误码（`session-running`、`session-not-archived`、`session-not-found`、`session-live-unowned`、`session-delete-partial`、`session-delete-incomplete`、`session-delete-in-progress`）映射为本地化删除文案；其他失败以消息文本展示。

### 可删除集合

`session.delete({ sessionId })` 命名一个**根**。该根必须已在 `ctx.workspaceRegistry.archivedSessionIds` 中，否则 `session-not-archived`（未知 id → `session-not-found`）。可删除集合为 `{root}`，再加上每个 `origin === 'subagent'` 且其 `parentSession` 已在集合内的持久或实时 header，迭代至不动点（含嵌套 subagent）。fork（设有 `parentSession`、无 `origin`）与 `origin: 'dshbot'` 排除在外。集合内任一 `status === 'running'` 的 agent（智能体）则整次调用什么都不删，返回 `session-running`。

### 实时句柄与先 dispose 再删除

Host 在每次成功的 `ctx.agents.create` / `resume` 上填充 `Map<SessionId, AgentHandle>`，包括 `ensureSession` 的 create/resume、fork create，以及对 **`ctx.agents.create` 与 `ctx.agents.resume` 的全局包装**，使进程内 subagent create 与 GUI 冷打开都保留 `session.delete` 所需句柄。同一实时 agent 已在映射中时 `retainHandle` 幂等。dispose 会去掉映射条目。存在 `ctx.agents.get(id)` 却无句柄时，整次调用以 `session-live-unowned` 失败——Host 不在 `AgentRegistry` 上另做一套拆解。无实时 agent 的冷归档会话跳过 dispose。按叶到根顺序，对每个 id **先** dispose 该 id 的句柄（若有），**再**对该 id 做持久删除。

### 持久化与提交

持久删除按叶到根。`persist.delete` 仅在后续 `list()` 显示该 id 已不存在时跳过拒绝（崩溃恢复）。若 id 仍在列表中，或 list 本身失败，则该 id 不计为 gone。

**补偿（fail-closed，不是事务回滚）：**

| 情况 | `host/session-deleted` | unarchive 根 | detach | RPC |
| --- | --- | --- | --- | --- |
| 全集 gone 且 registry/detach 成功 | 每个 gone id，**先于** unarchive | 是 | gone 集 | `ok` |
| 首个 persist 失败、gone 空、日志仍在 | 无 | 否 | 否 | 抛错（与补偿前一致） |
| 部分子已 gone、根仍 listed | 仅 gone | **否** | 仅 gone | `err` `session-delete-partial` + `details.deletedSessionIds` |
| 全集 gone 但 unarchive/detach 失败 | 已发布 | 尽力 | 尽力 | `err` `session-delete-incomplete` |

确认 durable id 已 gone 后，Host 对每个 gone id 发布 `host/session-deleted`，**然后** `unarchiveSession(root)` 与 workspace `detachSession`。这些 id 仍在 `deletingIds` 中时，`session/disposed` **不会**发出 `host/session-removed`；同时 `workspace.archiveSession` / `unarchiveSession` 以 `session-delete-in-progress` 拒绝。成功值为 `{ deletedSessionIds, archivedSessionIds }`。不回收附件 blob。不级联 message-feedback sidecar。

`workspace.list` 与删除结算可修剪「persist.list 与 live 皆无」的归档集成员（list 失败则 fail-closed、零写入）。修剪从不调用 `persist.delete`。

### 帧

`host/session-deleted` 表示持久日志销毁。Client 对每个已删 id（含原 subagent）丢掉摘要（unary `ok` 时 `applyDeleted` 与 host 帧共用同一路径），不走 `host/session-removed` 的持久 subagent 空闲路径。unary 删除成功时 workspace manager 还会 `installArchived` 回声。删除对话框仍**仅当** committed id 离开 `archivedSessionIds` 时关闭。

## 已考虑的替代方案

**把日志销毁复用到 `host/session-removed`。** 否决：该帧是卸下 / 空闲 subagent；反馈与 client 空闲路径已按非销毁处理。

**在活会话行上放删除。** 否决：产品路径是先归档（隐藏、保留日志），再仅在「已归档」经确认销毁。

**删除所有带 `parentSession` 的子会话。** 否决：fork 用 `parentSession` 作为 seed 谱系且无 `origin`；只有 `origin === 'subagent'` 才是已归档根的隐藏子会话。

**在同一次 RPC 里回收附件 blob。** 否决：fork 共享 blob；blob GC 属于后续持久化议题。

**级联 message-feedback sidecar。** 否决：反馈存储是独立 domain；本轮只销毁会话日志。

**实时 agent 没有保留句柄时另做一套 `AgentRegistry` 拆解。** 否决：以 `session-live-unowned` 失败关闭，避免在运行时脚下拆掉无主实时 owner。

**把每一次 `persist.delete` 拒绝都当成崩溃恢复跳过。** 否决：后端可能在日志仍在时拒绝；仅当后续 list 显示该 id 已不在时才跳过。

## 测试

持久化约定测试钉住 `delete`。Host `api-proxy-session-delete` 另钉 **`session-deleted` 先于 `archived-sessions-changed`**、级联 `session-delete-partial`、`ctx.agents.create` 保留句柄、删除中 `session-delete-in-progress`。Client：`applyDeleted` / delete ok 时装归档回声。ui-workspace：本地化删除错误码、缺失会话占位菜单、关显示开关完全隐藏已归档。生产 `TC-CHAT-013` 待装包补测（含确认后不闪回）。

## 后果

在「已归档」确认删除会永久去掉对话记录目录以及嵌套的 `origin === 'subagent'` 日志；工作区文件夹以及该根的 fork 子会话仍在。打开 → 归档 → 删除可行，因为 Host 把 `ctx.agents.create` 与 `ctx.agents.resume` 都包进句柄映射。附件 blob 与 message-feedback 行可以在日志删除后仍留下，直到那些 domain 有自己的 GC。

## 相关

[会话归档（注册表级全局集合）](../../archived/feature/2026-07-31-session-archive-global-set.md)。[Workspace 注册删除](2026-07-27-workspace-registration-deletion.zh.md)。[会话持久化 seam](../architecture/2026-06-14-session-persistence.zh.md)。

# Agent Note: 无目录任务会话

Status: implemented

[English](2026-08-15-no-directory-task-sessions.md) | 中文

## 问题

会话主视觉区要求先选 Workspace，composer 才接受输入；侧栏把不属于任何 Workspace 的 Session 收进名为「未分组」的伪文件夹行。只想聊天、不想接纳项目目录的操作者仍必须挑选或创建 Workspace，结果要么登记了一个本不想保留的目录，要么 composer 一直不可用。

添加 Workspace 仍然只有一条路径——选一个宿主机目录（[单一路径 Note](../simplification/2026-07-31-one-route-to-add-a-workspace.md)）。无目录 Session 不能变成第二条 `workspace.create` 路径。它的 cwd 也不能等于某个真实 Workspace 路径或 `process.cwd()`，否则成员投影会把它收进某个项目。

主视觉区工作区芯片切换 picker 开关，但 picker 的 Menu 是兄弟节点（`anchor={null}` 加 `getAnchorRect`）。第二次点击芯片时，Menu 先把 `pointerdown` 当成外部关闭，随后芯片的 `click` 再打开，菜单因此关不掉。

## 决策

Workspace Controller 在每次 `workspace.follow` 的 baseline 上宣告 `scratchCwd`（`WorkspaceBaseline.scratchCwd`；alpha.4 已无 `host.describe`）。Host 用 `dshHomePath('no-workspace')` 解析它（`$DSH_HOME/no-workspace` 或 `~/.dsh/no-workspace`），并在 controller 初始化时 `mkdir`。客户端镜像为 `WorkspaceSnapshot.scratchCwd`，首个 baseline 到达前为空；浏览器从不拼接该路径。

`uiWorkspace.connectNoDirectory()` 复用 cwd 等于 `scratchCwd`、id 不在任何 Workspace `sessionIds` 中、未归档、且非 subagent 来源的空白 Session；否则调用 `session.create({ cwd: scratchCwd })`。它从不调用 `workspace.create`。进行中的调用会合流。导航由调用方负责（`sessions.open`）；ui-conversation 的 `selectNoDirectory` 与 `selectWorkspace` 同样带走主视觉区草稿。

**列出与否只看成员身份，绝不看 cwd。** 侧栏只列两类 Session：已登记 Workspace 的成员，以及无目录任务（`isNoDirectorySession`：无归属**且** cwd 等于 `scratchCwd`）。其他无归属 Session——首先是被删除登记的 Workspace 的成员——在任何地方都不列出：分组、单列表、搜索、已归档都没有。`WorkspaceRegistry.create(path)` 会把规范化 cwd 等于该目录、且未被其他记录记账的所有持久化/在线 header 重新接纳，因此重新登记同一目录就把这些 Session（含归档状态）带回来。`uiWorkspace.deleteWorkspace` 在当前 Session 属于被删 Workspace 时清空选择。

主视觉区 picker 在 **添加工作区…** 之上钉一行 **无工作目录**（`menu.noDirectory`，`IconNewChatOutline16`）。选中后由 ui-conversation apply 注入的 `selectNoDirectory` 带走当前草稿并打开已连接的 Session。没有 Workspace 成员身份的 Session 在芯片上显示该文案（绝不用 scratch 目录的 basename），并解锁 composer。冷启动、尚无 Session 时仍使用「选择工作区」占位和惰性 composer。`addIsTheOnlyEntry` 仅在仅添加的侧栏表层只剩添加动作时为真；主视觉区空列表保留菜单，因为「无工作目录」和「添加工作区」是两个选项。

分组侧栏保留 Workspace 文件夹行（外观、菜单、拖拽、`startSession`），末尾跟一节 **无工作目录**（`group.ungrouped`，键 `UNGROUPED_KEY`），由 `TasksSectionHeader` 而非 `ProjectRowItem` 渲染：会话直接列在可折叠标题下，缩进与 Workspace 下的会话行一致，节内 `+` 调用 `connectNoDirectory`，没有会话时不渲染该节。其顺序仅存于浏览器本地（没有 Host 账目可写）。顶部「新会话」仍使用 `startSession`。

主视觉区芯片的 `pointerdown` 调用 `stopPropagation()`，避免兄弟 Menu 的外部关闭与 click 切换竞态，与 InputBar 卡片相同。

## 曾考虑的替代方案

**把 scratch 登记成 Workspace。** 否决：那会变成第二条添加工作区路径，并显示一个操作者从未挑选的文件夹。Workspace 成员身份仍然只来自目录接纳。

**用操作者主目录或 `process.cwd()` 作为默认 cwd。** 否决：这两条路径都可能等于某个已有 Workspace，无目录 Session 就会被投影成项目成员。

**像极简模式那样把芯片放进 Menu 的 `anchor`。** 否决：芯片在 ui-conversation，Menu 在 ui-workspace；为少传一个事件而拆掉 slot 分离，不如在芯片上拦住 `pointerdown`。

**继续把未分组画成伪 Workspace 文件夹行。** 否决：操作者要的是任务列表，不是名叫「未分组」的文件夹；该行上的 `+` 还会调用 `startSession` 并落到最近 Workspace。

## 后果

无目录 Session 是 Host Session，cwd 由 Host 持有，Workspace 索引中没有它。删除 Workspace 登记后，其成员在各处隐藏，直到同一目录再次登记（2026-09-03 修订；此前会落入分组桶）。测试钉住：picker 条目与其选中标记、仅 scratch cwd 的 Session 解锁 composer（被删 Workspace 的空白会话保持惰性）、节内 `+` 调用 `connectNoDirectory`、baseline 携带 `scratchCwd`、`connectNoDirectory` 复用/新建与合流、registry 创建时重新接纳、分组/单列表/搜索/已归档四处都隐藏孤儿会话。这些包变更后必须重建客户端插件包；Host baseline 变更需要完全重启桌面应用。

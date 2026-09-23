# Decision: PTC 产出的文件纳入收尾正文的点击词表

Status: implemented

中文 | [English](2026-09-22-ptc-produced-file-mentions.en.md)

## Problem

收尾正文里的行内代码文件名只有在 `ui-deliverables` 的产出词表中存在时才会变成可点击的代码芯片。该词表此前只记录根级 `tool/call` 中成功的 `write`、`edit` 与有修改作用的 `str_replace_editor`。当文件实际由 `run_code`/PTC 子调用创建时，聊天界面会展示子调用的工具行，但 `pelican-bike.html` 这类行内代码找不到对应路径，于是保持惰性，点击没有任何反应。

真实 `tool/ptc-dispatch` 与 `tool/ptc-dispatch-start` 事件没有 `turn` 字段。此前的测试夹具人为加入了 `turn: 1`，掩盖了这一契约差异；同时 `ConversationNodeDefinition.match` 只能看到事件本身，无法把无坐标的 PTC 事件归入正确轮次。

另一处限制在桌面打开漏斗：当 Session 客户端摘要暂时没有 `cwd` 时，`ui-surfaces` 会在解析绝对路径之前直接返回，使一个本可按 Session 绝对文件资源安全预览的路径退回 Host 打开器。

## Decision

把 PTC 子调用的成功修改纳入产出词表，并让轮次归属只来自 Conversation assembler 已解析的规范 Location：

- `ConversationNodeDefinition.match` 增加可选的 `location` 参数；assembler 在普通 Definition 与 fallback 两侧都传入 `locationIndex.locationOf(event)`。既有单参数 Definition 不受影响。
- assembler 在 Location 变化后回到已加载但先前未匹配的事件：`prepend` 与 `append` 的边界重建只对“此前返回 null、现在可匹配”的 Definition 做回填，已拥有事件的 Definition 不重复匹配，保留 `mergeMatches` 的重复检测与 target/fallback 仲裁。这样最近分页里先以 `session`/`unresolved` 到达、随后由老页 `turn/start` 解析出 Location 的事件也能获得正确归属。
- `ui-deliverables` 只消费 settled `tool/ptc-dispatch`，并从 `location.kind === 'turn' | 'step'` 的 `location.turn.turn` 取得轮次；`unresolved`、`session` 或缺失 Location 一律不归属，不从邻近事件、`rootCallId`、当前轮次或 UI 顺序猜测。
- PTC 与根级调用共用同一套修改参数校验；只有 `isError === false`，且 `name` 为 `write`、`edit` 或有修改作用的 `str_replace_editor` 时，才把规范化 `arguments` 中的路径以事件真实 `seq` 记入对应轮次。
- `ui-surfaces` 在 Session 已知但 `cwd` 缺失时接受绝对路径：直接调用 `fileAddressFor(sessionId, undefined, path)` 进入 Session 文件资源，不要求 `relativeTo`，也不尝试需要可信 `cwd + relativePath` 的 `previewWorkspaceFile`。缺 `cwd` 的相对路径仍安全回落到原 Host 打开器，不猜测 scratch 根目录。

已知真实 scratch Session 的 `cwd` 由 Host 提供（例如 `dsh-home/no-workspace`）；实现不得按目录名字符串识别 no-workspace。

## Alternatives considered

- **给 PTC 事件补 `turn` 字段** — rejected：改变持久化事件契约与既有 Session 日志，且与“事件执行包围关系由构造保证”的架构相冲突；旧日志也无法补齐。
- **在 `ui-deliverables` 中按 `rootCallId`/`subCallId` 重建工具树来推断轮次** — rejected：会在业务 Definition 中复制 assembler 的工具树与分页语义，嵌套、回放和未来 PTC 变更都可能与规范归属分叉。
- **让 start 事件也进入 Definition，或按当前轮次兜底归属** — rejected：start 没有成功/失败事实，且“当前轮次”在异步或历史回放时会归错轮次；settled 事件加规范 Location 才是权威来源。
- **只在 Definition 内缓存 Location 变化前的判定结果** — rejected：`refreshMatchLocations` 只能更新已拥有 Match 的 `location`，无法救回当时完全未匹配、因而不属于任何 Context 的事件；归属必须在 assembler 层重新判定。
- **按文件名外观或逐个 `stat()` 探测把行内代码变成链接** — rejected：命令、包名、配置值、符号与同名文件都会误变按钮；只有权威产出或交付事实能定义文件提及。
- **缺 `cwd` 时把相对路径绑定到 `$DSH_HOME/no-workspace`** — rejected：客户端无法证明该目录就是目标 Session 的根；相对路径保持安全回落，绝对路径才按 Session 资源打开。

## Consequences

由 PTC `write`/`edit`/`str_replace_editor` 成功创建或修改的文件现在进入所在轮次的产出词表，收尾正文里的精确路径或唯一 basename 会渲染为现有代码芯片，点击经 `workspaces.openPath` 打开右侧 Sidebar 文档预览；重复打开复用同一 tab。实际分页加载中，先到的事件即使暂时没有 Turn/Step Location，也会在更老一页补齐 `turn/start` 后重新归属，不会永久丢失产出路径。PTC 失败、读取、查看、未知工具和格式错误参数不贡献条目；两条同名路径的 basename 仍保持惰性，避免打开错误文件。

缺 `cwd` 的绝对路径可继续进入 Sidebar 的 Session 文件资源；缺 `cwd` 的相对路径仍走原 Host 回退。`ui-deliverables` 新增对 `@deepseek-ai/dsh-tools/types` 的编译期依赖。测试覆盖真实无 `turn` 的 PTC start/settle、跨轮次隔离、unresolved 不归属、成功/失败/读取/未知/畸形参数、PTC basename 解析、已知 scratch `cwd` 相对路径、缺 `cwd` 绝对与相对路径。

`ConversationNodeAssembler` 新增 Location 变化后的 null→match 回填：`prepend`、`append` 的边界重建只重新判定此前未匹配的 Definition，已拥有 Match 的事件不会被重复匹配，`mergeMatches` 的重复检测与 target/fallback 仲裁保持不变。聚焦测试覆盖“最近页只有 PTC settlement、老页补齐 `turn/start`”从无归属到正确归属，以及后续 Location 细化不产生重复 Match。

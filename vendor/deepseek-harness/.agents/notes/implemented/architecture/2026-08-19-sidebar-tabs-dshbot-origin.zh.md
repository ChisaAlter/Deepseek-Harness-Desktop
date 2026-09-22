# Agent Note: Sidebar region tabs, dshbot session origin, and session-only model selection

Status: implemented

[English](2026-08-19-sidebar-tabs-dshbot-origin.md) | 中文

> 侧栏、会话 origin 与单会话模型决定仍然有效。dshbot 的产品实现由 standalone [Feature 卡](../../../../../../docs/features/dshbot.md)维护；安装、群协议与编辑器行为以该卡为准，不再以本 Note 为现行来源。

## Problem

左侧栏曾是封闭的几何壳：插件只能整表替换 `sidebar.workspaces`，桌面联系人列表无法与官方会话浏览器并列。为这些联系人创建的会话还会出现在项目列表里，而且 `session.selectModel` 总会写入用户的全局默认模型。

## Decision

`ui-sidebar` 声明 list 洞 `sidebar.nav.tab` 和 keyed 洞 `sidebar.page`。占用是绘制选项卡条的唯一信号；零贡献时保持 New Session 与 `sidebar.workspaces`，不多画控件。选中插件 Tab 时隐藏 New Session，区域由与 tab id 相同的 `sidebar.page` 填充。Tab 组件不会被挂载；外壳从 list 账本读取 `id` / `label` / `order`。导航 store 持久化 `selectedTab`，在已存 id 消失时回退到 `sessions`。

`SessionHeader.origin` 为 `'subagent' | 'dshbot'`。`session.create` 只能打上 `origin: 'dshbot'`；`subagent` 仍由子 Agent 启动持有。列表汇总携带 origin，`sessionVisible` 把两者都藏起来。客户端 `SessionManager.create` 转发 `origin` 和 `agentPreset`，并打在乐观行上，避免 dshbot 会话在工作区列表里闪一下。ConversationRoot 对 `origin: 'dshbot'` 跳过 EmptyHero，即使日志仍空：会话顶栏保持可见，composer 停在底部，ChatView 可以填充 `conversation.chat.empty`。`connectWorkspace` 与 `connectNoDirectory` 拒绝复用 origin 为 `dshbot` 或 `subagent` 的空白行。会话顶栏的 agent-preset 标签在 `origin: 'dshbot'` 时隐藏。

`session.selectModel` 接受 `persistDefault`（默认 `true`）。传 `false` 只改该会话，不写 `agent-default-model`。

房间是共享 transcript，可见气泡只有用户与成员投递。代码选择被 @ 的成员或全员，`llm/stream` 短路每次只产生一个顺序 `ask_participant`，从不调用房间聊天模型。轮次按 peer-equal 顺序旋转；`NEXT:` 只为旧日志显示剥离，不参与调度。群含 2–6 个 Bot，硬顶为 10 次成员尝试和 3 轮；pass、成员失败与重启后无结果调用都消耗尝试，一整轮 pass 即停。`ask_participant` 启动只允许 `send_room_message` 的 one-shot spawn 子 Agent，把成员失败变成静默 pass，等待结果后 dispose。编辑器提供互不重叠的人设芯片（反对 / 补全 / 落地 / 毒舌），锁定已建立群的工作区，不提供通知开关或记忆文本框；持久记忆只由 `remember` 写入。房间 ChatView 不画上下文注入、`Deep diving...`、turn-tail；InputBar 再藏 `+`、plan、ContextMeter、`$`。`@` 只出 dshbot 成员；房间里文件/子智能体/cordis/`/` 候选为空。InputBar 在 `origin` 为 `dshbot` 或 `agentPreset` 为 `dshbot-room` 时不渲染 `conversation.input.model`。一对一 Bot 只在编辑资料里改模型。侧栏上名字、下模型（空则「使用部署默认」）；群聊无预览行，头像带「群」角标。插件把 `dshbot-room` 打到每个目录房间的会话列表行上，这样即使 host 汇总漏了 preset，ChatView 与 InputBar 仍会藏房间铬。

目录项可以带 `avatar`：小人 `{ kind: 'blob', shape, color }` 或烘焙图 `{ kind: 'image', dataUrl, crop }`。缺记录时用条目 id 或名字哈希落到八种形体之一。编辑 `Modal` 里选形状和颜色，或上传后裁成圆/方并烘焙成小 JPEG。侧栏行在 `session.running` 时进入思考态；`ask_participant` 气泡在工具还没有 result 时进入思考态。不做 Generate，也不做头像商店。

dshbot 是通过桌面 curated 市场或 `dsh plugin add` 安装的 standalone dsh 插件，桌面不预置。插件加载时在 `$DSH_HOME/.agent-presets` 自装 `dshbot-room`；桌面启动只清旧桌面残留，并保留 profile dependencies、bundles、真实目录及 pnpm/市场软链。

## Alternatives considered

**用 Bot 列表占用 `sidebar.workspaces`。** 该 single 洞会整表替换官方项目/会话浏览器，且插件不能 import `WorkspaceBrowser`。

**把 Bot 设置放到右侧 surfaces。** Surfaces 是工作循环（Files / Browser / Diff），不是 IM 资料编辑器。编辑 UI 走 `shell.overlay` 和 `Modal`。

**让多个模型写同一条 agent-loop。** 一会话即一 Agent。房间是技术父级，其 preset 工具按成员模型启动一次性子 Agent。

**让 LLM 父会话挑选下一个说话人。** 那是 AutoGen SelectorGroupChat，也是 Muse Spark 当调度员的失败模式。选人留在代码里。

**把 dshbot 做成官方 `packages/client` 包。** 会把 IM 产品绑进 100% 覆盖率门禁和 web-app 名册，使每次 `dsh web` 都带上它。桌面改为复制一份 vendored 插件。

**给 1:1 Bot 会话打 `origin: 'subagent'`。** subagent origin 是隐藏子会话的谱系。dshbot 联系人是父对话，必须离开工作区列表，又不能加入那条谱系。

**把空的 dshbot 日志推导成 `composerPhase: 'active'`。** 空日志位和首次 prompt 的 engaging 路径仍由 `derivePhase` 负责。origin 只跳过新对话外观和空白复用。

## Consequences

未安装可选插件时官方 Web 不变；安装 dshbot 后出现 Bots 选项卡，其会话不进入项目列表，卸载后选项卡消失。保存 Bot 模型不会改动编码会话的默认模型。dshbot 全局注册 `ask_participant`，`dshbot-room` preset 把房间 agent 限制为该工具；非目录房间的调用者执行会失败。房间本身不说话；成员收到自己上次发言后的房间历史，通过 `send_room_message` 投递或 pass。`ask_participant` 卡片在外侧头像旁显示目录名和可见正文；成员使用完整子人设，不继承 harness 身份句。dshbot composer 没有模型座位；房间再没有命令、plan、meter、`$`，`@` 只列成员。一对一 Bot 的模型来自编辑资料。Bot 与群聊行显示目录头像（小人或裁切图）；小人在该会话 running 时变形。打开从未发过消息的联系人或房间时显示会话顶栏和成员名单，而不是新对话 Hero。New Session 不会落到这些空白行上。

## Testing

`packages/client/ui-sidebar/tests` 钉住无选项卡条时的外观与插件 Tab 区域切换。`packages/client/ui-workspace/tests/tree.client.spec.ts` 隐藏 `origin: 'dshbot'`。`packages/host/apiproxy/tests/api-proxy-models.spec.ts` 钉住 `persistDefault: false`。`packages/client/runtime/tests/manager.client.spec.ts` 转发 create 的 origin。`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 对空白 `origin: 'dshbot'` 会话跳过 EmptyHero。`packages/client/runtime/tests/workspaces-service.client.spec.ts` 拒绝复用空白 dshbot/subagent。`packages/client/ui-agent-preset/tests/components.client.spec.tsx` 在 `origin: 'dshbot'` 时隐藏顶栏预设标签。`packages/client/ui-conversation/tests/input-bar.client.spec.tsx` 在 `origin` 为 `dshbot` 或 `agentPreset` 为 `dshbot-room` 时不渲染 `conversation.input.model`，并在房间里藏 `+` / plan / ContextMeter / `$`。`packages/client/ui-conversation/tests/chat-view.client.spec.tsx` 在房间里跳过 `Deep diving...`、上下文注入和 turn-tail。`packages/client/ui-files/tests/path-trigger.client.spec.ts`、`packages/client/ui-subagent/tests/browser-plugin.client.spec.ts`、`packages/client/ui-commands/tests/service.client.spec.ts` 与 `packages/client/ui-skill/tests/browser-plugin.client.spec.ts` 在 `dshbot-room` 下不返回 `@` / `/` 候选。桌面 `src/main/dshbot-*.test.js` 钉住 standalone preset 清理与 pnpm 软链保护、房间 preset 自装、群协议硬顶、尝试计数、成员失败即 pass、2–6 成员、编辑器清理、目录辅助函数、头像 normalize、房间气泡及 host 注册。

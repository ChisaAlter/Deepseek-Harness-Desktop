---
description: "Target-neutral 对话装配与浏览器 shell：事件和视图注册表、逐会话 binding、输入状态、slot 与临时 composer takeover。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

[English](README.md) | 中文

## 概述

作用域内的 `conversation.edit` 将修订文本和草稿图片连同编辑目标送入同一 Session 的附件准入路径。准入结果返回常驻 composer 编辑会话，不调用 fork 或导航；准入成功后恢复收起的草稿。

`ui-conversation` 拥有与 target 无关的 Conversation 组装和共享浏览器 shell。它消费 Session Controller 的 `SessionEventLikeEntry` feed，通过 `ctx.uiConversation` 暴露不依赖 React 的注册表与逐 Session binding，并通过 `ctx.uiSession` 提供 `useConversation`、`useInput` 和 `inputActions` 标准 props。它还拥有按会话的持久化图片 URL 缓存：`ctx.uiConversation.imageUrl(sessionId, attachment)` 为每个附件解析一个经会话授权的浏览器 URL，并随 Session binding 释放而撤销，因此所有 Conversation target 共享一次 `session.attachment` 读取。Chat 等具体 target 位于独立包，由各自包注册 Definition、快照 builder、View 和 renderer。

## 目录

- [Conversation 组装](#conversation-assembly)
- [Shell 与标准 props](#shell-and-standard-props)
- [临时 composer entry](#temporary-composer-entries)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="conversation-assembly"></a>
## Conversation 组装

`UiConversation.events` 是 event Definition 的唯一 registry，`UiConversation.views` 是 target snapshot builder 的唯一 registry。两者都拒绝重复 key、保持注册顺序、返回幂等 disposer，并在 contribution roster 变化时重建现有 binding。`UiConversation.binding(bindingOrSessionId)` 为当前 Session Controller binding 返回 identity 稳定的 Conversation binding，不会另开事件源。

适配器把每个 `SessionEventLikeEntry` 直接交给 assembler。外层 `type` 区分持久事件与 Client-only transient event，内部 `event` 则统一公开 `type`、`seq`、`time` 与 `data`；Definition 接收这个内部 `SessionEventLike`。replacement window 可以包含两种 entry，历史 prepend 携带持久 entry，实时 append 则可以携带任一种。两种事件都使用 Definition 的同一组 `match` 与 `update` 方法，`start` 只接收持久 event，assembler 会拒绝 transient start。不消费 Assistant delta 的 Definition 对 `assistant/live-chunk` 返回 `null`。replace window 或 revision 断档从完整已加载窗口重建；连续 revision 的 append、prepend 与 Assistant settlement 使用增量组装。settlement 只删除具名 attempt 的 transient match，应用可选持久 entry，并重放受影响的 Context 及其 dependent，不替换无关 target node。assembler 拥有 Context 匹配、Turn/Step location、target node 物化、target activity 和稳定 target source。`ConversationSnapshot` 只包含与 target 无关的 View 与 active-target 事实；Session lifecycle 状态仍属于 `SessionSnapshot`。

shell 选择解析出 target 或 target source 收到首个 subscriber 时，该 target 进入 active 状态。assembler 从当前 Context 对它执行一次 replace，并使它参与后续增量 flush；创建 source 不会激活 target，取消订阅也不会停用 target。

target package 通过 declaration merge 扩展 snapshot 与 Location data map，再调用 `ctx.uiConversation.events.register(...)` 和 `ctx.uiConversation.views.register(...)`。target 通过 `ctx.uiConversation.binding(binding).target(targetId)` 读取其 Session-owned source。注册属于 Cordis effect，返回的 disposer 从同一个 registry 移除 contribution。共享的请求检查服务于每个 target：`ctx.uiConversation.inspectSystemPrompt(previous, event)` 将系统消息与位置替换解释为不可变的已加载 surface 状态。它按 surface 顺序选择最后一个非空的存活系统节点，为连续重写只保留存活的替换位置；遇到未建立索引的更早端点后，提示词保持不可用，直到向前补页回放提供其顺序。target 自有的 Definition 独立保留历史卡片。`ctx.uiConversation.inspectRequestPrompt(previous, header, system)` 根据该有效提示词分类请求变更；普通消息与流式分片无需处理系统状态。

<a id="shell-and-standard-props"></a>
## Shell 与标准 props

共享图片插槽属性将展示选择与持久化引用分开：`thumbnail` 请求完整缩放的附件列表缩略图，`compact` 请求裁剪的图片方块。每张图片可通过可选的 `label` 提供无障碍展示名称；加载和缓存标识仍使用原始附件引用。[ui-attachment](../ui-attachment/README.zh.md) 负责渲染与灯箱。

上下文占用按钮在输入卡片下方、会话统计右侧显示圆环和百分比。点击按钮可在视口内的面板查看 token 构成，没有统计项时面板也不会越界；上下文用量和容量尚不可用时，按钮保持隐藏。

输入框注册「文件」命令动作，负责其标题、可用性和原生文件选择器回调。菜单可用性与实际调用都读取已挂载输入框当前的附件接收策略。输入框卸载或锁定后该动作不可用，插件 dispose（资源释放）时移除注册。回调绑定留在输入模块内部。

`SessionInputShell` 通过私有 [DraftEditorRuntime](src/client/input/editor/runtime.ts) 为每个 Session 持有一个 Lexical editor，同时保留提交、附件选择和恢复决策。[DraftEditor](src/client/input/editor/DraftEditor.tsx) 呈现借用的 editor；InputBar 保留钩子与 refs，并通过 [view-binding](src/client/input/editor/view-binding.ts) 安装 DOM 行为。编辑器类型位于 [draft-editor.ts](src/client/contract/draft-editor.ts)，共享输入和提交类型位于 [input.ts](src/client/contract/input.ts)。这一拆分不支持同一 Session 同时挂载多个可编辑 root；[两阶段隔离提案](../../../.agents/notes/proposed/architecture/2026-09-14-composer-model-and-draft-editor.zh.md) 定义剩余工作。

已认领的命令在仅删除参数和末尾分隔空格时保留身份与高亮，改动命令名才会释放认领。所有命令和语言使用相同规则，包括 `/goal`、`/目标`、`/plan` 和 `/计划`。输入法组合输入期间，命令提示和普通占位文字持续隐藏，直到编辑器提交最终文字且对应输入为空时才重新显示。

工作区选择使用 `uiWorkspace.openWorkspace` 准备目标并提交导航。草稿文字和附件仅在该请求仍为当前请求时，通过它的同步准备回调搬移；后续导航或所有者释放会保留原草稿。

本包占据 root 作用域 `main` 中的 `conversation` key。其 `main.conversation` shell 将 strict Session Header 保留在 optional-Session `conversation.content` Component Factory 外。Factory 拥有共享正文与 Composer，通过其标准 Hook 读取当前 Session，并公开 strict-Session `views` 与 root-scoped `widthControls` 两个局部位置。默认 adapter 渲染现有 `conversation.session` entry，主 occurrence 选择宽度拖拽条；嵌入式 occurrence 可以替换 `views`、省略拖拽条，且不渲染主 Header。`ctx.uiSession.provide()` 从同一个 Session binding 物化 Conversation 与 input source，并将 `inputActions` 作为稳定标准 prop 提供。

blank Session 保留 header 的 leading 与 corner 控件，包括右侧栏展开入口，同时隐藏标题、actions、utilities 和 View tabs。选择 Workspace 会创建这些控件所需的 Session，无需先发送消息。没有选中 Session 时，strict header 不挂载。侧栏各入口仍遵循自身的数据与执行环境要求。

View 选择规则固定：有效且已注册的持久化选择优先，其次是已注册的 `chat`，否则不渲染 View；绝不选择第一个已注册 View。Shell phase 只组合 Session lifecycle 与 active-target set，不读取任何 target-specific 快照。

Session 首次绑定或缓存的 Session 成为 current 时，shell 会在渲染前读取持久化 View 偏好，激活已注册的偏好 View 或 Chat fallback，并在后续 tab 或 focus 选择写入 store 前先激活对应 target。blank Session 仍不渲染 `conversation.view` slot；未选中的 target 不会激活。

主 occurrence 的活跃 transcript 只在未被内容覆盖的两侧沟槽中提供正文宽度拖拽条；嵌入式 occurrence 省略这些拖拽条。View 如果绘制进沟槽，只将具体的可见元素提到拖拽条上方；透明的全宽包装层保持在下方，不会占用空白沟槽。该规则要求此元素与 Conversation body 之间不能引入中间堆叠上下文；浏览器场景固定了交付 Chromium 的行为。Chat 将该规则用于表格元素，其限定在阅读列内的工具卡片无需提高层级。指针位于拖拽条上时，滚轮仍会滚动 transcript，Ctrl+滚轮则保留为浏览器缩放手势。粘滞 composer 刻意拥有完整的底部区带，该区域不是宽度调整目标；已捕获的拖拽会将指示线提高到松开为止（[决策](../../../.agents/notes/implemented/bug-fix/2026-09-14-transcript-width-handle-layering.zh.md)）。

常驻 composer 在无 Session 与有 Session 之间保持挂载。输入空白字符会隐藏占位提示；没有附件的纯空白草稿无法发送。无 Session 时，同一个编辑器表面保持 inert，Workspace picker 连接 blank Session。该表面是 shell 所有的 Lexical 编辑器：引用 chip 是携带 owner 序列化身份的原子 decorator 节点（提交时经 owner codec 展开），已认领的 slash command 保持为带样式的行首文本，文件夹文本引用以图标前缀携带文件夹图形，草稿的剪贴板投影镜像到逐 Session Conversation store。QueueDock 直接从 Session 的 `inbox` 投影读取 `next-turn`，包含从冷状态恢复的消息。Queue 操作通过 scoped `ctx.conversation` service 寻址准确的 queue occurrence；queue 预览经 `ui-primitives` 的共享行内引用投影渲染已发送文本（wire 会话形式折叠为其标签），并按原始附件顺序展示本地或持久化的图片和文件。图片使用缩略图，文件使用紧凑的名称与大小卡片。编辑态展示字面发送文本，持久化缩略图通过会话图片 URL 缓存解析。繁忙时 Enter 行为保存在 Host-backed `ui-conversation` settings namespace。 composer 键盘映射经斜杠流水线裁决触发菜单的按键——Tab 确认高亮补全项（可下钻项则下钻），Escape 与 Shift+Tab 离开菜单且不选定——其余按键交给编辑器自身。 接管键盘的浮层通过 `SessionInput.focus()` 把键盘还回来，该路径走 Lexical 自己的 focus，因此光标回到草稿原来的位置而不是开头。

空会话 Hero 的 workspace 与 agent-preset 行跟随输入卡的实际宽度。有已保存宽度时，其上限读取 `--dsh-composer-resized-width`，否则读取 `--dsh-composer-card-max-width`；整行在更宽的 Hero stack 内居中，因此恢复窄卡时这些控件不会留在 stack 左缘。

首次发送保留编辑器，使用共享慢速动效 token 将输入框从实测 Hero 位置移入会话位置。相对定位保持 fixed 菜单和对话框的坐标；减少动态效果时直接落位，切换会话取消移动。普通 composer 的底部为统计行预留高度，覆盖准入、投影更新和统计数字尚未出现的阶段。

运行态边光位于卡片正文后方的未滤镜、pointer-inert 包装层内。4px 圆角裁切壳把 bloom 限制在 6px composer stack 间距内；stroke 与 inner light 对齐 22px 卡边，外层滤镜容器模糊内部 masked 光源且不覆盖 dock 内容。参照 Libraries.dev Rotate，legacy 默认 2px stroke 以 0.6 透明度经过旋转 conic 强度窗口，inner light 共享同方向双 conic 窗口，bloom 光源保持 1.5px。界面设置提供顺/逆时针/往返方向、0.8～60s 周期、强度、bloom 强度、色相偏移、呼吸、色相循环、视觉模式、8 个色板或 2～6 个自定义颜色、0.5～4px track width、0～12px blur、夜间调暗、缓动、最多 5 个预设和 v1 JSON 剪贴板导入导出。静态 rim 始终定义完整胶囊；彩色 beam 自身带透明尾迹，但亮峰必须无重复 stroke `clip-path` 地完整扫过每个圆角。模式不是业务状态机，聚焦、输入、发送、完成和失败状态灯仍不在范围内。

界面设置保留即时 beam 开关，并增加设置图标弹窗，用于调节完整运行态 beam profile。弹窗使用共享 `ComposerBeam` 渲染器预览，通过一次 Host-backed namespace mutation 同时保存 active `composerBeamStyle` 与 `composerBeamPresets`，默认值恢复历史 legacy 渲染；这些控件不会改变 4px 裁切壳、22px 圆角、1.5px bloom 光源、mask 或 pointer-inert 分层。

外观设置承载可选的 composer 输入特效行：即时开关加设置图标弹窗。开启后 `TypingFxLayer` 在 pointer-inert 叠加层上，于每个新键入字符的字形位置播放瞬态回显——Lexical 托管的文本 DOM 从不被包装或改写——并可用方块或下划线替换原生光标。粘贴、历史、草稿种子、程序化更新和 IME 组合进行中的输入都不产生回显，composition-end 提交时把整段提交文本播一次回显（对 composition-start 快照做整段 diff），有界回显池让每个 ghost 在自己的动画结束时退休。弹窗提供效果预览，可调节回显样式、光标、闪烁、速度与回显/光标/文本颜色（跟随主题、6 个内置配色或自定义三色），最多保存 5 个预设，并通过剪贴板交换带版本号的 `dsh-typing-fx` JSON 封套；`typingFx`、`typingFxStyle` 与 `typingFxPresets` 通过一次 Host-backed mutation 持久化在本包设置命名空间中，减弱动效时所有动画停止。

默认发送采用乐观提交：Enter 在同一事务里清空草稿、occurrence 表和撤销历史，composer 保持 `plain`，发送作为 detached attempt 运行，发送期间可以继续输入和提交。`sendSession` 在序列化之前用投递模式注册 Session 提交回显（`session.beginSubmission`），并在 `pendingSubmissions` 中保留图片与文件的选择顺序；Session 根据该模式与当前运行状态推导位置，因此空闲发送进入 transcript（文本记录），繁忙时 Queue 进入 QueueDock，繁忙时 Steer 进入 pending-steering 区域。随后让出一帧，图片经浏览器原生 `FileReader` data-URL 路径编码，文件则引用已暂存凭证。命令提交也用同一凭证表示通用文件，因此发送 `/goal` 或 `/plan` 时不会再次读取这些浏览器文件。提示词复用提交 `requestId`；queue 或历史以同一 `rpcId` 被观察后，回显只退休一次。多个并发发送失败时，在用户编辑还原内容之前按提交顺序合并还原；命令提交保持冻结的 `submitting` 阶段。Detached attempt 持有附件 id，直到 admission 完成或 Session scope 销毁。回显以 observed 退休时，durable 图片缓存立即公开每个预览 URL，读取 admitted 附件后用规范化 URL 替换预览，并在各 URL 停止使用后撤销，同时释放文件卡。选中的通用文件进入同一个先进先出的后台上传队列；`maxConcurrentFileUploads` 默认允许两个 Worker transport 同时运行，Conversation 服务在切换 Session 时继续持有排队和运行中的传输操作及字节进度，移除草稿会跳过排队中的传输或中止正在运行的传输。continuable 子代理禁用附件入口，也不创建本地回显，因为其 transport 不保留浏览器 request id。

排队提交的本地回显在禁用的编辑、删除、插话按钮旁显示“发送中…”；折叠后的队列在标题栏保留发送状态。匹配的 Host 队列行替换回显后，各操作按原有的纯文本内容和运行状态要求启用。仅收到提示词确认不会启用队列操作。提交失败会移除回显并显示错误；输入框为空或仍保留上一次自动恢复的内容时，composer 恢复失败草稿，保留用户随后输入的文字。

Send 和 Stop 按钮禁用时不显示提示气泡，轮次结束后由 Stop 切换成禁用 Send 的按钮也遵循此规则。普通 composer 运行时，如果草稿为空或输入不可用，主指针操作保持为 Stop。可提交的文字或附件会把同一位置切换为 Send；清空或成功提交草稿后恢复 Stop。繁忙态 Enter 设置为普通 Session 与可继续 child 选择 Queue 或 Steer 投递，运行中的 Send 按钮按 plain Enter 解析出的同一模式投递；当它在普通消息草稿上可用（没有待上传文件）时，其标签以该模式命名（排队发送或插话发送），因此该设置同时约束 Enter 与按钮，而 Cmd/Ctrl+Enter 仍使用另一模式；空闲会话、空草稿与 `/` 命令行保留普通的 Send 标签（[决策](../../../.agents/notes/implemented/bug-fix/2026-09-04-busy-send-button-follows-enter-setting.zh.md)）。它们的 QueueDock 行共享 Edit、Remove 与 Steer，空草稿也共享 steer-all 组合键。One-shot child 继续只读。Plan Mode 与 active goal 不改变附件入口。可继续 child 保留独立的 Send 与 Stop 操作，但不提供「文件」菜单项、粘贴或拖放入口；parent 离线时，Send 与 composer 手势锁定，但在线 inbox 的 QueueDock 控制仍可使用（[决策](../../../.agents/notes/archived/bug-fix/2026-08-20-running-draft-primary-send.md)、[inbox 控制](../../../.agents/notes/implemented/feature/2026-08-27-continuable-subagent-human-inbox-control.zh.md)）。

文件标签和可编辑的 skill 引用共用覆盖整个引用的悬停背景，并跟随输入框的行高与文字基线。首次点击立即由已注册的引用来源负责打开预览，包括双击序列的第一次点击。后续点击保留原生文本选择行为；已有非折叠选区时，指针点击不打开预览。预览不改变草稿、剪贴板文本或提交内容。

当会话被其他写句柄占用时，发送失败的 toast 提示用户退出其他正在运行的 DSH 后重试。

<a id="temporary-composer-entries"></a>
## 临时 composer entry

`conversation.composer` 是通用 chain，其完整 owner currency 为：

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

业务包仅可在一个 Remote waterfall request pending 期间安装 entry：

```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

selector 必须是 owner currency 的纯函数。非 null 返回值作为 `matched` 传给组件；`PropsRuntime<'conversation.composer'>` 提供标准 Session 与 global props。Chain 顺序仍按 `priority` 升序，再按注册顺序；首个返回非 null 的 selector 获选。Shell 会在 takeover 下保持默认 composer 挂载。Request 状态、listener、response encoding 和任何 request-specific child slot 都属于业务 package，不进入 `SessionSnapshot`，也不由 core 包声明。

<a id="model-experience"></a>
## 模型体验

Host 入口贡献 `ui:custom-instructions` prompt section 与 `custom_instructions` prompt 变量：`ui-conversation` 设置命名空间的 `customInstructions` 字段（≤1500 字符，默认空）追加进每个模型步前组装的系统提示词末尾，因此常驻用户指令随每个 scope（含子智能体）的每次请求发送；空白或纯空格文本不产生内容。编辑即时生效：下一步组装读取已提交的值，循环的 system-prompt 投影记录变化后的文本。

#### KV Cache 影响

该 section 是提示词的最后一块，编辑仅使尾部后缀失效，此前各 section 的缓存前缀全部保留。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **只有已注册 target 可以渲染**——除已注册的 `chat` 偏好外，shell 刻意不提供隐式 fallback target。
- **Factory occurrence 继承渲染位置的 Session**——`conversation.content` 不接受独立寻址的 Session；该能力需要单独的 Session provider。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Conversation Definition、target builder 与 View 已由其所属注册表和 Slot ledger 校验。

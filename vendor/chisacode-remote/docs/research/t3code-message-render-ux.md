# T3 Code：发送消息与 AI 回复渲染的丝滑体验研究（代码级全景）

> 分支：`research/t3code-message-render-ux`  
> 对照源：本机 T3 Code Alpha `0.0.31`（commit `e6987965f659`），还原自  
> `apps/server/dist/client/assets/*.js.map`（web 客户端）与 `apps/server/dist/bin.mjs.map`（服务端）。  
> 对照对象：ChisaCode `packages/app`（composer / agent-stream / timeline / types/stream）+ `packages/server`。  
> 研究日期：2026-08-03。

## 0. 阅读地图

```
发送链路（T3）
  ComposerPromptEditor.tsx (Lexical 富文本)   →  ChatComposer.tsx (submit)   →  ChatView.tsx (onSend)
  → 乐观用户消息 + local dispatch             →  threadCommands.startTurn (WS)  →  服务端 decider
  → thread.message-sent 事件                  →  projector / threadReducer   →  UI 状态更新

渲染链路（T3）
  服务端 ProviderRuntimeIngestion (delta 缓冲) →  orchestration events
  → 客户端 makeEnvironmentThreadState (WS 订阅) →  threadReducer
  → session-logic (deriveTimelineEntries)     →  MessagesTimeline.logic (stable rows)
  → LegendList (虚拟化) + timelineScrollAnchoring (锚定滚动)  →  ChatMarkdown (流式)

ChisaCode 对应
  composer/submit + submission-controller + delivery-controller  →  session-context.sendAgentMessage
  → 乐观 user_message 进 agentStreamTail/Head
  → session-stream-reducers (seq 门控 + block promote)          →  agent-stream view (web/native)
```

---

## 1. 结论先行

T3 的“丝滑”由 **五层独立机制** 叠加，任意一层单独看都不是黑魔法，组合起来才形成体感：

1. **服务器端流式降频**：AI 文本增量在服务端缓冲（24KB 上限），批量以事件落库/下发，而不是逐 token 刷 UI。
2. **发送瞬间乐观态**：composer 立即清空 + 乐观用户消息立刻渲染 + 本地 busy 状态机与“服务器投影”对齐。
3. **新回合锚定滚动**：发送后用户消息钉在视口上沿，回复在其下方预留空间生长（不是简单贴底）。
4. **列表行稳定化**：行按 id 引用复用 + 完成回合折叠 + 局部 DOM 计时器，长流不整表重渲。
5. **流式 Markdown 成本控制**：react-markdown 全量重渲 + Shiki 高亮**只在流结束后缓存** + Suspense 降级。

与 ChisaCode 对照结论：

| 维度          | T3                           | Chisa                              | 差距                     |
| ------------- | ---------------------------- | ---------------------------------- | ------------------------ |
| 发送即时反馈  | 乐观消息 + busy 投影 ack     | 乐观消息（无 busy 投影 ack）       | 中                       |
| 发送后滚动    | **anchoring-new-turn 锚定**  | sticky-bottom 贴底                 | **高（最大体感差）**     |
| 流式 UI 成本  | 服务端缓冲 + 行稳定 + memo   | block promote + useDeferredValue   | 中（结构不同，各有千秋） |
| 回合噪声      | 完成回合折叠 + work-log 折叠 | 完整展开                           | 中                       |
| Markdown 能力 | react-markdown + Shiki       | RN markdown + HighlightedCodeBlock | 分平台（web 差）         |

**最大可借鉴点：新回合锚定滚动 + 服务端流式缓冲。**

---

## 2. 发送链路（T3 全栈代码）

### 2.1 编辑器：Lexical 富文本

`ComposerPromptEditor.tsx` 用 **Lexical**（`@lexical/react`），不是 textarea：

- `PlainTextPlugin` + 自定义内联 token 节点（path mention / skill / terminal context chip）
- 光标换算：折叠视图（token 占 1 字符）↔ 展开文本（`composer-logic.ts` 的 `collapseExpandedComposerCursor` / `expandCollapsedComposerCursor`）
- `detectComposerTrigger`：`/cmd`、`$skill`、`@path` 触发
- Enter 提交语义由 `shouldSubmitComposerOnEnter`（移动端例外）决定

Chisa 侧：`composer/input/`（textarea + height mirror），无富文本 token 模型 —— 这是编辑体验差距，但**不是丝滑的主因**。

### 2.2 提交闸门与乐观发送（核心）

`ChatView.tsx` `onSend` 关键顺序（还原行 4486–4838）：

```ts
// 1) 校验：isSendBusy / isConnecting / providerAvailable
// 2) (草稿 hero) runMobileComposerTransition + flushSync 先把 composer dock 进聊天
// 3) beginLocalDispatch({ preparingWorktree })   ← 本地“Sending”闸门
// 4) 生成 messageIdForSend / messageCreatedAt
// 5) 滚动：isAtEndRef=true; scrollMode="anchoring-new-turn";
//    pendingTimelineAnchorRef=messageIdForSend; setTimelineAnchor(...)
// 6) setOptimisticUserMessages([...existing, {id, role:"user", text, attachments: previewUrl}])
//    ← blob URL 附件立即可见
// 7) promptRef.current=""; clearComposerDraftContent; resetCursorState  ← 立即清输入框
// 8) 之后才异步：编码图片 → persistThreadSettingsForNextTurn → startThreadTurn RPC
```

要点：

- **网络往返不在关键路径上**：UI 反馈只依赖本地 state。
- 乐观消息与服务器消息合并：`displayMessages = serverMessages ∪ {optimistic 中 server 还没有的}`（按 id 去重），服务器回显后乐观条目自动退出。
- **blob URL 生命周期**：乐观消息的 `previewUrl` 在服务器消息带回真实附件时 `handoffAttachmentPreviews` 交接，未带回则 revoke，防内存泄漏。

### 2.3 LocalDispatch：busy 与服务器投影对齐

`ChatView.logic.ts`：

```ts
interface LocalDispatchSnapshot {
  startedAt; preparingWorktree;
  latestUserMessageId;
  latestTurnTurnId/requestedAt/startedAt/completedAt;
  sessionStatus/sessionUpdatedAt;
}
hasServerAcknowledgedLocalDispatch({localDispatch, phase, latestTurn,
  latestUserMessageId, session, hasPendingApproval, hasPendingUserInput, threadError})
```

判定规则：

- pending approval / user input / thread error → **立即结束 busy**（不卡死）
- `phase === "running"`（steer）：**只要 latest user message id 变了就 ack** —— 转向时 turn 时间戳可以不变
- 否则：latestTurn 或 session 状态变化 → ack

`isSendBusy = activeLocalDispatch !== null`，composer 全程禁用重复提交，直到服务端投影追上。

**Chisa 现状**：`composer/submit.ts` 提交时立即 clear draft，`isProcessing` 绑定 submit Promise 结束，**没有** “projection ack” 状态机。steer 排队走 `queueController`，但 busy 语义更弱。

### 2.4 RPC 与命令原子性

- 客户端：`threadCommands.ts` 的 `startTurn`（serial 并发、per-thread key）
- 服务端 `decider.ts` `thread.turn.start` **一个命令原子产出两个事件**：
  - `thread.message-sent`（role=user, streaming=false, 带 messageId/text/attachments）
  - `thread.turn-start-requested`（causationEventId 指向 message-sent）
- 附带生命周期重置：settled → unsettled（reason=activity）、snoozed → unsnoozed

也就是说**用户消息的持久化与 turn 开始是同一条事件流**，不存在“消息已发但 turn 未开始”的中间态窗口（这正是 `hasQueuedTurnStart` 在客户端/服务端都存在的边界：session 未 adoption 前的队列期）。

### 2.5 首条消息过渡（polish）

`draftHeroTransition.ts`：

- 移动端 `document.startViewTransition`，180ms `cubic-bezier(0.4,0,0.2,1)`
- 尊重 `prefers-reduced-motion`；`flushSync` 确保 hero → chat 布局切换与滚动锚定在同一帧完成
- 桌面端无此逻辑（回归普通发送）

---

## 3. 服务端流式数据面（丝滑的地基）

### 3.1 事件溯源：decider → projector → 客户端

服务端全部是 **事件溯源（ES）**：

```
thread.turn.start ──decider──► [thread.message-sent, thread.turn-start-requested]
provider runtime events ──decider──► thread.message-sent(assistant, streaming) / activity / session-set
projector ──► SQLite projections（threads/messages/turns/activities）
OrchestrationEngine.dispatch ──► WebSocket 推事件给客户端
```

### 3.2 关键：服务端 assistant delta 缓冲（`ProviderRuntimeIngestion`）

这是 T3 与 Chisa 架构上最不同的一点：

- `enableAssistantStreaming` 设置项，两种模式：
  - **buffered（默认？）**：`content.delta`（assistant_text）先 `appendBufferedAssistantText` 进内存缓存（`MAX_BUFFERED_ASSISTANT_CHARS = 24_000`），**不逐 token 发事件**。触发 flush 的时机：缓存超限（spill）、`request.opened`/`user-input.requested`（请求中途暂停）、`turn.completed`。
  - **streaming**：每个 delta 直接 dispatch `thread.message.assistant.delta`。
- `assistant.complete` 用空 delta + `streaming: false` 收尾，**服务端保证最终完整文本**。
- assistant 消息按 turn 维护“active segment”：同一 turn 的 delta 追加到同一 messageId，turn 内多条 assistant 文本（commentary between tools）各自成消息。

**体感效果**：默认 buffered 模式下客户端 UI 每 ~100ms 级别收到一次批量 delta 而不是每 token 一次 —— 流式时主线程远没有 Chisa 每 token 都进 reducer 的压力。

**Chisa 对照**：Chisa 的 daemon（`packages/server`）直接转发 provider stream deltas 到 `agent_stream`（无服务端缓冲），**把降频压力放在客户端**（`useDeferredValue` + block promote + `assistant-message-height-estimate`）。两种哲学：T3 服务端先聚合，Chisa 客户端消化。

### 3.3 projector 的 append-only 消息模型

`projector.ts` `thread.message-sent`：

- 新消息 append；同 id 消息存在时 **`streaming` 事件把 text 追加**（`${entry.text}${message.text}`），`streaming:false` 事件整体替换
- `messages.slice(-MAX_THREAD_MESSAGES)` 内存上限
- 客户端 `threadReducer.ts` 有同构实现（`applyThreadDetailEvent`）——**服务端/客户端双份 reducer 保证事件同序应用**

### 3.4 客户端订阅状态机（`client-runtime/state/threads.ts`）

`makeEnvironmentThreadState`：

- `SubscriptionRef<EnvironmentThreadState>`（data/status/error）
- WS `subscribeThread`：带 `afterSequence` 续传游标；支持 `requestCompletionMarker`
- 首帧：HTTP snapshot（`threadSnapshotHttp`）兜底，之后走事件流
- **持久化策略**：`shouldPersistThread` 只持久化非 starting/running 的线程；`Stream.debounce("500 millis")` 批量落盘 —— **活跃流式路径上不做缓存编码**
- 状态机：empty → synchronizing → live / disconnected / error，`THREAD_STATE_IDLE_TTL_MS` 空闲回收

**Chisa 对照**：`timeline-sync-plan.ts` + `session-stream-reducers.ts` 的 tail/head 模型同样有 cursor/epoch/seq 门控与 catch-up，但 Chisa 是 **tail/head 分离**（canonical 历史 + live head），T3 是**单条事件流续传**。Chisa 的 head/tail 分离对“历史与 live 同时显示”更灵活；T3 的事件流对“多设备续传”更简单。

---

## 4. 渲染链路（T3 全栈代码）

### 4.1 session-logic：派生中间层

`session-logic.ts`（41KB，纯函数）：

- `derivePhase`（loading/syncing/running/…）
- `deriveTimelineEntries`：messages + proposedPlans + workLog 合并成统一 timeline
- `deriveWorkLogEntries`：tool activity 按工具名折叠（`collapseDerivedWorkLogEntries`），失败/成功/中性分类
- `derivePendingApprovals` / `derivePendingUserInputs` / `deriveActivePlanState`
- 全组件 `memo` + 派生函数输入稳定 → 下游 useMemo 依赖稳定

### 4.2 行派生与稳定化（`MessagesTimeline.logic.ts`）

- `deriveMessagesTimelineRows`：timeline → 行数组（message / work / work-toggle / turn-fold / proposed-plan / working）
- **turn-fold**：已完成回合的工具噪声折进 “Worked for …” 行，**终端 assistant 文本保留**；unsettled 判定优先 runningTurnId，防 send 后旧 turn 折叠闪烁
- **work-log 折叠**：`MAX_VISIBLE_WORK_LOG_ENTRIES = 1`，超出折叠成 “+N” 展开行
- `computeStableMessagesTimelineRows`：按 id 浅比较，未变字段**复用上一帧对象引用**（`isRowUnchanged` 每变体手写字段比较），React 免 diff 整棵子树

### 4.3 LegendList 配置（`MessagesTimeline.tsx`）

```tsx
<LegendList
  data={rows} keyExtractor={item.id} getItemType={...}
  estimatedItemSize={90} initialScrollAtEnd
  {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
  contentInsetEndAdjustment={composerOverlayHeight}   // composer 高度进可用视口
  maintainScrollAtEnd={anchoredEndSpace ? false : {animated:false, on:{dataChange:true,itemLayout:true,layout:true}}}
  maintainVisibleContentPosition={{ data:true, size:false }}
  renderItem={useCallback(..., [])}                    // 无闭包依赖，行组件从 Context 读共享状态
/>
```

- `anchoredEndSpace`：来自 `resolveChatListAnchoredEndSpace`（anchor message 之后预留空间，offset 16px）
- `renderItem` 零依赖 + `TimelineRowCtx` 传播 → LegendList memo 边界内行组件不重渲
- `maintainScrollAtEnd` 与 anchoredEndSpace 互斥切换
- 行内组件自订阅：`WorkingTimer` 每秒 **直接改 textContent**（不 setState，避免整表 commit）

### 4.4 新回合锚定滚动（核心丝滑机制）

`timelineScrollAnchoring.ts` 三模式：

```ts
type TimelineScrollMode = "following-end" | "anchoring-new-turn" | "free-scrolling";
```

发送时（`ChatView.tsx`）：

```ts
isAtEndRef.current = true;
timelineScrollModeRef.current = "anchoring-new-turn";
pendingTimelineAnchorRef.current = messageIdForSend;
setTimelineAnchor({ threadKey, messageId });
```

随后 rAF 双帧后读 LegendList metrics：

```ts
if (mode === "anchoring-new-turn") {
  const metrics = getAnchoredTurnMetrics(list); // anchorTop/lastBottom/turnHeight/
  // usableViewportHeight(含 composer)/scrollDeltaToRevealEnd
  if (metrics.scrollDeltaToRevealEnd <= 1) return;
  list.scrollToOffset({ offset: current + metrics.scrollDeltaToRevealEnd, animated: false });
}
```

行为：

1. 用户消息钉在视口上沿附近（`CHAT_LIST_ANCHOR_OFFSET=16`）
2. AI 回复在其下方预留空间生长，**不立刻甩出用户消息**
3. 长回复时逐步补 scroll，露出回复末端即停
4. 用户明显上滑（≥24px）→ `free-scrolling`，显示 “Scroll to end” pill
5. 回到底部 → `following-end`

`onIsAtEndChange` 还维护 `userScrollGeneration`：区分自动 follow 与用户手动导航，防 markdown 块变高把视口拽飞（anchor size 变化时若用户未动则恢复 offset）。

**Chisa 对照**：`bottom-anchor-controller.ts` 是成熟的 sticky-bottom 状态机（route confirm、verification retry、rAF delay、24px detach），但语义是**追底部**。发送后 `scrollToBottom("message-sent")` 把用户消息贴底 —— 正确但阅读姿势是“terminal log”而非“对话”。

### 4.5 ChatMarkdown（流式成本控制）

`ChatMarkdown.tsx`（1.6KB 源码 → 实际 1662 行还原）：

- `react-markdown` + remark: `remark-gfm` / `remarkNormalizeListItemIndentation` / `remarkPreserveCodeMeta` / `remarkTagInlineCode`
- rehype: `rehype-raw` + `rehype-sanitize`（协议允许 `file:`）
- 代码块：`@pierre/diffs` 共享 Shiki highlighter
  - `SuspenseShikiCodeBlock`：**`isStreaming` 时跳过缓存读取**（`cachedHighlightedHtml = !isStreaming ? cache.get(key) : null`），也**不写入缓存**（防半截 fence 缓存）
  - 结束后才 `highlightedCodeCache.set`（LRU 500 条 / 50MB）
  - Suspense fallback = 纯 `<pre>`；错误边界降级
- 文件路径 → chip（basename + 消歧父路径 + 行号），inline code 命中文件也转 chip
- 表格、`details`、外链 favicon、复制时重序列化为 markdown（`markdown-clipboard.ts`）
- 组件整体 `memo`；link/代码块组件各自 memo + 手写 props 比较

**Chisa 对照**：

- RN：`components/markdown/renderer.tsx`（react-native-markdown-display）+ `splitMarkdownBlocks` + `useDeferredValue` + `HighlightedCodeBlock`（shiki）—— 流式基础扎实
- Web/Electron：同样走 RN 渲染路径（`message.tsx` 是跨端组件），**没有** react-markdown 级别的表现力（表格/详情/路径 chip/外链 favicon 缺失）
- 流式高亮缓存：Chisa `message.tsx` 按 block key 渲染，代码块变高会触发高度估计缓存 —— 与 T3 的“流式期间不高亮缓存”策略不同，值得对齐

---

## 5. ChisaCode 现状盘点（对照结论）

### 5.1 发送链路（已具备）

| 能力                  | 位置                                                                         | 状态                             |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| 提交立即清草稿        | `composer/submit.ts`                                                         | ✅                               |
| 乐观用户消息          | `session-context.tsx` `sendAgentMessage`                                     | ✅（tail/head 分流）             |
| 乐观与 canonical 对账 | `timeline/session-stream-reducers.ts` `reconcileOptimisticUsersAfterReplace` | ✅                               |
| agent running 时排队  | `composer/queue-controller.ts` + `submit.ts`（queued 分支）                  | ✅                               |
| 失败恢复草稿          | `submit.ts` catch → 回填                                                     | ✅                               |
| busy 与服务器投影对齐 | —                                                                            | ❌ 缺（isProcessing 绑 Promise） |

### 5.2 渲染链路（已具备）

| 能力                     | 位置                                                                            | 状态                          |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------- |
| 流事件批处理             | `processAgentStreamEvents`                                                      | ✅                            |
| 完成 markdown 块 promote | `types/stream.ts` `promoteCompletedAssistantBlocks`                             | ✅（比 T3 更细粒度）          |
| 流式 markdown 降频       | `message.tsx` `useDeferredValue`                                                | ✅                            |
| Web 虚拟化               | `agent-stream/strategy-web.tsx`（tanstack virtual）                             | ✅                            |
| Native 倒序 FlatList     | `agent-stream/strategy-native.tsx`（inverted + maintainVisibleContentPosition） | ✅                            |
| 底部锚定状态机           | `agent-stream/bottom-anchor-controller.ts`                                      | ✅（sticky 语义）             |
| 高度估计缓存             | `assistant-message-height-estimate.ts`                                          | ✅                            |
| 回合折叠 / work-log 折叠 | —                                                                               | ❌ 缺（工具行全展开）         |
| 行引用稳定化             | —                                                                               | ❌ 缺（流式重渲靠 memo 兜底） |

---

## 6. 差距与可借鉴优先级

### P0 — 新回合锚定滚动（体感跃迁最大）

发送后用户消息停在视口上方、回复向下生长，用户上滑进入 free 模式。

建议：

1. 在 `bottom-anchor-controller` 旁引入 `TimelineScrollMode`（sticky-bottom | anchoring-new-turn | free-scrolling），或扩展 BottomAnchorMode
2. send 时记录 anchor user message id + composer 高度（已有 `handleComposerHeightChange`）
3. `strategy-web`/`strategy-native` 增加 anchor follow：只补 `scrollDeltaToRevealEnd`
4. 几何计算纯函数化 + 单测（T3 `getAnchoredTurnMetrics` / `resolveChatListAnchoredEndSpace` 可直接参考）

**不要**整搬 LegendList；Chisa 已有 web/native 两套 strategy。

### P1 — 服务端流式缓冲（可选，需权衡）

T3 在服务端聚合 delta（24KB 缓冲），Chisa 在客户端消化（block promote）。

- Chisa 的 block promote 已经解决“长流整段重渲”，且移动端无法依赖服务端缓冲粒度（弱网更糟）
- **低优先级**：仅当客户端出现 jank 证据再考虑。可先加 server 侧 `sendAgentMessage` 的 delta 微批（≤50ms 聚合），用协议扩展做，不破坏现有 seq 门控

### P2 — Send busy / projection ack

把 `isProcessing` 从 Promise 结束改为：乐观消息 id 出现在 canonical tail、或出现 pending permission / send error → 结束 busy。

- 现有 `reconcileOptimisticUsersAfterReplace` 已能在 canonical 中识别同 id 用户消息，加一个 `hasServerAdoptedOptimisticUserMessage` 派生即可
- 单测：steer（running 中发消息）、失败回填、permission interrupt

### P3 — 回合折叠 + work-log 折叠

已完成 turn 的工具/思考折进 “Worked for …”，保留终端 assistant 文本；工具组超 1 条折叠。

- 在 `agent-stream/model.ts` 或布局层做（纯函数 + 单测）
- 与现有 tool sequence spacing / Soft 阅读列兼容
- 注意：Chisa 的 head/tail 模型里“完成 turn”的判定用 `turn_completed`/`turn_failed` 事件即可

### P4 — Web markdown 表现力（分平台）

Web/Electron 上给 assistant 文本用更强的渲染（路径 chip、表格、详情、外链 favicon），RN 保持现状。

- 不要整棵绑定 react-markdown（跨端约束）
- 流式期间禁止把半截 fence 写入高亮缓存（对齐 T3 策略，若 Chisa 未严格保证）

### P5 — 行引用稳定化（低优先）

在 `agent-stream` 布局层引入按 id 的稳定行对象（引用相等复用），可让 `memo` 之外进一步减渲。T3 `computeStableMessagesTimelineRows` 可直接参考。

---

## 7. 明确不建议照搬

1. **Lexical 编辑器** —— 迁移成本高，与 Chisa 移动端 textarea 体系冲突；编辑丝滑不是当前主差距
2. **LegendList 替换现有 strategy** —— 成本高，native 要第二套
3. **Effect + Atom + SubscriptionRef 状态栈** —— 与 Chisa session store / protocol 模型不兼容
4. **服务端 ES 重写** —— Chisa daemon 已是事件流（agent_stream），不需要 decider/projector
5. **放弃 block promote 迁回“整条消息重渲”** —— T3 的渲染方式是整条 assistant 消息持续 streaming 重渲（依赖服务端缓冲 + memo），Chisa 的 head/tail + promote 对长流更可控，应保留

---

## 8. 建议落地切片（若开工）

| 切片 | 内容                                                                           | 风险               |
| ---- | ------------------------------------------------------------------------------ | ------------------ |
| A    | `getAnchoredTurnMetrics` / `resolveChatListAnchoredEndSpace` 纯函数移植 + 单测 | 0 UI               |
| B    | send → anchoring-new-turn（先 web）                                            | 中（滚动回归测试） |
| C    | projection ack busy 状态机                                                     | 低                 |
| D    | 完成 turn / work-log 折叠（纯函数）                                            | 低                 |
| E    | web 端 markdown 表现力 + 流式高亮缓存策略                                      | 中（分平台）       |

---

## 9. 源码摘录索引（本地研究缓存，未提交）

```
.tmp/t3-research/core/            # 关键还原文件（ChatView/ChatComposer/MessagesTimeline/ChatMarkdown/...）
.tmp/t3-research/runtime/         # client-runtime（threads.ts/threadReducer/threadCommands/...）
.tmp/t3-research/server/          # 服务端（decider/projector/ProviderRuntimeIngestion/ws.ts）
.tmp/t3-research/full/            # 更广的 chat 相关源文件
.tmp/t3-research/deep/            # send/scroll/markdown 片段
.tmp/t3-research/snippets/        # 关键字聚类
```

重点文件：

- 发送：`core/ChatView.tsx`（onSend 4486+）、`core/ChatView.logic.ts`（LocalDispatch）、`runtime/threadCommands.ts`
- 服务端：`server/_up_src__orchestration__decider.ts`（turn.start 713+）、`server/_up_src__orchestration__Layers__ProviderRuntimeIngestion.ts`（缓冲 882+）
- 滚动：`core/timelineScrollAnchoring.ts`、`core/MessagesTimeline.tsx`（LegendList 487+）
- 渲染：`core/MessagesTimeline.logic.ts`（stable rows 577+）、`core/ChatMarkdown.tsx`（SuspenseShikiCodeBlock 694+）

---

## 10. 一句话决策

> **ChisaCode 的数据面（乐观 user、tail/head、block promote、bottom-anchor verification）已经扎实；要追上 T3 的“对话丝滑感”，下一刀应打在「新回合锚定滚动 + send projection busy」上；服务端流式缓冲可作为后续性能优化，但不该阻止前端先行。**

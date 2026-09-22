# T3 Code 消息发送 / AI 回复渲染丝滑体验移植计划

> 分支：`research/t3code-message-render-ux`  
> 依据：`docs/research/t3code-message-render-ux.md`（代码级全景研究）  
> 目标：把 T3 的「发送即时反馈 + 新回合锚定滚动 + 流式低成本渲染」体感移植进 ChisaCode，  
> 同时不破坏 ChisaCode 已有的 head/tail block promote、bottom-anchor verification 等成熟机制。  
> 状态：**待开工**（计划评审中）

---

## 0. 背景与目标

### 0.1 研究结论回顾

T3 丝滑 = 五层机制叠加：

1. **服务端流式降频**（`ProviderRuntimeIngestion` 24KB delta 缓冲批量下发）
2. **发送瞬间乐观态**（立即清 composer + 乐观用户消息 + LocalDispatch busy 投影 ack）
3. **新回合锚定滚动**（`anchoring-new-turn`：用户消息钉在视口上沿，回复向下生长）
4. **列表行稳定化**（行引用复用 + 回合/work-log 折叠 + 局部 DOM 计时器）
5. **流式 Markdown 成本控制**（react-markdown + Shiki 流式期间不缓存 + Suspense 降级）

ChisaCode 已有（不重复做）：乐观用户消息、tail/head 对账、block promote、useDeferredValue、
bottom-anchor 状态机、web/native 双 strategy、高度估计缓存。

### 0.2 目标（本次要做的）

| 优先级 | 内容                                                | 体感收益                 |
| ------ | --------------------------------------------------- | ------------------------ |
| **P0** | 新回合锚定滚动（发送后不贴底，回复在下方生长）      | 最大                     |
| **P1** | Send projection ack busy（发送中防连点、防卡 busy） | 大                       |
| **P2** | 完成回合 / work-log 折叠（长会话噪声降低）          | 中                       |
| **P3** | Web markdown 表现力 + 流式高亮缓存策略              | 中（分平台）             |
| **P4** | 服务端 delta 微批（可选，视性能证据）               | 低（Chisa 客户端已消化） |

### 0.3 非目标（明确不做）

- 不整搬 Lexical 编辑器（textarea 体系保留）
- 不换 LegendList / tanstack virtual / FlatList
- 不引入 Effect/Atom 状态栈
- 不做服务端事件溯源（daemon 已是事件流）
- 不放弃 block promote（T3 整条消息重渲方案更差，仅借其"流式不写高亮缓存"策略）

---

## 1. 总体架构决策

### 1.1 滚动模型扩展（不推翻现有 bottom-anchor）

现有 `bottom-anchor-controller.ts` 只有 `sticky-bottom | detached` 两态，且带成熟的
verification/retry 状态机与 20+ 测试。**不在它内部加第三种模式**（风险大），而是：

- 新增**独立的** `turn-anchor-controller.ts`（纯逻辑，可单测）
- 与 `bottom-anchor-controller` 并行存在，由 agent-panel 按"是否有 pending turn anchor"二选一驱动
- 语义映射：`following-end` ≙ sticky-bottom；`free-scrolling` ≙ detached；`anchoring-new-turn` 为新增

### 1.2 数据流（发送路径）

```
composer submit → session-context.sendAgentMessage(生成 optimistic user_message + messageId)
  → agent-panel 记录 pendingSendAnchor = { messageId }
  → streamView.requestTurnAnchor({ messageId })
  → turn-anchor-controller: mode = anchoring-new-turn
  → 流式回复到达 → turn-anchor 模式只补 scrollDeltaToRevealEnd
  → 用户上滑 ≥24px → free-scrolling（显示 jump-to-bottom）
  → 回底 / 新发送 → 重新锚定
```

### 1.3 数据流（渲染路径）

```
StreamItem[] → model.buildAgentStreamRenderModel → layout.layoutStream
  → view.tsx（新增：turn anchor 请求透传 + 折叠展开态）
  → strategy-web / strategy-native（新增：anchor follow 几何）
```

---

## 2. 切片总览与依赖

```
Slice A（几何纯函数）─────────┐
                              ├─► Slice B（web 锚定滚动）──► 验收（web 真实验证）
Slice C（projection ack）─────┘
Slice D（回合/work-log 折叠）────────► Slice E（web markdown）──► 验收
Slice F（服务端微批，可选）──────────► 视证据决定
```

- A → B 硬依赖（B 的几何计算来自 A）
- C 独立，可与 B 并行
- D 独立，E 依赖 D 的折叠行渲染结构（弱依赖，可并行）
- F 最后，且需要先做性能采样证明 jank

---

## 3. Slice A — 锚定滚动几何纯函数

**目标**：0 UI 风险地把 T3 的 `getAnchoredTurnMetrics` / `resolveChatListAnchoredEndSpace` 移植为
ChisaCode 纯函数，全量单测覆盖边界。

### 3.1 新文件

`packages/app/src/agent-stream/turn-anchor-metrics.ts`

```ts
export type TurnAnchorScrollMode = "following-end" | "anchoring-new-turn" | "free-scrolling";

export interface TurnAnchorMeasurementState {
  readonly data: readonly unknown[];
  readonly scroll: number;
  readonly scrollLength: number;
  readonly positionAtIndex: (index: number) => number | undefined;
  readonly sizeAtIndex: (index: number) => number | undefined;
}

export interface AnchoredTurnMetrics {
  readonly anchorTop: number;
  readonly lastBottom: number;
  readonly turnHeight: number;
  readonly usableViewportHeight: number;
  readonly overflowsUsableViewport: boolean;
  readonly targetScrollToRevealEnd: number;
  readonly scrollDeltaToRevealEnd: number;
}

export const TURN_ANCHOR_OFFSET_PX = 16;

export function getRowBottom(state: TurnAnchorMeasurementState, index: number): number | null;
export function getAnchoredTurnMetrics(input: {
  state: TurnAnchorMeasurementState;
  anchorIndex: number;
  composerOverlayHeight: number; // 与 agent-panel 现有 handleComposerHeightChange 对接
  anchorOffset?: number; // 默认 TURN_ANCHOR_OFFSET_PX
}): AnchoredTurnMetrics | null;

export function resolveTurnAnchoredEndSpace<Item, AnchorId>(
  items: ReadonlyArray<Item>,
  anchorId: AnchorId | null,
  getAnchorId: (item: Item) => AnchorId | null,
  options?: { anchorOffset?: number },
): { anchorIndex: number; anchorOffset: number } | undefined;
```

### 3.2 实现要点（照搬 T3 语义，适配 Chisa 类型）

- `getRowBottom`：`top + Math.max(1, height)`，非有限数返回 null
- `getAnchoredTurnMetrics`：
  - anchorIndex 夹取 `[0, data.length-1]`
  - `usableViewportHeight = max(0, scrollLength - composerOverlayHeight - anchorOffset)`
  - `turnHeight = lastBottom - anchorTop`；`overflows = turnHeight > usableViewportHeight`
  - `scrollDeltaToRevealEnd = max(0, target - scroll)`，`target = max(0, lastBottom - usableViewportHeight)`
- `resolveTurnAnchoredEndSpace`：从尾部反向找 anchorId，返回 index + offset

### 3.3 测试

`packages/app/src/agent-stream/turn-anchor-metrics.test.ts`（纯函数，无 JSDOM）：

| #   | 场景                                  | 断言                                                        |
| --- | ------------------------------------- | ----------------------------------------------------------- |
| 1   | 空列表                                | `getAnchoredTurnMetrics` 返回 null                          |
| 2   | anchorIndex 越界（负数 / 超长）       | 夹取到边界，不抛                                            |
| 3   | positionAtIndex 返回 undefined / NaN  | 返回 null                                                   |
| 4   | turn 不溢出可用视口                   | `overflowsUsableViewport=false`，`scrollDeltaToRevealEnd=0` |
| 5   | turn 溢出 + composer 高度变化         | delta 随 composerOverlayHeight 增大而增大                   |
| 6   | anchorOffset 默认 16                  | 与 T3 `CHAT_LIST_ANCHOR_OFFSET` 一致                        |
| 7   | resolveTurnAnchoredEndSpace 找 anchor | 返回正确 index；找不到返回 undefined；空数组返回 undefined  |
| 8   | lastBottom < anchorTop（异常数据）    | 不抛，返回 null 或 0 delta（明确契约）                      |

### 3.4 验收

- `npx vitest run packages/app/src/agent-stream/turn-anchor-metrics.test.ts --bail=1` 全绿
- `npm run lint -- packages/app/src/agent-stream/turn-anchor-metrics.ts`
- App typecheck 通过
- 无任何 UI 文件改动

---

## 4. Slice B — 新回合锚定滚动（web 先行）

**目标**：发送消息后，用户消息停在视口上沿附近，回复在其下方预留空间生长；
用户上滑进入 free-scrolling；回到底部恢复跟随。**先 web，native 保持现有 sticky 语义**（
inverted FlatList + maintainVisibleContentPosition 已解决底部稳定，anchor 语义不同且风险高）。

### 4.1 新文件

`packages/app/src/agent-stream/turn-anchor-controller.ts`

```ts
export interface TurnAnchorRequest {
  reason: "message-sent" | "jump-to-end";
  anchorMessageId: string | null; // optimistic user message id
  requestKey: string;
}

export type TurnAnchorMode = "following-end" | "anchoring-new-turn" | "free-scrolling";

export interface TurnAnchorControllerDriver {
  destroy(): void;
  getSnapshot(): { mode: TurnAnchorMode; pendingAnchorMessageId: string | null };
  applySendAnchor(request: TurnAnchorRequest | null): void;
  detachByUser(): void; // 上滑 ≥ 24px
  handleContentSizeChange(params: { previousContentHeight: number; contentHeight: number }): void;
  handleScrollNearBottomChange(params: { nextIsNearBottom: boolean; scrollDelta: number }): void;
  reevaluate(): void;
}

export function createTurnAnchorControllerDriver(input: {
  getMeasurementState: () => {
    data: readonly unknown[];
    scroll: number;
    scrollLength: number;
    positionAtIndex: (index: number) => number | undefined;
    sizeAtIndex: (index: number) => number | undefined;
    composerOverlayHeight: number;
  };
  isNearBottom: () => boolean;
  scrollByDelta: (delta: number) => void; // 非动画补 scroll
  onModeChange: (mode: TurnAnchorMode) => void;
  scheduleFrame: (cb: () => void) => unknown;
  cancelFrame: (handle: unknown) => void;
}): TurnAnchorControllerDriver;

export const TURN_ANCHOR_USER_SCROLL_AWAY_DELTA_PX = 24; // 与 bottom-anchor 一致
export const TURN_ANCHOR_POSITION_ATTEMPT_MAX = 12; // T3 positionAnchor 重试次数
```

状态机：

```
(发送) applySendAnchor → anchoring-new-turn（pending anchor = optimistic messageId）
  ── rAF 双帧后读 metrics：scrollDeltaToRevealEnd ≤ 1 → 不动；否则 scrollByDelta
  ── 锚点行未测出（positionAtIndex undefined）→ 下一帧重试（最多 12 次）
(contentSizeChange) anchoring-new-turn → 重新算 delta，只补新露出部分
(user 上滑 ≥24px) → free-scrolling（等同 detached，显示 jump-to-bottom）
(isNearBottom 且无 pending anchor) → following-end
```

### 4.2 修改文件

**`packages/app/src/agent-stream/strategy.ts`**

```ts
export interface StreamViewportHandle {
  scrollToBottom: (reason?: BottomAnchorLocalRequest["reason"]) => void;
  prepareForViewportChange: () => void;
  // 新增：
  requestTurnAnchor: (request: TurnAnchorRequest) => void;
}

export interface StreamRenderInput {
  // 新增：
  turnAnchorRequest: TurnAnchorRequest | null;
  isTurnAnchorEnabled: boolean; // web only；native 传 false
}
```

**`packages/app/src/agent-stream/strategy-web.tsx`**（`WebStreamViewport`）

- 接收 `turnAnchorRequest`，挂 `useTurnAnchorController`（类似现有 bottom-anchor 挂法）
- contentRef/scrollContainer 的 ResizeObserver 已存在（`scheduleStickToBottom` 旁），
  增加 turn-anchor 分支：`anchorTurn` 模式不再无条件 `scrollToBottom`
- wheel/touch 上滑手势已存在（`pendingUserScrollUpIntentRef`），复用：上滑时调用
  `turnAnchorController.detachByUser()`
- scroll 事件 `isNearBottom` 变化 → 通知 turn-anchor（回底切 following-end）

**`packages/app/src/agent-stream/strategy-native.tsx`**

- `requestTurnAnchor` 实现为 no-op 或直接 `scrollToBottom("message-sent")`（保持现状），
  明确注释 native 不做 anchor 语义

**`packages/app/src/agent-stream/view.tsx`**

- `AgentStreamViewHandle` 增加 `requestTurnAnchor`
- 内部转发给 strategy render（`turnAnchorRequest` prop）

**`packages/app/src/panels/agent-panel.tsx`**

```ts
// handleMessageSent 改为：
const handleMessageSent = useCallback(() => {
  const anchorId = 最近一条 optimistic user_message 的 id（从 store tail/head 取，未 canonical 化）；
  streamViewRef.current?.requestTurnAnchor({
    reason: "message-sent",
    anchorMessageId: anchorId,
    requestKey: `${agentId}:${anchorId ?? "jump"}`,
  });
}, [agentId]);
```

### 4.3 测试

**`turn-anchor-controller.test.ts`**（纯逻辑，mock scheduleFrame/scrollByDelta）：

| #   | 场景                                      | 断言                               |
| --- | ----------------------------------------- | ---------------------------------- |
| 1   | applySendAnchor → mode=anchoring-new-turn | 快照正确                           |
| 2   | delta ≤ 1                                 | 不调 scrollByDelta                 |
| 3   | 锚点行未测出（undefined）                 | 下一帧重试，attempt 计数增长       |
| 4   | 12 次未测出                               | 放弃（不再调度），模式保持         |
| 5   | 用户上滑 ≥24px                            | mode=free-scrolling                |
| 6   | 上滑 <24px                                | 不脱离                             |
| 7   | isNearBottom 变化                         | following-end 恢复                 |
| 8   | composer 高度进可用视口                   | delta 计算含 composerOverlayHeight |
| 9   | 重复 applySendAnchor（同 requestKey）     | 去重，不重复调度                   |

**`strategy-web.test.tsx`** 追加：

- `requestTurnAnchor` 挂载后 `data-testid` 容器不出现 `scrollToBottom` 调用
- anchor 模式下内容增长只产生 delta 滚动（mock `scrollTo` 断言偏移）

**现有回归**：`bottom-anchor-controller.test.ts`、`web-virtualization.test.ts`、`strategy-native` 相关测试全绿（不触碰）

### 4.4 验收（web 真实验证，不代替 desktop/native）

1. Playwright 定向 spec（新增 `packages/app/e2e/turn-anchor.spec.ts`，只跑这一个）：
   - 打开会话 → 发送消息 → 断言乐观用户消息在视口上半区（`getBoundingClientRect().top < viewport/2`）
   - 流式回复到达 → 用户消息仍可见（不在视口外）
   - 用户上滑 → 出现 jump-to-bottom；点击回底 → 恢复跟随
2. `npm run typecheck`（app）+ `npm run lint -- <改动文件>` + 聚焦 vitest 全绿
3. 无 native 回归（native 代码零行为变化）

---

## 5. Slice C — Send projection ack busy

**目标**：composer 的 "Sending" busy 从"submit Promise 结束"改为"服务器投影已收下这条消息"，
防连点、防卡死（T3 `hasServerAcknowledgedLocalDispatch` 语义）。

### 5.1 纯函数（新导出）

**`packages/app/src/timeline/session-stream-reducers.ts`** 追加导出：

```ts
export interface SendProjectionAckInput {
  readonly optimisticMessageId: string | null;
  readonly tail: readonly StreamItem[];
  readonly head: readonly StreamItem[];
}

/**
 * 服务器是否已投影（canonical 化）一条乐观用户消息。
 * 在 tail 或 head 中找到同 id 且非 optimistic 的 user_message 即视为 ack。
 */
export function hasServerAdoptedOptimisticUserMessage(input: SendProjectionAckInput): boolean;
```

实现：遍历 `tail + head`，找 `kind === "user_message" && id === optimisticMessageId &&
!optimistic`。注意与现有 `reconcileOptimisticUsersAfterReplace` 的关系：该函数在 tail
替换时把乐观内容合并进 canonical，**同 id canonical 出现时乐观条目即被吸收** ——
所以"canonical 中出现同 id"就是 ack 信号，与 T3 的 `latestUserMessageId` 投影一致。

### 5.2 接线（composer / agent-panel）

**`packages/app/src/panels/agent-panel.tsx`**（或 composer 侧新 hook）：

```ts
// 发送时（delivery-controller.submitMessage 成功回调后）：
const [pendingSendMessageId, setPendingSendMessageId] = useState<string | null>(null);

// selector：从 session store 取 tail+head（已有 streamItems selector）
const serverAdopted = useMemo(
  () =>
    hasServerAdoptedOptimisticUserMessage({
      optimisticMessageId: pendingSendMessageId,
      tail: streamItems, // 当前尾
      head: streamHeadItems, // 当前 head
    }),
  [pendingSendMessageId, streamItems, streamHeadItems],
);

const isSendBusy = isProcessing && !serverAdopted;
```

- 传给 composer 的 `isProcessing` / 或新 prop `isSendBusy`，用于禁发与按钮文案
- 失败路径：send error 出现 → 清 pendingSendMessageId（结束 busy）
- permission interrupt / pending permission 出现 → 同样结束 busy（T3 规则）
- **注意**：现 `submit.ts` 的 `isProcessing` 绑定 Promise；**不改 submit.ts 的通用契约**，
  只在 agent-panel/composer 装配层叠加 projection ack

### 5.3 测试

**`session-stream-reducers.test.ts`** 追加：

| #   | 场景                                      | 断言   |
| --- | ----------------------------------------- | ------ |
| 1   | tail 无该 id                              | false  |
| 2   | tail 有同 id 且 optimistic:true           | false  |
| 3   | tail 有同 id 非 optimistic                | true   |
| 4   | head 有同 id 非 optimistic                | true   |
| 5   | 既有 optimistic 对账测试（tail 替换吸收） | 不回归 |

**composer 装配层测试**（如 `agent-panel` 或新 hook 单测，纯函数抽取）：

| #   | 场景                           | 断言               |
| --- | ------------------------------ | ------------------ |
| 6   | send error → busy 结束         | pending 清空       |
| 7   | pending permission → busy 结束 | pending 清空       |
| 8   | canonical 出现 → busy 结束     | serverAdopted=true |
| 9   | steer（running 中发送）        | 走同一条 ack 路径  |

### 5.4 验收

- 聚焦 vitest 全绿；typecheck / lint 通过
- web 手动验证：快速连按发送只发一条；发送中按钮显示 busy；失败后 busy 释放并可重发

---

## 6. Slice D — 完成回合 / work-log 折叠（纯函数）

**目标**：已完成 turn 的工具调用/思考折叠进 "Worked for …" 行（保留最终 assistant 文本），
工具组超 N 条折叠为 "+N"（T3 `MAX_VISIBLE_WORK_LOG_ENTRIES = 1` 语义）。

### 6.1 新文件

`packages/app/src/agent-stream/turn-fold.ts`

```ts
export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;

export interface TurnFoldState {
  readonly turnId: string;
  readonly anchorEntryId: string;
  readonly hiddenEntryIds: ReadonlySet<string>;
  readonly label: string;
  readonly expanded: boolean;
}

export interface TurnFoldInput {
  readonly items: readonly StreamItem[]; // tail + head 的渲染序（与 layout 同源）
  readonly latestCompletedTurnId: string | null; // 来自 agent.status/turn 生命周期
  readonly runningTurnId: string | null;
  readonly expandedTurnIds: ReadonlySet<string>;
  readonly expandedWorkGroupIds: ReadonlySet<string>;
}

export function deriveTurnFolds(input: TurnFoldInput): ReadonlyMap<string, TurnFoldState>;
export function deriveWorkLogCollapse(input: {
  toolEntries: readonly StreamItem[];
  expanded: boolean;
}): { visibleEntries: readonly StreamItem[]; hiddenCount: number };
```

语义（照 T3 但适配 StreamItem）：

- 判定"完成回合"：以 `turn_completed` / `turn_failed` 事件后的 turnId 为准；
  runningTurnId 存在时不折叠（防发送后旧 turn 闪烁 —— T3 `deriveUnsettledTurnId`）
- 折叠范围：该 turn 内的 `tool_call` / `thought` 行；`assistant_message` 终端文本保留
- work-log 折叠：同工具名合并 + 超 1 条折叠（T3 `collapseDerivedWorkLogEntries` 简化版）

### 6.2 接线

- **`packages/app/src/agent-stream/model.ts`**：`buildAgentStreamRenderModel` 输出增加
  `turnFolds` / `workLogCollapse` 派生结果（或 view.tsx 用 `useMemo` 消费纯函数）
- **`packages/app/src/agent-stream/view.tsx`**：折叠行渲染 + 展开按钮（复用
  `expandable-badge.tsx` 的展开交互；不引入新 UI 体系）
- **`packages/app/src/agent-stream/layout.ts`**：折叠后 tool 行的 spacing 适配
  （`getAssistantBlockSpacing` 已处理相邻关系，需覆盖折叠行）

### 6.3 测试

`turn-fold.test.ts`（纯函数）：

| #   | 场景                          | 断言                                    |
| --- | ----------------------------- | --------------------------------------- |
| 1   | running turn 不折叠           | fold map 不含 running turnId            |
| 2   | 已完成 turn 折叠 tool/thought | hiddenEntryIds 正确，assistant 文本保留 |
| 3   | 展开态                        | expanded 覆盖 hidden 显示               |
| 4   | work-log 超 1 条              | hiddenCount = n-1                       |
| 5   | 无 tool 的 turn               | 不产生 fold                             |
| 6   | turn_completed 后立即折叠     | 无闪烁（running 判定优先）              |

### 6.4 验收

- 聚焦测试全绿；typecheck / lint
- web 手动：完整跑一轮工具循环后旧回合折叠为一行，展开可见细节

---

## 7. Slice E — Web markdown 表现力 + 流式高亮缓存策略

**目标**：web/Electron 端 assistant 文本获得 react-markdown 级表现力（路径 chip、表格、
details、外链 favicon），**RN 保持现状**；对齐 T3 "流式期间不读写高亮缓存"。

### 7.1 新文件（分平台）

`packages/app/src/components/assistant-markdown.web.tsx`

```tsx
export const AssistantMarkdownWeb = memo(function AssistantMarkdownWeb({
  text,
  isStreaming,
  cwd,          // 复用现有 assistant-file-links 的 workspace 解析
  onOpenFile,
}: {
  text: string;
  isStreaming: boolean;
  cwd: string | null;
  onOpenFile: (target: InlinePathTarget) => void;
}): ReactNode);
```

依赖：`react-markdown` + `remark-gfm`（**检查 app 依赖树，缺则加**）+ 现有
`components/markdown/html-ish.tsx` 的图片尺寸解析 + `HighlightedCodeBlock`（或直接 shiki）。

**`packages/app/src/components/assistant-markdown.tsx`**（平台路由壳）：

```tsx
export function AssistantMarkdown(props) {
  if (isWeb) return <AssistantMarkdownWeb {...props} />;
  return <MarkdownRenderer {...props} />; // 现有 RN 路径
}
```

### 7.2 修改

- **`packages/app/src/components/message.tsx`**：`AssistantMessage` 的文本渲染处
  （当前 `MarkdownRenderer` + `splitMarkdownBlocks`）替换为 `AssistantMarkdown` 壳
  - 保留 `useDeferredValue` + `keyedBlocks` 结构：web 分支仍按 block 渲染，
    block 内部用 react-markdown（**不逐 token 重渲整条**，块级 memo 不变）
- **高亮缓存策略**：检查 `HighlightedCodeBlock` 在 `isStreaming` 时是否写缓存；
  若写则改为与 T3 一致（流式期间跳过 cache 读与写，结束后写）
  - 注意与 `assistant-message-height-estimate.ts` 的配合：流式期间高度估计仍按未高亮估算

### 7.3 测试

- `assistant-markdown.web.test.tsx`（vitest，契约级，不声称 native 验证）：
  - 路径 chip 渲染（`src/main.ts` → chip + L 行号）
  - 表格 / details 渲染
  - 外链 favicon（host 解析）
  - 流式半截 fence：不崩溃、fallback 为 `<pre>`
  - 高亮缓存：流式期间不 set，结束后 set
- 既有 `message.test.tsx` 布局契约不回归

### 7.4 验收

- 聚焦测试 / typecheck / lint 全绿
- **web 真实验证**：Playwright 定向 spec（或手动截图对比）确认路径 chip、表格渲染
- **desktop 验证**：真实 Electron app 中确认（AGENTS.md：不以 web preview 代替）

---

## 8. Slice F — 服务端 delta 微批（可选，P4）

**先决条件**：切片 B/C/D 完成后，用真实长流（codex 大量输出）做性能采样
（`CHISACODE_LOG_LEVEL=trace` + 客户端帧时间测量）。**只有出现主线程 jank 证据才做**。

### 8.1 若做，最小实现（不破坏 seq 门控）

- `packages/server`：`agent-timeline-event-controller` 或 stream 转发路径，对
  `assistant_message` 的连续 text delta 做 ≤50ms 聚合（同 messageId 追加后一次广播）
- `packages/protocol`：不改 schema（复用现有 `timeline` 事件类型，仅聚合发送）
- **风险**：改变事件到达粒度会影响 `session-stream-reducers` 的 seq 门控与
  `agent-stream-tail-cache` —— 需要回归全量 reducers 测试
- **判定标准**：不达标不做，且做之前必须有基线采样数据

### 8.2 验收

- server 聚焦测试 + app reducers 全量回归
- 真实长流 60s 采样对比（帧时间 P95 下降）

---

## 9. 里程碑与验收节奏

| 里程碑 | 内容                   | 验收                                 |
| ------ | ---------------------- | ------------------------------------ |
| M1     | Slice A 纯函数 + 测试  | vitest 全绿，无 UI 改动              |
| M2     | Slice B web 锚定滚动   | Playwright 定向 spec + 手动 web 验证 |
| M3     | Slice C projection ack | 聚焦测试 + web 手动连点验证          |
| M4     | Slice D 折叠           | 聚焦测试 + web 手动工具循环验证      |
| M5     | Slice E web markdown   | 聚焦测试 + web/Electron 截图         |
| M6     | Slice F（可选）        | 性能采样对比，不达标跳过             |

**每切片提交独立**：`feat(agent-stream): turn-anchor metrics (A)` / `feat(agent-stream): send turn-anchor scroll (B)` 等。

---

## 10. 门禁与验证矩阵（AGENTS.md 合规）

每次提交前：

- [ ] `npx vitest run <改动文件> --bail=1`（**绝不跑全量套件**）
- [ ] `npm run typecheck`（app；涉及 server 时加 server）
- [ ] `npm run lint -- <改动文件>`
- [ ] `npm run format:files -- <改动文件>`（如格式偏离）
- [ ] 不新增固定 sleep；等待用 `vi.waitFor` / 事件驱动
- [ ] 不引入 `vi.mock` / JSDOM 冒充平台验证；UI 结论只来自真实目标表面

平台验证要求：

| 切片          | 验证表面                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| B（滚动）     | 真实 web（Playwright 定向 spec）；native 代码零改动则声明"未验证 native" |
| C（busy）     | 真实 web 手动；native 行为不变                                           |
| D（折叠）     | 真实 web 手动；native 待定（若同渲染路径则 web+Electron）                |
| E（markdown） | 真实 web + 真实 Electron（AGENTS.md 桌面规则）                           |
| F             | 真实长流采样                                                             |

---

## 11. 风险与回滚

| 风险                                               | 缓解                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| B 的 anchor 滚动与 bottom-anchor verification 交互 | 两控制器独立、互斥启用；B 先 web、native 不动；保留 `turn-anchor-request` 透传开关 |
| B 滚动回归（已有贴底用户习惯）                     | `isTurnAnchorEnabled` 可全局关；freescrolling 阈值与现有 24px 一致                 |
| C 改变 busy 语义引入卡死                           | ack 判定含 error/permission 短路（照 T3 规则）；pending 有超时兜底                 |
| D 折叠误伤 live head                               | 折叠仅限"已完成 turn"（turn_completed 事件之后）；running 优先不折叠               |
| E 分平台渲染不一致                                 | RN 路径完全不动；web 组件独立文件，可单独回滚                                      |
| F 影响 seq 门控                                    | 复用事件类型仅聚合发送；全量 reducers 回归 + 采样基线                              |

回滚：每切片独立提交 → 单切片 `git revert` 即可，不互相纠缠。

---

## 12. 开工顺序建议

1. **Slice A**（今天可做，0 风险）
2. **Slice C**（独立、低风险，可与 A 并行）
3. **Slice B**（依赖 A，web 验证）
4. **Slice D**（独立）
5. **Slice E**（依赖 D 弱，可并行）
6. **Slice F**（采样后决定）

---

## 13. Roadmap 登记

已登记到 `docs/refactors/comprehensive-improvement-roadmap.md`（见 "T3 消息发送/渲染丝滑移植" 条目，
随分支开工后标记 in-progress，完成一项标记一项）。

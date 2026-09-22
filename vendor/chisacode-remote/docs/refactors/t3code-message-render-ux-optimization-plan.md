# T3 消息渲染 UX — 完全优化修复计划

> 基于：全面审查（4 维度并行审查）+ T3 源码级对比（还原缓存 `.tmp/t3-research/`）
> 日期：2026-08-04
> 前置：`docs/refactors/t3code-message-render-ux-plan.md`（原始计划）+ `docs/research/t3code-message-render-ux-audit.md`（实现审计）

## 0. 背景：T3 与 ChisaCode 的架构差异根因

审查暴露的问题大多源自一个根本架构差异：

| 维度             | T3                                                                                    | ChisaCode                                                                                                    | 差异后果                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **事件流**       | 单事件流（`thread.messages` 原子更新 + `afterSequence` 续传游标）                     | tail/head 双流（canonical 历史 + live optimistic head）                                                      | ChisaCode 有「乐观 id 被投影吞掉」「触发竞态」等 T3 不存在的问题                             |
| **id 命名权**    | 客户端生成 id → 服务端 decider 原样回显 → 纯 id 去重合并                              | 服务端自生 id（已修复为透传，但真实 provider 不回显）→ ordinal 合并                                          | ChisaCode 需「末条 user_message 回退」安全网                                                 |
| **busy 绑定**    | `LocalDispatch` 快照契约（发送时拍 Thread 投影快照，ack = 快照 vs 当前投影字段 diff） | 已实现发送时快照契约 `ComposerSendSnapshot`（P1.1）：permission/error/idle/id-drift/turn-progress 多信号 ack | 快照字段集与 T3 不同（乐观 id + baseline 字段，非全投影 diff），ack 启发式偏宽（见 §6 遗留） |
| **滚动定位**     | `LegendList.scrollToIndex({viewPosition:0, viewOffset:16})` 动画 API                  | 手算 `targetScroll` + `Math.min(targetScroll, maxScroll)`                                                    | ChisaCode 引入 `maxScroll<=0` 无限 rAF 风险（T3 不存在）                                     |
| **流式高亮缓存** | `isStreaming` 时 read+write 均跳过                                                    | `cacheable:false` 时只跳过 write，read 仍尝试                                                                | ChisaCode 是有意微优化（键=完整内容，命中必已完成块）                                        |
| **native**       | 无 native（web-only 单路径）                                                          | web/native 双 strategy，native 用 inverted FlatList                                                          | ChisaCode native 委托 sticky-bottom 非 no-op                                                 |

**结论**：ChisaCode 的双流模型 + 手算滚动是两条结构性脆弱链（乐观 id 扫 store 已在 P1.1 被发送时快照契约替代，见 §2.1），T3 的单流 + 快照契约 + LegendList 内建锚定免疫这些问题。优化计划按「先补门禁缺口（不改架构）→ 再对齐 T3 健壮性（局部改架构）→ 最后体验对齐」三层推进。

---

## 1. P0 — 门禁健壮性 + 文档准确性（立即修复，不改实现）

这些是审查发现的门禁缺口与文档错误，修复成本低、风险零、不涉及行为变更。

### 1.1 dev 桌面脚本补 6767 端口预检

- **问题**：`desktop-slices.script.ts:125,156-159` 硬编码 `daemonPort=6767`，无 `ensurePortFree` 预检。若开发者 daemon 已占 6767，`waitForTcp` 假阳性，spawn 的 daemon EADDRINUSE 被 `stdio:"ignore"` 静默吞掉，脚本向**开发者真实 daemon** 种子 mock agent。
- **T3 对比**：T3 无 e2e 基建参考；此为 ChisaCode 自身门健性缺陷。
- **修复**：从 `desktop-packaged-slices.script.ts:55-87` 移植 `ensurePortFree` 到 dev 脚本，在 `spawnResolved(daemon)` 前调用。`ensurePortFree` 的 PowerShell 过滤 `*daemon-worker*` 命名的 dev 残留进程，不碰 packaged 的 `node-entrypoint-runner.js`。
- **影响**：`packages/app/e2e/desktop-slices.script.ts`（+30 行）
- **门禁**：dev 脚本在有开发者 daemon 运行时启动应**报错退出**而非污染
- **优先级**：P0

### 1.2 打包脚本 daemon 清杀补兜底

- **问题**：`desktop-packaged-slices.script.ts:235,410-416` cleanup 依赖 `daemonPid`（从 bridge `desktop_daemon_status.pid` 获取）。若 status 轮询未报告 pid，`taskkill` 被跳过，packaged daemon 泄漏在 6767；下次运行的 `ensurePortFree` 过滤 `*daemon-worker*` **不匹配** packaged 的 `node-entrypoint-runner`，泄漏 daemon 阻塞后续运行。`client.close()` 也无界。
- **修复**：
  1. `client?.close()` 包入 `boundedClose`（10s 超时）
  2. taskkill 退路：若 `daemonPid` 为 null，按 `node-entrypoint-runner` 命令行匹配杀 6767 持有者（与启动预检的 `*daemon-worker*` 过滤互补）
  3. polling 阶段强制等 `daemonStatus.pid` 非 null 才继续（已由 `if (!daemonStatus) throw` 守护，但补 `typeof daemonStatus.pid === "number"` 断言）
- **影响**：`packages/app/e2e/desktop-packaged-slices.script.ts`（+15 行）
- **门禁**：连续两次运行不应因前次泄漏 daemon 而失败
- **优先级**：P0

### 1.3 补 Slice E 真实 web Playwright spec

- **问题**：计划 §10 要求 Slice E「真实 web + 真实 Electron」，但 web 端仅有 `highlight-cache.test.ts` 单测，缺真实 web Playwright spec。桌面脚本断言了流式围栏渲染，但 web leg 缺失。
- **T3 对比**：T3 用独立 `ChatMarkdown.tsx` 持有 `isStreaming`，流式与已完成不共享渲染器；ChisaCode 经 `mergeMarkdownRules` 闭包注入，流式必走 isStreaming-aware fence，**当前无 bug**，但缺 web spec 门禁。
- **修复**：以 `agent-stream-ui.spec.ts` 为模板，新增 `e2e/highlight-streaming.spec.ts`：
  - 用 `startRunningMockAgent`（model: `one-minute-stream`，prompt 含流式代码围栏）
  - `awaitAssistantMessage` 后断言 `page.getByText("const NEAR_BOTTOM_PX = 160;").toBeVisible()`
  - 断言流式期间围栏渲染（`HighlightedCodeBlock` 的 `cacheable:false` 路径）
  - 可选：断言完成后围栏仍在（`isStreaming:false` → `cacheable:true` 写缓存）
- **mock 改动**：mock 的标准 cycle 文本（`buildIntroParagraph`/`buildMidParagraph`）需含代码围栏，或新增一个含围栏的 stream profile。当前只有 trailing-tool-run 模式含围栏，标准 60s cycle 不含——需在 mock 加一个含围栏的 prompt 模式（如 `shouldEmitCodeFence` regex）或在 `one-minute-stream` 的 cycle 文本中加围栏。
- **影响**：`packages/app/e2e/highlight-streaming.spec.ts`（新建）、`packages/server/src/server/agent/providers/mock-load-test-agent.ts`（cycle 文本加围栏，或新增 fence profile）
- **门禁**：`npm run test:e2e --workspace=@chisacode/app -- highlight-streaming` 绿
- **优先级**：P0

### 1.4 审计文档纠正

四项文档错误，纯文档改动：

| 项  | 错误                                                                   | 修正                                                                                                                                                              | 位置                        |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| a   | §2.1/§1 turn-anchor-controller 写「20 测试」，实际 21                  | 改为 21（§7 的 21 已对）                                                                                                                                          | audit §2.1 行 25、§1 行 12  |
| b   | §2.2/§7 称 native `requestTurnAnchor` 为「no-op 分支（行为不变）」     | 改为「委托给既有 bottom-anchor `requestLocalAnchor`（sticky-bottom 语义保留）」——实际对 `message-sent` 调用 `bottomAnchorController.requestLocalAnchor`，非 no-op | audit §2.2 行 44、§7 行 168 |
| c   | §7「重建 asar 含切片代码」不可从仓库验证                               | 标注「需重跑 `node scripts/build-x64.js` + 解压 asar 复现」                                                                                                       | audit §7 行 168             |
| d   | §3.1「Slice E 降级：不引入 react-markdown」未提及 T3 的 read-skip 差异 | 补注：ChisaCode 流式期间 read 仍尝试（有意微优化，键=完整内容，命中必已完成块），T3 是 read+write 均跳过                                                          | audit §3.1                  |

- **影响**：`docs/research/t3code-message-render-ux-audit.md`
- **优先级**：P0

### 1.5 roadmap 补两条独立条目

AGENTS.md 第 41/49 行要求系统性问题建独立 roadmap 条目：

1. **`build-x64.js` 跟踪条目**：新 x64 专用打包脚本，需与 `scripts/build.js` 保持同步（asar-integrity packager 逻辑），当前无文档/npm script/roadmap 引用。
2. **SidebarV2/Soft-Home testid 迁移条目**：7 个 e2e spec 依赖经典 `sidebar-project-row-*`/`sidebar-workspace-row-*` testid，SidebarV2 主页无稳定选择器，阻断 `agent-stream-ui.spec.ts` 测试 3 等。修复方向：为 `SidebarV2Row` 补 testID 或 `withWorkspace.navigateTo` 改路由直开。

- **影响**：`docs/refactors/comprehensive-improvement-roadmap.md`（+2 条目）
- **优先级**：P0

---

## 2. P1 — 实现健壮性对齐 T3（应修复，局部改架构）

这些是审查发现的实质实现问题，涉及行为变更但范围可控。

### 2.1 Slice C：发送时快照契约（双流版 LocalDispatch）

- **问题**：事后扫 store 找乐观 id 依赖隐式同步契约；真实 provider 不回显 messageId 时同 id 判定永不命中。
- **T3 做法**：`beginLocalDispatch` 写入 `LocalDispatchSnapshot`，ack = 快照 vs 当前投影字段 diff + 多信号短路。
- **ChisaCode 落地（生产路径，非 stub）**：
  1. `dispatchComposerAgentMessage` 在 stream append 后同步 `onOptimisticDispatched(messageId)`（不 await 后再扫 store）
  2. `trackPendingSend` 构建 `ComposerSendSnapshot`：`optimisticMessageId` + `baselineLatestUserMessageId` + `baselineAgentStatus`
  3. `hasServerAcknowledgedComposerSend` 多信号 ack：
     - permission / agent error 短路
     - 非 idle 基线后回到 idle/closed 短路
     - 同 id canonical 投影（messageId 回显路径）
     - **latest canonical user id 越过 send baseline**（真实 provider id 漂移路径）
     - 乐观条目后的 turn progress（assistant/tool/thought/activity）
- **影响**：`session-stream-reducers.ts`、`use-composer-send-projection-ack.ts`、`actions.ts`、`delivery-controller.ts`、`index.tsx` + 单测
- **门禁**：snapshot/ack 单测 + hook 单测；turn-anchor Slice C 不回归
- **优先级**：P1

### 2.2 Slice B：`maxScroll<=0` 无限 rAF 防护

- **问题**：`turn-anchor-controller.ts:127-134` 当 `maxScroll<=0`（内容未溢出视口）时重置 `attemptCount=0` 并无条件 reschedule，`TURN_ANCHOR_POSITION_ATTEMPT_MAX=12` 上限失效。若回复永不增长（provider 卡死、空回复），控制器无限 schedule rAF。
- **T3 对比**：T3 用 `LegendList.scrollToIndex` 不手算 maxScroll，天然无此风险。
- **修复方案**（不引入 LegendList，加防护）：
  1. `maxScroll<=0` 分支引入独立的 `noOverflowAttemptCount`，上限 `TURN_ANCHOR_NO_OVERFLOW_MAX=60`（约 1s @ 60fps）
  2. 超限后 `clearRequest()`（放弃锚定，保持当前滚动位置），不无限重排
  3. 下次 `handleContentSizeChange`（内容增长）时若有 pending request 则重置 `noOverflowAttemptCount`
- **影响**：`packages/app/src/agent-stream/turn-anchor-controller.ts`（+15 行）、`turn-anchor-controller.test.ts`（+1 测试：内容永不增长时控制器放弃而非无限重排）
- **门禁**：`turn-anchor-controller.test.ts` 新增「never-overflows gives up after bounded attempts」用例
- **优先级**：P1

### 2.3 Slice D：折叠按钮展开后切换文案（对齐 T3）

- **问题**：ChisaCode `WorkLogMoreButton` 展开后文案恒 `+{hiddenCount}`，T3 展开后切 `Show fewer {tool calls}` + chevron 旋转。ChisaCode 当前功能正确（双向 toggle），但 UX 与 T3 不一致。
- **T3 做法**：`WorkGroupToggleTimelineRow` 按 `row.expanded` 切换 `+N previous` / `Show fewer`，chevron `rotate-180`。
- **修复方案**：
  1. `WorkLogMoreButton` 接收 `expanded: boolean` prop
  2. 展开时文案切 `Show fewer`（或 i18n key `composer.showFewerToolCalls`），chevron 旋转
  3. 折叠时保持 `+{hiddenCount}`
- **影响**：`packages/app/src/agent-stream/view.tsx`（WorkLogMoreButton +10 行）、`packages/app/src/i18n/index.ts`（+1 key）
- **门禁**：`turn-fold.test.ts` 不受影响（纯函数不变）；`work-log-fold.spec.ts` 断言更新（展开后按钮文案变 `Show fewer`）
- **优先级**：P1（低风险 UX 对齐）

### 2.4 messageId 线上 schema 加长度/格式校验

- **问题**：`protocol/src/agent/messages.ts:147` `messageId: z.string().optional()` 无 max length / format 约束。客户端可发任意长字符串。
- **T3 对比**：T3 用 `newMessageId()`（uuid），服务端原样回显，但 T3 的 id 不经过 wire schema 校验（同源信任）。
- **修复方案**：`messageId: z.string().max(256).optional()`（256 字符足够 uuid/ulid）。可选加 `regex(/^[a-zA-Z0-9_-]+$/)` 但需确认无特殊格式 id。
- **影响**：`packages/protocol/src/agent/messages.ts`（1 行）
- **门禁**：protocol 单测（如有）；schema 加宽不破坏现有客户端（messageId 可选）
- **优先级**：P1（低改动，防御性）

### 2.5 `mock-slow` provider 测试覆盖

- **问题**：`provider-registry.test.ts:525-544` 只断言 `mock` 在 `enableDevProviders:true` 下注册，未测 `mock-slow`。若未来重构意外只门控 `mock`，`mock-slow` 回归静默。
- **修复方案**：测试补 `expect(registry["mock-slow"]).toBeDefined()`（opt-in on）和 `toBeUndefined()`（opt-in off）。
- **影响**：`packages/server/src/server/agent/provider-registry.test.ts`（+2 断言）
- **优先级**：P1（nit 级，1 行改动）

---

## 3. P2 — 体验对齐 T3（可改进，非阻塞）

### 3.1 Slice B：补 touchmove/pointerdown 脱离路径（web）

- **问题**：ChisaCode web 仅 wheel deltaY<0 脱离锚定，缺 touchmove/pointerdown（触屏设备/触控板）。T3 在 wheel/touchmove/pointerdown 三种监听都切 free-scrolling。
- **修复方案**：`strategy-web.tsx` 的 scroll container 补 `onTouchMove`（向上滑动时 `detachByUser`）和 `onPointerDown`（非 composer 区域时 `detachByUser`）。
- **影响**：`packages/app/src/agent-stream/strategy-web.tsx`（+20 行）
- **门禁**：`turn-anchor.spec.ts` 测试 2（wheel 脱离）已有；触屏脱离需 Playwright touch 模拟或标记为手动验证
- **优先级**：P2

### 3.2 Slice D：补 `deriveTurnFolds` 纯函数（对齐计划 6.1）

- **问题**：计划 §6.1 列了 `deriveTurnFolds` 签名（已完成回合 thoughts 折叠为「Worked for {duration}」行），但 `turn-fold.ts` 未实现，turn 折叠在 `model.ts` 的 `collapseCompletedTurnThoughtsForDisplay` 内联处理。T3 是双层折叠（turn-fold + work-log fold）均在 `MessagesTimeline.logic.ts` row 派生。
- **修复方案**：提取 `deriveTurnFolds(entries, runningTurnId)` 到 `turn-fold.ts`，返回 `{ foldEntries, remainingEntries }`，`view.tsx` 消费。纯函数可单测。
- **影响**：`packages/app/src/agent-stream/turn-fold.ts`（+40 行）、`view.tsx`（消费）、`turn-fold.test.ts`（+测试）
- **门禁**：`turn-fold.test.ts` 新增 `deriveTurnFolds` 用例
- **优先级**：P2（重构，不改变行为）

### 3.3 Slice D：补工具生命周期合并（对齐 T3 `collapseDerivedWorkLogEntries`）

- **问题**：ChisaCode `deriveWorkLogCollapse` 直接对 `tool_call` entry 数组折叠，无工具生命周期合并阶段。T3 先按 `tool.updated`+`tool.completed`/collapseKey 合并同工具的 running→completed 对，再折叠。
- **修复方案**：`turn-fold.ts` 新增 `collapseToolLifecycle(entries)`：同 `toolCallId` 的 `tool_running`+`tool_completed` 合并为单条 `tool_call`（status: completed），再进 `deriveWorkLogCollapse`。
- **影响**：`packages/app/src/agent-stream/turn-fold.ts`（+30 行）、`view.tsx`（消费）、`turn-fold.test.ts`（+测试）
- **门禁**：`turn-fold.test.ts` 新增生命周期合并用例
- **优先级**：P2

### 3.4 Slice E：流式高亮缓存 read 守卫（可选，字节级对齐 T3）

- **问题**：ChisaCode 流式期间 read 仍尝试（有意微优化）。T3 是 read+write 均跳过。
- **评估**：当前行为安全（键=完整内容，命中必已完成块）且是微优化（agent 重发同一完成块时复用缓存）。**不建议修改**——若审计要求字节级 T3 对齐，可在 `highlight-cache.ts:64` 的 `get` 前加 `if (!cacheable) return null`，但无正确性收益，反而失去微优化。
- **优先级**：P2（不建议实施，仅文档记录决策）

---

## 4. P3 — 长期架构对齐（评估，不立即实施）

### 4.1 评估：tail/head 双流 → 单事件流模型

- **问题**：ChisaCode 的 tail/head 双流是「id 漂移」「触发竞态」的根因。T3 单事件流（thread.messages 原子更新 + afterSequence 续传）免疫这些问题。
- **评估**：这是**全栈架构变更**（protocol + server + client），影响面极大，不在本计划范围。当前的双流 + 乐观 id 回显 + 末条回退安全网在 mock 路径已闭环，真实 provider 靠末条回退。**建议仅作技术债记录**，待未来 protocol 大版本迁移时评估。
- **优先级**：P3（不实施）

### 4.2 评估：native turn-anchor 语义实现

- **问题**：ChisaCode native 的 `requestTurnAnchor` 委托 sticky-bottom（`message-sent` → `requestLocalAnchor` → `scrollToBottom`），实际把用户消息贴底，与 web 的「钉上沿」语义相反。native 从未实现 turn-anchor 语义，靠 inverted FlatList 维持「回复在上生长」。
- **评估**：native 的 inverted FlatList + `maintainVisibleContentPosition` 天然实现「回复在上方生长、锚行不动」，但「钉上沿」需主动滚动到用户消息行。若要实现，需在 native strategy 加 `flatListRef.scrollToIndex({index: userMessageIndex, viewPosition: 0, animated: true})`。**当前行为（贴底）与改造前一致，非回归**，但与 web 语义不对称。建议作为独立 native 体验项评估。
- **优先级**：P3（评估）

### 4.3 评估：引入 LegendList 替代 tanstack virtual

- **问题**：ChisaCode 用 tanstack virtual + 手算 offset，引入 `maxScroll<=0` 风险。T3 用 LegendList 内建 `scrollToIndex` + `anchoredEndSpace`，天然无此问题。
- **评估**：LegendList 是 RN 跨端列表库，引入需评估 web 兼容性、包体积、迁移成本。**不建议为此单项引入**——P1.2 的 `maxScroll<=0` 防护已解决即时风险。若未来有更多列表锚定需求，可评估。
- **优先级**：P3（不实施）

---

## 5. 实施顺序与门禁

### 5.1 阶段一：P0（已完成，2026-08-04）

| 项                           | 改动                                                               | 状态                                                                       |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1.1 dev 脚本端口预检         | `desktop-slices.script.ts` 移植 `ensurePortFree`                   | ✅                                                                         |
| 1.2 打包脚本 daemon 清杀兜底 | pid 必填 + bounded client.close + node-entrypoint-runner 退路      | ✅                                                                         |
| 1.3 Slice E web spec         | `highlight-streaming.spec.ts` + mock code-fence 模式 + server 单测 | ✅ 单测 8/8；web e2e 1/1 绿（与 turn-anchor 2 + work-log-fold 1 合并 4/4） |
| 1.4 审计文档纠正             | controller 21、native 委托措辞、asar 可复现声明、read-skip 差异    | ✅                                                                         |
| 1.5 roadmap 2 条目           | `build-x64.js` + SidebarV2 testid 迁移                             | ✅                                                                         |

### 5.2 阶段二：P1（已完成，2026-08-04）

| 项                       | 改动                                                                                                         | 状态                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| 2.1 Slice C 发送快照契约 | `ComposerSendSnapshot` + `hasServerAcknowledgedComposerSend`（permission/error/idle/id-drift/turn-progress） | ✅ reducers+hook 单测 |
| 2.2 maxScroll<=0 防护    | `TURN_ANCHOR_NO_OVERFLOW_ATTEMPT_MAX=60` + 测试                                                              | ✅ controller 22/22   |
| 2.3 折叠按钮文案         | 展开 `Show fewer` / 折叠 `+N`；e2e locator 同步                                                              | ✅                    |
| 2.4 messageId schema     | `z.string().max(256)` on send schemas                                                                        | ✅                    |
| 2.5 mock-slow 测试       | opt-in on/off 断言                                                                                           | ✅ registry 40/40     |

### 5.2.1 改动后门禁复跑证据（2026-08-04）

- `npx playwright test --project='Desktop Chrome' e2e/highlight-streaming.spec.ts e2e/turn-anchor.spec.ts e2e/work-log-fold.spec.ts` → **4 passed**
- `npx tsx e2e/desktop-slices.script.ts` → **3/3 ALL DESKTOP SLICES PASSED**（顺序改为 D/E → B/C 后稳定）
- 重建 `npm run build:web` + `node packages/desktop/scripts/build-x64.js` 后 `npx tsx e2e/desktop-packaged-slices.script.ts` → **2/2 ALL PACKAGED SLICES PASSED**

### 5.3 阶段三：P2（可改进，按需）

按需实施，每个独立可回滚。

### 5.4 P3 不实施，仅文档记录。

## 6. 风险与回滚

- **P0 零风险**：门禁基建 + 文档，不改实现行为
- **P1.1（Slice C 发送快照契约）中等风险**：涉及 composer + reducers 多文件，需充分单测。回滚 = 恢复仅同 id adoption（git revert）
- **P1.2（maxScroll 防护）低风险**：仅加上限，不改变正常路径。回滚 = 删除 `noOverflowAttemptCount`
- **P1.3（折叠文案）低风险**：纯 UI。回滚 = 恢复恒 `+N`
- **P1.4（schema）低风险**：加宽约束。回滚 = 删除 `.max(256)`

---

## 7. 审查发现未修复项（如实声明）

| 发现                                         | 处理    | 理由                                                                         |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| 共享 `MarkdownRenderer` 未传 isStreaming     | 不修复  | by-design，`mergeMarkdownRules` 闭包注入保证流式必走 isStreaming-aware fence |
| 流式高亮缓存 read 不跳过                     | 不修复  | 有意微优化，键=完整内容，命中必已完成块，有注释+测试背书                     |
| commit 消息「3/3 green」不可验证             | 已记录  | 后续提交消息只保留可验证的代码声明                                           |
| `daemon-client.e2e.test.ts:786-789` 重复断言 | 不修复  | 无害复制粘贴残留                                                             |
| tail/head 双流模型结构性脆弱                 | P3 记录 | 全栈架构变更，不在本计划范围                                                 |

---

## 8. T3 源码引用清单

优化计划的 T3 对比基于以下还原源码（`.tmp/t3-research/`，未提交）：

- `core/timelineScrollAnchoring.ts:37-78` — 几何纯函数（`getAnchoredTurnMetrics`）
- `core/chatList.ts:1-33` — `CHAT_LIST_ANCHOR_OFFSET=16` + `resolveChatListAnchoredEndSpace`
- `core/ChatView.tsx:3438-3743` — 滚动状态机（8 ref + positionAnchor + 双帧 effect）
- `core/ChatView.tsx:4617-5118` — onSend + steer 设 anchor
- `core/ChatView.logic.ts:478-566` — `LocalDispatchSnapshot` + `hasServerAcknowledgedLocalDispatch`
- `core/MessagesTimeline.tsx:349-512` — LegendList anchoredEndSpace + maintainScrollAtEnd 互斥
- `core/MessagesTimeline.logic.ts:266-515` — turn-fold + work-log fold + work-toggle 行
- `core/MessagesTimeline.tsx:1190-1234` — `WorkGroupToggleTimelineRow`（展开后切文案）
- `core/session-logic.ts:766-781` — `collapseDerivedWorkLogEntries` + `shouldCollapseToolLifecycleEntries`
- `server/_up_src__orchestration__decider.ts:713-753` — `thread.message-sent` 原子事件 + id 回显
- `runtime/_up__up__up__up_packages__client-runtime__src__state__threadReducer.ts:228-262` — 同构 reducer
- `core/ChatMarkdown.tsx:264-282` — `SuspenseShikiCodeBlock` isStreaming read+write 跳过

# T3 Code 首次创建/发送启动延迟优化计划（完全方案）

> 分支建议：`optimize/first-send-startup-latency`
> 依据：`docs/research/t3code-message-render-ux.md` + T3 orchestration 还原缓存 `.tmp/t3-research/server/`（`ProviderCommandReactor` / `ProviderService` / `ProviderRuntimeIngestion` / `ProviderSessionReaper` / `decider`）
> 对照对象：`packages/server`（agent 生命周期/发送/创建/provider/snapshot）+ `packages/app`（composer/busy/draft handoff）+ `packages/cli`（send/run）+ `packages/protocol`
> 研究日期：2026-08-09
> 修订：2026-08-09（方向 A：session 创建与连接解耦，完全消除 createSession spawn 阻塞）
> 状态：**待评审**（计划评审中，未开工）

---

## 0. 背景：问题与 T3 的处理哲学

### 0.1 用户问题

首次打开 ChisaCode，选择 agent、发送第一条消息（或新建 agent 发首条 prompt），"创建/发送要花好久"。
首条消息的延迟体验明显落后于 T3 Code。

### 0.2 根因（代码级证据）

首条消息是一条**阻塞式 RPC**：`send_agent_message_response` 要等 agent run 真正启动
（`waitForAgentRunStartWithTimeout`，上限 15s，`agent-lifecycle-handler.ts:225`、
`agent-prompt.ts:171`）。在返回之前，关键路径上串行了：

1. `ensureAgentLoaded`：agent 不在内存 → resume/create → spawn `codex app-server` + initialize
   握手 + metadata load（`agent-loading.ts:23-79`）
2. `hydrateTimelineFromProvider` 全量重灌历史（`thread/read` 带 turns，`agent-loading.ts:77`）
3. `normalizeConfig` 未预选 model → **再 spawn 一个一次性 app-server 只为 `listModels`**
   （`agent-launch-config-controller.ts:120-133`、`client-runtime.ts:221-233`）
4. `startTurn` → `turn/start` → 上游首 token（`session-turn-execution.ts:94-132`）

其中每条 codex `listModels`/`listPersistedAgents` 都是即用即弃的子进程（`client-runtime.ts:160,221`）。

### 0.3 T3 的处理哲学（核心一句话）

> **T3 让"用户消息被收下"这件事立即发生（decider 原子产出 `message-sent` 事件），session 创建在后台异步追赶；ChisaCode 让"run 已启动"成为 RPC 响应的前提，把所有 spawn/hydration 成本压到用户等待的临界路径上。**

T3 关键机制（还原缓存，代码级证据）：

| 机制               | T3 实现                                                                                                                                                                                      | ChisaCode 现状                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 发送即确认         | `thread.turn.start` 命令由 decider **原子产出** `thread.message-sent` + `thread.turn-start-requested` 两个事件（`decider.ts:713-824`），命令立即确认，消息交付与 session 创建解耦            | ❌ RPC 等 run 启动才回 `accepted:true`              |
| 乐观 starting 状态 | reactor 在 provider 真正启动前就把 session 置 `status:"starting"`（`ProviderCommandReactor.ts:440-455`），UI 立即有反馈                                                                      | ❌ busy 绑 RPC promise（`submit.ts:57`）            |
| session 创建异步   | `ensureSessionForThread` + `sendTurn` fork 非阻塞；`QUEUED_TURN_START_GRACE_MS = 2min`，注释明说 "Session adoption takes seconds"（`ProviderCommandReactor.ts:780-894`、`decider.ts:29-30`） | ❌ 全部 await 在 RPC 临界路径                       |
| 会话复用           | per-thread 复用，cwd/mode/model/instance 变才重启（`ProviderCommandReactor.ts:542-606`）                                                                                                     | ✅ 已 resume 的 agent 复用（`agent-loading.ts:52`） |
| 重启恢复           | 持久化 `resumeCursor` 跨重启恢复（`ProviderService.ts:355-438`）                                                                                                                             | ✅ `resumeAgentFromPersistence`                     |
| idle 回收          | `ProviderSessionReaper` 30min/5min（`ProviderSessionReaper.ts:16-17`）                                                                                                                       | ❌ 无 session 级 reaper                             |
| model 解析         | turn-start 时对 live session 协商 `sessionModelSwitch` capability（`ProviderCommandReactor.ts:642-664`）                                                                                     | ❌ 旁路 spawn `listModels`                          |

### 0.4 已确认的关键约束（决定计划可行性，调查证据）

下列结论由本机代码验证，是计划成立的基石：

1. **`startTurn` 失败已可靠产生终端事件**：`forwardTurn` 在 re-throw 前**先**发 `turn_failed` +
   置 `lifecycle="error"` + `emitState`（`foreground-execution-controller.ts:208-222` →
   `agent-turn-event-controller.ts:109-123`）。移除 `waitForAgentRunStart` **不会导致 app 卡死**——
   启动失败改由 stream 异步到达。
2. **`createSession` 失败是同步的**：发生在 `ensureAgentLoaded` 内、dispatch 之前（`agent-loading.ts:52-74`），
   仍映射为 `accepted:false`，**不受非阻塞化影响**。
3. **`waitForAgentRunStart` 等的是 lifecycle 翻到 "running"**（`agent-wait-controller.ts:47-53`）。
   移除它只丢"启动失败转 accepted:false"这条翻译，**不丢终端事件本身**。
4. **`fetchTimelineForClient` 只读内存 store**（`agent-timeline-controller.ts:110-112`）——
   即 hydrate 填的同一块。但 `historyPrimed` 在 hydrate **开始时**就置 true
   （`agent-history-controller.ts:122`），**没有可靠的"完成"信号**——计划需补。
5. **app 的 draft→real handoff 不依赖 run-start**：靠 `agent_created` RPC 回执 +
   `forwardAgentUpdate` 的 `agent_update` upsert（`agent-lifecycle-handler.ts:716`）。
   提前发 `agent_created` 安全；但初始 prompt 失败不再变成 `agent_create_failed`，
   app 需新增"error 状态 agent 到达"处理（`create-flow.ts:206-213`、`agent-panel.tsx:871-885`）。
6. **CLI `send --no-wait` 行为会变**（run 启动失败仍报 sent）；wait 路径靠 `waitForFinish` 兜底无碍
   （`send.ts:224-246`）。**chat 提及 / notify-on-finish / 调度本就非阻塞**，不受影响
   （`post-message-command.ts:64-73`、`agent-prompt.ts:301-308`、`schedule/service.ts:522-538`）。
7. **协议可加可选字段**（`pendingRun`），符合 AGENTS.md protocol 规则（`messages.ts:575-583` 非严格 object）。

### 0.5 方向 A 的关键约束（修订时验证，决定 session 解耦可行性）

原计划移除了 `waitForAgentRunStart`，但 `ensureAgentLoaded` 内 `createSession`/`resumeSession`
的 spawn 仍被 await（`agent-prompt.ts:211`、`agent-session-lifecycle-controller.ts:81/132`），
是首次发送的真正大头。方向 A 要把这部分也移出临界路径。下列约束由代码验证成立：

8. **`startTurn` 内部已 `await connect()`**（`session-turn-execution.ts:102`），且 `connect()` 幂等
   （`session-connection.ts:42` `if (this.connected) return` + `connectPromise` 去重）。
   → **`createSession` 的 spawn+握手与 `startTurn` 共享同一个 `connect()`**。若 `createSession`
   只构造 session 对象不 await 完整 connect，`startTurn`（后台 `forwardTurn` 里）会自己触发 connect。
9. **session 对象在 `createSession` 构造时就存在**（`client.ts:144` `createCodexSession` 返回 session 对象，
   第 159 行 `await session.connect()` 才是 spawn+握手）。register 把 session 对象存进 managed agent
   （`registration-controller.ts:94-99` `buildManagedAgent`），不需要 session 已连上。
10. **register 的 `refreshRuntimeInfo`/`refreshSessionState` 需要 session 已连上**
    （`registration-controller.ts:105,116`，从 connected session 拿 model/sessionId/state）。
    → 方向 A 需让这两步容忍"未连接"：runtime info 暂缺，startTurn 连上后补；或推迟到 connect 完成后异步刷新。
11. **`forwardTurn` 的 `startTurn` 失败已发 `turn_failed` + `agent_state{error}`**
    （`foreground-execution-controller.ts:211-222`）。→ createSession 异步化后，spawn/握手失败
    会通过 startTurn 的 connect 路径抛出，同样被 forwardTurn 捕获上报，**不丢错误**。

---

## 1. 目标与非目标

### 1.1 目标（本次完全交付）

| 优先级 | 内容                                                                                                                                                     | 体感收益                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **P0** | **session 创建与连接解耦（方向 A 核心）**：`createSession` 构造 session 对象但不 await connect，spawn+握手推到 `startTurn` 内部，`accepted` 真正立即返回 | 最大（消除 createSession spawn 阻塞，无论预热是否完成） |
| **P0** | 发送非阻塞化：删 `waitForAgentRunStart`，立即回 `accepted:true + pendingRun`，run-start 结果改由事件上报                                                 | 大（消除 15s 阻塞等待）                                 |
| **P0** | 新建 agent 路径非阻塞化：`agent_created` 在 session 构造后立即回，初始 prompt + connect 异步                                                             | 大（新建"创建好久"）                                    |
| **P0** | 历史 hydration 移出临界路径：后台并行，不影响首 token                                                                                                    | 大（长会话首次发送）                                    |
| **P1** | 消除 `normalizeConfig` 冗余 `listModels` spawn：复用 snapshot 缓存                                                                                       | 中（省一次冷启动）                                      |
| **P1** | 打开 workspace 后台预热 agent：搭现成 timeline 初始化的便车                                                                                              | 中（首次发送零等待）                                    |
| **P2** | session idle reaper：借鉴 T3 ProviderSessionReaper，回收长驻 codex 子进程                                                                                | 低（资源，非首次慢主因）                                |

### 1.2 非目标（明确不做）

- 不做 T3 的事件溯源 decider/projector（ChisaCode 已是 agent_stream 事件流，AGENTS.md 明确不重写 ES）
- 不做 T3 单事件流续传替换 tail/head 双流（已知架构权衡，P3 技术债记录）
- 不引入 LegendList / Effect 状态栈（跨端不兼容）
- 不替换 codex 的 per-session spawn 模型为 shared singleton（codex `app-server` 设计如此；
  OpenCode 已是 shared server，不强制 codex 对齐）
- 不改 codex `app-server` 的 spawn 机制本身（仍是 per-session 子进程，只是不阻塞 RPC）

---

## 2. 总体架构决策

### 2.1 方向 A 核心：session 创建与连接解耦

**现状的完整阻塞链**（三个 await 串行）：

```
send_agent_message_request
  → sendPromptToAgent
    → await ensureAgentLoaded
      → await createAgent/resumeAgentFromPersistence
        → await prepareAgentConfig (含 normalizeConfig → listModels spawn)     ← spawn ① 冗余
        → await client.createSession
          → await session.connect() (spawn app-server + initialize 握手 + onInitialized)  ← spawn ② 大头
        → register (refreshRuntimeInfo/refreshSessionState 需已连接) + await hydrateTimelineFromProvider  ← ③ 历史
    → startAgentRun (IIFE, 非阻塞返回 iterator)
  → await waitForAgentRunStartWithTimeout                                        ← ④ 15s 阻塞
  → send_agent_message_response { accepted }
```

**方向 A 的目标链**（spawn ②③ 全部后台化，accepted 立即返回）：

```
send_agent_message_request
  → sendPromptToAgent
    → ensureAgentLoaded (派发但不 await connect/hydrate)
      → createAgent/resume:
        → prepareAgentConfig (normalizeConfig 复用 snapshot 缓存，无 listModels spawn)  ← spawn ① 消除
        → client.createSession: 构造 session 对象，不 await connect                    ← spawn ② 后台
        → register (refreshRuntimeInfo 容忍未连接，runtime info 暂缺)
      → hydrateTimelineFromProvider: fire-and-forget (后台)                            ← ③ 后台
    → startAgentRun (IIFE)
  → send_agent_message_response { accepted: true, pendingRun: true }                 ← 立即返回
  ↓ (后台 IIFE)
forwardTurn
  → startTurn
    → await connect() (此时才 spawn app-server + 握手)            ← spawn ② 在此发生，不阻塞 accepted
    → ensureThread / turn/start
  → 成功: lifecycle:"running" + emitState → app projection ack 释放 busy
  → 失败: turn_failed + lifecycle:"error" + emitState → app 收到 error 事件
```

**关键解耦点**：codex 的 `startTurn` 第 102 行本就 `await this.options.connect()`，
`connect()` 幂等（约束 8）。所以 `createSession` 只需构造 session 对象（`client.ts:144 createCodexSession`），
把 `session.connect()` 推迟到 `startTurn`。spawn+握手落在后台 IIFE，不阻塞 `accepted`。

### 2.2 register 容忍未连接 session

`register`（`registration-controller.ts:70-122`）当前在 session 连上后调用，做：

- `refreshRuntimeInfo`（第 105 行）：从 connected session 拿 model/sessionId——未连接时无此信息
- `refreshSessionState`（第 116 行）：拿 session 状态——未连接时无

方向 A 需让这两步容忍未连接：

- `refreshRuntimeInfo`：未连接时跳过（runtimeInfo 暂为 config 里的 model/provider），
  在 `connect()` 完成（`onInitialized` 回调或 startTurn 成功后）异步补一次 `refreshRuntimeInfo` + `emitState`
- `refreshSessionState`：未连接时 lifecycle 直接置 `idle`（而非从 session 状态推导）；
  connect 完成后订阅 session 事件（`subscribeToSession` 可在 connect 后异步挂）
- `buildManagedAgent` 把未连接的 session 对象存入——session 对象已存在（约束 9），只是 `isConnected()` 为 false

### 2.3 发送语义：即时确认 + 事件驱动

`accepted:true` 语义从"run 已启动"降为"已派发"；run-start 失败不再以 `accepted:false` 出现，
改由 `agent_state{error}` / `turn_failed` 事件到达（终端事件由 `forwardTurn` 保证，约束 1+11）。
`createSession` 构造失败（同步、在 connect 之前，如 provider 不可用）仍 `accepted:false`（约束 2）。

### 2.4 hydration 时机：临界路径 → 后台并行

`ensureAgentLoaded` 不再 await `hydrateTimelineFromProvider`，改 fire-and-forget（约束 4 要求补真完成信号）。
`fetch_agent_timeline_request` 到达时若 hydrate 未完成，短超时等待或返回空 + `hydrating` 信号。

### 2.5 新建 agent：session 构造后立即回，初始 prompt + connect 异步

`handleCreateAgentRequest` 在 `createAgent`（构造 session 不 await connect）后立即 `forwardAgentUpdate` + 发
`agent_created { pendingRun: true }`；`sendInitialPrompt` 后台启动，connect 在 startTurn 内发生。

---

## 3. 切片总览与依赖

```
Slice 1（消除冗余 listModels spawn）────────────── 独立，0 风险
Slice 2（workspace 后台预热 agent）────────────── 独立，低风险
Slice 3（hydration 后台化 + 完成信号）──────────── Slice 4 依赖
Slice 4（session 创建与连接解耦 ★方向A核心）────── 全链基础，Slice 5/6 依赖
Slice 5（发送非阻塞 + protocol pendingRun）─────── 依赖 Slice 4
Slice 6（app busy 事件驱动 + 兜底超时）──────────── 依赖 Slice 5
Slice 7（新建 agent 非阻塞 + app 错误补丁）─────── 依赖 Slice 5
Slice 8（session idle reaper）─────────────────── 独立，低风险
```

**Slice 4 是方向 A 的核心**：它把 `createSession` 的 spawn+握手从 RPC 临界路径移到后台。
没有 Slice 4，Slice 5（发送非阻塞）只能移除 `waitForAgentRunStart`，`createSession` spawn 仍阻塞。

建议开工顺序：1 → 2 → 3 → 8（并行）→ **4** → 5 → 6 → 7。
每切片独立提交、独立可回滚。Slice 4/5/6/7 语义联动，建议同批回滚。

---

## 4. Slice 1 — 消除 normalizeConfig 冗余 listModels spawn（P1，0 风险）

### 4.1 问题

`normalizeConfig` 在未预选 model 时 `await client.listModels(...)`（`agent-launch-config-controller.ts:120-133`）。
对 codex，`listModels` 每次都 spawn 一个一次性 `app-server` 子进程（`client-runtime.ts:221-233`），
即使 `force:false`。而 app 打开时 ProviderSnapshot warm-up 已经按 cwd 取过模型列表
（`provider-snapshot-manager.ts:200-221`），codex 的模型列表本就是**全局**的
（`client-runtime.ts:222` 注释："model/list is global to the app server; cwd and force are intentionally ignored"）。

### 4.2 方案

`normalizeConfig` 缺 model 时，**优先复用 ProviderSnapshot 按 cwd 缓存的模型列表**：

- 给 `AgentLaunchConfigController` 注入一个 `resolveCachedModels(cwd, provider)` 回调，
  从 `ProviderSnapshotManager.getSnapshot(cwd)` 取该 provider 的 `models`
- 仅当缓存为空（provider 未 warm 或 snapshot 为 loading/error）才回退 `client.listModels`
- 顺带：将 codex 版本探针（`resolveGoalsEnabled`/`resolveAutoReviewEnabled` 的 memoized promise，
  `client-runtime.ts:107-155`）提前到 provider warm-up 阶段预热，避免首条 codex turn 的版本 exec

### 4.3 改动文件

- `packages/server/src/server/agent/agent-launch-config-controller.ts`
  - 构造选项新增 `resolveCachedModels?: (cwd: string | undefined, provider: AgentProvider) => AgentModelDefinition[] | undefined`
  - `normalizeConfig` 内 `!normalized.model` 分支：先 `resolveCachedModels?.(cwd, runtimeProvider)`，
    有则 `resolveDefaultModelId(cached)`；无才回退 `client.listModels`
- `packages/server/src/server/bootstrap.ts`（或装配处）
  - 注入 `resolveCachedModels`：读 `providerSnapshotManager.getSnapshot(cwd)` 对应 provider entry 的 `models`
  - 在 provider warm-up 完成后 fire-and-forget 触发 codex client 的 `resolveGoalsEnabled()`/`resolveAutoReviewEnabled()`

### 4.4 测试

`packages/server/src/server/agent/agent-launch-config-controller.test.ts`（追加）：

| #   | 场景                                     | 断言                                                               |
| --- | ---------------------------------------- | ------------------------------------------------------------------ |
| 1   | 缓存有 model 列表                        | 用 `resolveDefaultModelId(cached)`，**不调用** `client.listModels` |
| 2   | 缓存为空/loading                         | 回退 `client.listModels`（mock spawn 计数 = 1）                    |
| 3   | 已预选 model                             | 不查缓存、不 listModels                                            |
| 4   | `resolveCachedModels` 未注入（旧调用方） | 行为同现状（回退 listModels）                                      |

### 4.5 验收

- 聚焦 vitest 全绿；typecheck/lint
- **真实 daemon 验证**（`CHISACODE_LOG_LEVEL=trace`）：首次发送 codex agent，日志中
  `normalizeConfig` 路径不再出现 `listModels` 的 spawn（对比改动前有、改动后无）

---

## 5. Slice 2 — 打开 workspace 后台预热 agent（P1，低风险）

### 5.1 问题

agent 按需 lazy 加载（`bootstrap.ts:1049` "agents will initialize on demand"）。
首次发送时若 agent 不在内存，`ensureAgentLoaded` 的 spawn+hydrate 落在等待路径。
但 `fetch_agent_timeline_request`（打开面板时）已经会触发 `ensureAgentLoaded`
（`agent-directory-handler.ts:530`）——只是发生在"用户点开 agent 面板时"，
而非"打开 workspace 列表时"。若用户先浏览列表再进面板，加载已滞后。

### 5.2 方案

`fetch_agents_request`（active 范围）响应后，对**最近活跃的前 N 个（1~3）** agent
fire-and-forget `ensureAgentLoaded`：

- 复用现有 `pendingAgentInitializations` 去重（`agent-loading.ts:14`）防并发
- 有界（N=3）、失败静默（仅 debug log）、不阻塞 `fetch_agents_response`
- 选最近活跃：按 `updatedAt` 倒序取前 N（agent record 已有该字段）

### 5.3 改动文件

- `packages/server/src/server/session-handlers/agent-directory-handler.ts`
  - `handleFetchAgentsRequest` 响应后：取结果中 active agents 按 `updatedAt` 倒序前 N，
    `void ensureAgentLoaded(agentId, ...).catch(err => logger.debug(...))`
- `packages/server/src/server/agent/agent-loading.ts`
  - 导出一个 `preloadAgents(agentIds, deps)` 批量入口（内部仍走 `ensureAgentLoaded` 去重）

### 5.4 测试

`packages/server/src/server/session-handlers/agent-directory-handler.test.ts`（追加）：

| #   | 场景                                         | 断言                                |
| --- | -------------------------------------------- | ----------------------------------- |
| 1   | fetch_agents 后触发前 N 个 ensureAgentLoaded | 计数 = N（或 active 总数，取小）    |
| 2   | 同一 agent 重复 preload                      | 去重（pendingAgentInitializations） |
| 3   | preload 失败                                 | 不影响 fetch_agents_response 已返回 |
| 4   | active agents 不足 N                         | 只 preload 实际数量                 |

### 5.5 验收

- 聚焦 vitest 全绿；typecheck/lint
- **真实 daemon 验证**：打开 workspace → 看日志 `Agent resumed from persistence` 出现在
  `fetch_agents` 之后、用户进面板之前；进面板 + 发送零 spawn

---

## 6. Slice 3 — hydration 后台化 + 完成信号（P0，中等风险）

### 6.1 问题

`ensureAgentLoaded` 内 `await hydrateTimelineFromProvider`（`agent-loading.ts:77`）串行阻塞，
长会话首次发送卡在 `thread/read` 全量历史。且 `historyPrimed` 在 hydrate **开始**时置 true
（`agent-history-controller.ts:122`），无可靠完成信号（约束 4）。

### 6.2 方案

**引入真正的 hydration 状态**，并把 hydrate 从 `ensureAgentLoaded` 临界路径移到后台：

1. `AgentHistoryController.seedFromProviderHistory`：
   - 在**循环结束后**才置 `historyPrimed = true`（现状是开始时置）
   - 新增 `hydratingFromProvider: boolean` 状态：开始时置 true，循环结束（含 catch）置 false
   - 暴露 `getHydrationState(agentId): "idle" | "hydrating" | "hydrated"`
2. `ensureAgentLoaded`：不再 `await hydrateTimelineFromProvider`，改为
   `void agentManager.hydrateTimelineFromProvider(agentId)`（fire-and-forget，
   但通过 `pendingAgentInitializations` 或新 map 去重 + 持有 promise）
3. `fetch_agent_timeline_request`：若 `hydratingFromProvider` === true，
   **短超时等待 hydrate 完成**（如 800ms）；超时则返回**当前内存 + 一个 `hydrating: true` 信号**，
   让 app 知道历史可能不完整、稍后可重新拉取。完成后客户端可按 `hydrating:false` 触发重拉。
4. 保留 `hydrateTimelineFromProvider({ force, broadcast })` 的 rewind 路径不变
   （`agent-history-controller.ts:70`，`force:true` 走 reset+广播，是唯一主动回推历史的路径）

### 6.3 改动文件

- `packages/server/src/server/agent/agent-history-controller.ts`
  - `seedFromProviderHistory`：移 `historyPrimed = true` 到循环后；新增 `hydratingFromProvider` 状态
  - 新增 `getHydrationState(agentId)` 导出
- `packages/server/src/server/agent/agent-manager.ts`
  - 暴露 `getHydrationState(agentId)`；`hydrateTimelineFromProvider` 返回 Promise（已返回），
    确保 caller 可持有
- `packages/server/src/server/agent/agent-loading.ts`
  - `ensureAgentLoaded`：hydr 改 fire-and-forget，但记录 hydrate promise 到一个
    `pendingHydrations` map（类似 `pendingAgentInitializations`）
- `packages/server/src/server/session-handlers/agent-directory-handler.ts`
  - `handleFetchAgentTimelineRequest`：`ensureAgentLoaded` 后查 `getHydrationState`；
    `hydrating` → 短超时等 promise（800ms）；超时 → response 带 `hydrating: true`
- `packages/protocol/src/agent/messages.ts`
  - `fetch_agent_timeline_response` payload 新增 `hydrating: z.boolean().optional()`（可选，旧客户端忽略）

### 6.4 测试

`agent-history-controller.test.ts`（追加）：

| #   | 场景           | 断言                                                                 |
| --- | -------------- | -------------------------------------------------------------------- |
| 1   | hydrate 进行中 | `getHydrationState` = `hydrating`；`historyPrimed` 仍 false          |
| 2   | hydrate 完成   | `getHydrationState` = `hydrated`；`historyPrimed` = true             |
| 3   | hydrate 抛错   | `getHydrationState` = `hydrated`（降级）；不向上抛                   |
| 4   | force 路径     | 走 `replaceFromProviderHistory`，不影响 `hydratingFromProvider` 语义 |

`agent-directory-handler.test.ts`（追加）：

| #   | 场景                                          | 断言                                     |
| --- | --------------------------------------------- | ---------------------------------------- |
| 5   | hydrate 完成内 fetch timeline                 | 返回完整历史，`hydrating:false`          |
| 6   | hydrate 进行中 fetch timeline（800ms 内完成） | 等待后返回完整，`hydrating:false`        |
| 7   | hydrate 进行中 fetch timeline（超 800ms）     | 返回当前内存（可能空），`hydrating:true` |

### 6.5 验收

- 聚焦 vitest 全绿（agent-history + directory-handler）；typecheck/lint
- **真实 daemon 验证**：长会话 agent 首次发送，`ensureAgentLoaded` 日志与 `startTurn` 之间不再
  串行 `thread/read` 全量；timeline 先空后补（或短等后完整）

---

## 7. Slice 4 — session 创建与连接解耦（★方向 A 核心，P0）

### 7.1 问题

`ensureAgentLoaded`（`agent-loading.ts:211`）→ `createAgent`/`resumeAgentFromPersistence` →
`sessionLifecycle.create/resume`（`agent-session-lifecycle-controller.ts:81/132`）→ `await client.createSession`。
codex 的 `createSession`（`client.ts:130-161`）第 159 行 `await session.connect()` 会 spawn `app-server` +
`initialize` 握手 + `onInitialized`（`session-connection.ts:84`）。这是首次发送**最大头的阻塞**，
且无法靠预热保证消除（预热未完成就发送仍卡）。

### 7.2 方案：构造 session 对象，不 await connect

**核心洞察**（约束 8）：codex `startTurn` 第 102 行本就 `await this.options.connect()`，`connect()` 幂等。
所以 `createSession` 只需构造 session 对象，把 `connect()` 推迟到 `startTurn`（后台 `forwardTurn` 里）。
spawn+握手落在后台，不阻塞 `accepted`。

#### 7.2.1 codex `createSession`/`resumeSession` 改造（`providers/codex/client.ts`）

```ts
async createSession(config, launchContext, options): Promise<AgentSession> {
  // ... resolveGoalsEnabled / resolveAutoReviewEnabled（保持，memoized）
  const session = this.createCodexSession({ ... spawnAppServer: () => this.spawnAppServer(...) ... });
  // 现状：await session.connect();  ← 删除这一行（或改为可选）
  // connect 推迟到 startTurn 内部（session-turn-execution.ts:102 已 await connect()）
  return session;  // 返回未连接的 session 对象（isConnected() === false）
}
```

`resumeSession` 同理（`client.ts:163+`），构造 session 对象不 await connect。
**注意**：`onInitialized`（`session.ts:249`，含 `loadAll` + `ensureThreadLoaded` + `loadPersistedHistory`）
目前在 `connect()` 内执行——解耦后它会在 `startTurn` 的 `connect()` 时执行，需确认 `startTurn` 能容忍
`onInitialized` 的异步工作（`ensureThread` 在 `onInitialized` 之后调用，`session-turn-execution.ts:108-111`，
顺序由 `connect()` 内部保证，不受外部解耦影响）。

#### 7.2.2 register 容忍未连接（`agent-session-registration-controller.ts`）

`register`（`:70-122`）当前假定 session 已连接。改为：

- `refreshRuntimeInfo`（`:105`）：检测 `session.isConnected()`；未连接则**跳过**，
  runtimeInfo 暂用 config 的 model/provider（`buildManagedAgent` 已支持从 config 取）
- `refreshSessionState`（`:116`）：未连接时 lifecycle 直接置 `idle`（不从 session 状态推导）；
  `subscribeToSession`（`:120`）推迟到 connect 完成后异步挂（见 7.2.3）
- connect 完成后（`onInitialized` 回调或首次 `startTurn` 成功）异步补：
  `refreshRuntimeInfo` + `refreshSessionState` + `emitState` + `subscribeToSession`

#### 7.2.3 connect 完成后的异步补全

在 codex `session.connect()` 的 `onInitialized` 回调（`session-connection.ts:87`）里，
或 `session.ts:249` `onInitialized()` 内，增加一个"连接就绪"钩子：

- 触发 agentManager 对该 agent 的 `refreshRuntimeInfo` + `emitState`（让 app 拿到真实 model/sessionId）
- 挂 `subscribeToSession`（session 事件订阅）

这样 app 先看到 agent（runtime info 暂缺），connect 完成后 `agent_state` 更新补全真实信息。

#### 7.2.4 ensureAgentLoaded 不 await connect

`agent-loading.ts:52-74`：`resumeAgentFromPersistence`/`createAgent` 返回后（session 已构造但可能未连接），
**不再阻塞**。hydrate 也后台化（Slice 3）。`ensureAgentLoaded` 仅保证 agent 在 agentManager 中可见。

### 7.3 其他 provider 的考量

- **Claude**（`providers/claude/client.ts:178`）：`createSession` 本就**不 spawn**（SDK 在首个 `query()` 时 spawn，
  `query.ts:85`）——已天然解耦，**无需改动**。
- **OpenCode**（`providers/opencode/client.ts:141`）：`acquireServer` spawn 共享 server（`server-manager.ts:257`），
  `session.create` 是 HTTP 调用。可评估是否同样解耦，但 OpenCode 是 shared server，spawn 一次后复用，
  阻塞仅首次——**低优先，本切片先只改 codex + 通用 register 层**。
- **通用 register 层**（`agent-session-registration-controller.ts`）的"容忍未连接"改动对所有 provider 生效，
  Claude 天然受益（它本就未连接）。

### 7.4 改动文件

- `packages/server/src/server/agent/providers/codex/client.ts`
  - `createSession`/`resumeSession`：构造 session 对象，删除/可选化 `await session.connect()`
- `packages/server/src/server/agent/providers/codex/session.ts` 或 `session-connection.ts`
  - `onInitialized` 增加"连接就绪"钩子（触发 runtime info 补全）
- `packages/server/src/server/agent/agent-session-registration-controller.ts`
  - `register`：`refreshRuntimeInfo`/`refreshSessionState` 检测 `isConnected()`，未连接跳过 + 后台补全
- `packages/server/src/server/agent/agent-session-lifecycle-controller.ts`
  - `create`/`resume`：注释 `createSession` 返回值可能未连接；register 已容忍
- `packages/server/src/server/agent/agent-loading.ts`
  - `ensureAgentLoaded`：确认不依赖 session 已连接（仅依赖 agent 在 agentManager 可见）

### 7.5 测试

`agent-session-registration-controller.test.ts`（追加）：

| #   | 场景                          | 断言                                        |
| --- | ----------------------------- | ------------------------------------------- |
| 1   | register 未连接 session       | lifecycle=idle，runtimeInfo 用 config，不抛 |
| 2   | connect 完成后补全            | refreshRuntimeInfo + emitState 被调用       |
| 3   | 已连接 session（Claude 路径） | 行为不变（refreshRuntimeInfo 正常）         |

`providers/codex/client.test.ts`（追加）：

| #   | 场景                           | 断言                                                   |
| --- | ------------------------------ | ------------------------------------------------------ |
| 4   | createSession 不 await connect | 返回 session 对象，`isConnected()` === false           |
| 5   | startTurn 触发 connect         | `connect()` 被调用，spawn 发生在 startTurn 内          |
| 6   | connect 失败（spawn 失败）     | startTurn 抛错 → forwardTurn 发 turn_failed（约束 11） |
| 7   | resume 路径同 create           | 未连接返回，startTurn 内 connect                       |

### 7.6 验收

- 聚焦 vitest 全绿（registration + codex client）；typecheck/lint
- **真实 daemon 验证**（`CHISACODE_LOG_LEVEL=trace`）：首次发送 codex agent，
  `accepted` 在 `session.connect()` spawn 之前返回（日志时序：send_agent_message_response 先于
  `provider.codex.session.connect` 的 spawn 行）；startTurn 内才出现 spawn

---

## 8. Slice 5 — 发送非阻塞化 + protocol pendingRun（P0，依赖 Slice 4）

### 8.1 方案（server）

`handleSendAgentMessageRequest`（`agent-lifecycle-handler.ts:156-259`）：

1. `sendPromptToAgent`（`ensureAgentLoaded` 已不 await connect（Slice 4）+ 后台化 hydrate（Slice 3）+
   `normalizeConfig` 复用缓存（Slice 1））后得到 `dispatchResult`
2. **删除 `await waitForAgentRunStartWithTimeout`**（`:225-237`）
3. 非 out-of-band 发送：**立即**回 `accepted: true, error: null, pendingRun: true`
   （run-start 失败已由 `forwardTurn` 发 `turn_failed` + `agent_state{error}`，约束 1+11；
   createSession 构造失败仍 `accepted:false`，约束 2）
4. out-of-band 发送：维持现状（`accepted: true`，无 pendingRun）

### 8.2 protocol（可选字段，符合 AGENTS.md）

`packages/protocol/src/agent/messages.ts:575-583`：

```ts
export const SendAgentMessageResponseMessageSchema = z.object({
  type: z.literal("send_agent_message_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    accepted: z.boolean(),
    error: z.string().nullable(),
    pendingRun: z.boolean().optional(), // ← 新增：true = run 已派发但未启动，失败经事件上报
  }),
});
```

### 8.3 CLI 适配

`packages/cli/src/commands/agent/send.ts`：

- wait 路径 `waitForFinish`（`send.ts:224`）已捕获 error/turn_failed 终态，`buildSendResult` 报 `status:"error"`——无需改
- `--no-wait`：文档化"run 启动失败不在此报告"（行为对齐 wait 路径，不丢错误）

### 8.4 改动文件

- `packages/server/src/server/session-handlers/agent-lifecycle-handler.ts`
  - `handleSendAgentMessageRequest`：删 `waitForAgentRunStartWithTimeout`，立即回 `accepted:true, pendingRun:true`
- `packages/protocol/src/agent/messages.ts`
  - `SendAgentMessageResponseMessageSchema` 加 `pendingRun` 可选
- `packages/client/src/daemon-client-agent-interaction.ts`
  - `sendAgentMessage` 返回值带上 `pendingRun`（类型扩展）
- `packages/cli/src/commands/agent/send.ts`
  - `--no-wait` 注释行为变更

### 8.5 测试

`agent-lifecycle-handler.test.ts`（追加）：

| #   | 场景                                             | 断言                                                               |
| --- | ------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | 普通发送                                         | `accepted:true, pendingRun:true` 立即返回（不等 connect/run 启动） |
| 2   | ensureAgentLoaded 失败（createSession 构造失败） | `accepted:false, error`（维持现状）                                |
| 3   | out-of-band 命令                                 | `accepted:true`，无 pendingRun                                     |
| 4   | run-start 失败（mock startTurn/connect throw）   | 已发 `turn_failed` + `agent_state{error}`（不靠 accepted:false）   |

protocol 测试：旧客户端（无 pendingRun）仍能 parse 新响应。

### 8.6 验收

- 聚焦 vitest 全绿；protocol typecheck
- **真实 daemon + 真实 web Playwright**：首次发送 `accepted` 在毫秒级返回（先于 codex spawn）；
  run 启动成功 → busy 由 projection ack 释放；run 启动失败 → app 收到 error 事件并显示

---

## 9. Slice 6 — app busy 事件驱动 + 兜底超时（P0，依赖 Slice 5）

### 9.1 现状

`isSubmitBusy = (isProcessing && !isServerAdopted) || isSubmitLoading`（`index.tsx:644`）。
`isProcessing` 绑 RPC promise（`submit.ts:57`）。现状 RPC 阻塞 15s，故 `isProcessing` 充当上限。
非阻塞化后 RPC 毫秒级返回，`isProcessing` 立即 false——busy 完全依赖 `isServerAdopted`
（projection ack，`session-stream-reducers.ts:419-463`）。

### 9.2 方案

busy 公式调整为**投影 ack 主导**（T3 LocalDispatch 语义）：

```ts
const isSubmitBusy = (!isServerAdopted && hasPendingSend && !hasTerminalError) || isSubmitLoading;
```

- `hasPendingSend`：`pendingSendMessageId !== null`（已有）
- `hasTerminalError`：agent 进入 `error` 生命周期，或 stream 出现 send 级 error → 释放 busy 并报错
- `isProcessing` 降级为**提交去重**（防连点），不再作为 busy 上限
- **兜底超时**（替代被移除的 RPC 15s）：`hasPendingSend` 且无 ack 无 error 时，~30s 释放并报
  "发送超时，请重试"（用 `vi.waitFor`/事件驱动实现，非固定 sleep）

ack 信号短路（已有，确认保留，`session-stream-reducers.ts:419-463`）：

1. pending permission → 释放
2. agent status error → 释放 + 报错
3. idle-after-non-idle / closed → 释放
4. 同 id canonical 投影 → 释放（成功）
5. latest canonical user id 漂移过 baseline → 释放
6. 乐观条目后 turn progress → 释放

### 9.3 改动文件

- `packages/app/src/composer/index.tsx`
  - `isSubmitBusy` 公式调整；新增 `hasTerminalError`（订阅 agent error 状态）
  - 兜底超时（`hasPendingSend` 起 30s 计时器，ack/error/重置时清理）
- `packages/app/src/composer/use-composer-send-projection-ack.ts`
  - `hasServerAcknowledgedComposerSend` 增加对 `agent_state{error}` 的短路（已有 error 信号，确认接线）
- `packages/app/src/composer/submit.ts`
  - `isProcessing` 语义注释为"提交去重"，不再注释为 busy 上限

### 9.4 测试

`use-composer-send-projection-ack.test.ts` / `session-stream-reducers.test.ts`（追加）：

| #   | 场景                       | 断言                       |
| --- | -------------------------- | -------------------------- |
| 1   | 发送后 projection ack 到达 | busy 释放（成功）          |
| 2   | 发送后 agent_state error   | busy 释放 + 报错           |
| 3   | 发送后 30s 无 ack 无 error | busy 释放 + "发送超时"     |
| 4   | 发送后 pending permission  | busy 释放（待用户操作）    |
| 5   | 连点发送                   | 第二次被 isProcessing 去重 |

### 9.5 验收

- 聚焦 vitest 全绿
- **真实 web Playwright 定向 spec**（新增 `e2e/send-nonblocking.spec.ts`）：
  - 发送 → 断言 `accepted` 毫秒级返回（监听 WS）
  - run 启动成功 → busy 经 projection ack 释放
  - mock startTurn 失败 → app 显示 error
  - 连点 → 只发一条
- **packaged Electron 真实验证**（AGENTS.md 桌面规则）：busy 释放、连点、失败报错

---

## 10. Slice 7 — 新建 agent 非阻塞化 + app 错误补丁（P0，依赖 Slice 5）

### 10.1 方案（server）

`handleCreateAgentRequest`（`agent-lifecycle-handler.ts:623-739`）：

1. `createAgentCommand` 拆分：`createAgent`（createSession 构造不 await connect（Slice 4）+ 后台 hydrate（Slice 3））后
   **立即** `forwardAgentUpdate` + 发 `status:agent_created { pendingRun: true }`
2. `sendInitialPrompt` 改为**不阻塞 status 回执**：fire-and-forget 启动
   `startCreatedAgentInitialPrompt`（其内部 `waitForAgentRunStartWithTimeout` 移除，同 Slice 5；
   connect 在 startTurn 内发生，Slice 4）
3. 初始 prompt 失败**不再**变成 `agent_create_failed`（`create.ts:229 promptFailure:"throw"` →
   改为不抛、仅事件上报）；`agent_create_failed` 保留给"createSession 构造/worktree 失败"这类
   创建级失败（同步、在 status 之前）

### 10.2 protocol

`AgentCreatedStatusPayloadSchema`（`messages.ts:398-403`）加 `pendingRun: z.boolean().optional()`。
`AgentCreateFailedStatusPayloadSchema` 不变（仅创建级失败用）。

### 10.3 方案（app）

draft→real handoff 不依赖 run-start（约束 5），但需补"初始 prompt 失败"展示：

- `optimistic-create` continuity（`agent-panel.tsx:871-885`）当前显示 `status:"running"`；
  需处理 `agent_state{error}` 到达时切为错误态
- `create-flow.ts`：`CREATE_FAILED` 现由 `createAgent` 抛错触发（`agent_create_failed`）；
  非阻塞化后，初始 prompt 失败经 `agent_update{error}` 到达——新增监听：
  若 `pending.lifecycle === "sent"` 且 agent 进入 error → 显示 formErrorMessage
  （复用现有 error 展示，不新增 UI 体系）

### 10.4 改动文件

- `packages/server/src/server/agent/create-agent/create.ts`
  - `createAgentCommand`：`sendInitialPrompt` 改 fire-and-forget；`promptFailure` 默认改为不抛
  - `sendInitialPrompt`：移除 `waitForAgentRunStartWithTimeout`（`agent-prompt.ts:265-266`）
- `packages/server/src/server/session-handlers/agent-lifecycle-handler.ts`
  - `handleCreateAgentRequest`：`createAgent` 后立即发 `agent_created { pendingRun: true }`；
    `sendInitialPrompt` 后台
- `packages/protocol/src/agent/messages.ts`
  - `AgentCreatedStatusPayloadSchema` 加 `pendingRun` 可选
- `packages/app/src/composer/draft/create-flow.ts`
  - 监听 `agent_update{error}`（`pending.lifecycle === "sent"` 时）→ 错误展示
- `packages/app/src/panels/agent-panel.tsx`
  - `optimistic-create` continuity 处理 error 状态

### 10.5 测试

server `agent-lifecycle-handler.test.ts`（追加）：

| #   | 场景                                             | 断言                                                                        |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| 1   | 新建 agent                                       | `agent_created { pendingRun:true }` 在 session 构造后立即回（不等 connect） |
| 2   | createSession 构造失败                           | `agent_create_failed`（创建级，同步）                                       |
| 3   | 初始 prompt 失败（mock startTurn/connect throw） | `agent_created` 已回；后续 `agent_state{error}` 事件                        |

app `create-flow` 测试（追加）：

| #   | 场景                                    | 断言                        |
| --- | --------------------------------------- | --------------------------- |
| 4   | `agent_created` 到达                    | handoff 完成，显示 running  |
| 5   | `agent_created` 后 `agent_state{error}` | 切错误态 + formErrorMessage |

### 10.6 验收

- 聚焦 vitest 全绿
- **真实 web Playwright + packaged Electron**：新建 agent 发首条 prompt，
  `agent_created` 毫秒级回，draft→real 立即切换，回复随后到达；
  mock 初始 prompt 失败 → 错误正确显示

---

## 11. Slice 8 — session idle reaper（P2，低风险，独立）

### 11.1 问题

ChisaCode 无 session 级 reaper（调查 grep 无结果）。长期运行后多个 agent 的 codex `app-server`
子进程累积驻留。T3 用 `ProviderSessionReaper`（30min 不活跃 / 5min 扫描，`ProviderSessionReaper.ts:16-17`）
回收无活跃 turn 的 session。

### 11.2 方案

借鉴 T3，在 daemon 侧加一个 session reaper：

- 扫描间隔 5min；不活跃阈值 30min；跳过有 `activeForegroundTurnId` 的 agent
- 对超时 agent 调用 `agentManager.closeAgent`（或等价的 session dispose），保留 agent record
  （仅回收 provider 子进程，不删 agent）
- 复用时若 agent 仍在 record 但 session 已关，下次发送经 `ensureAgentLoaded` 重新 resume
  （Slice 4 解耦后 resume 也只构造 session，connect 推迟 startTurn）

### 11.3 改动文件

- `packages/server/src/server/agent/agent-session-reaper.ts`（新建）
- `packages/server/src/server/bootstrap.ts`：装配 reaper 定时器

### 11.4 测试

`agent-session-reaper.test.ts`（新建）：

| #   | 场景                       | 断言                    |
| --- | -------------------------- | ----------------------- |
| 1   | 30min 不活跃 + 无活跃 turn | 回收（session dispose） |
| 2   | 有活跃 turn                | 跳过                    |
| 3   | < 30min                    | 不回收                  |
| 4   | 回收后 agent record 仍在   | 下次发送重新 resume     |

### 11.5 验收

- 聚焦 vitest 全绿
- **真实 daemon 验证**：长跑后 `ps` 确认 idle codex 子进程被回收；再次发送 agent 正常 resume

---

## 12. 里程碑与验收节奏

| 里程碑 | 内容                              | 验收                                                       |
| ------ | --------------------------------- | ---------------------------------------------------------- |
| M1     | Slice 1 + 2（冗余 spawn + 预热）  | 聚焦 vitest + 真实 daemon 日志无 listModels spawn          |
| M2     | Slice 3（hydration 后台化）       | vitest + 真实 daemon 长会话首送无串行 thread/read          |
| M3     | **Slice 4（session 解耦 ★核心）** | vitest + 真实 daemon accepted 先于 codex spawn             |
| M4     | Slice 5（发送非阻塞 + protocol）  | vitest + protocol + 真实 web Playwright accepted 毫秒级    |
| M5     | Slice 6（app busy 事件驱动）      | vitest + Playwright busy/error/连点 + packaged Electron    |
| M6     | Slice 7（新建 agent 非阻塞）      | vitest + Playwright + packaged Electron draft→real + error |
| M7     | Slice 8（reaper，独立）           | vitest + 真实 daemon 长跑回收                              |

每切片独立提交：`perf(server): eliminate redundant listModels spawn (1)` 等。

---

## 13. 门禁与验证矩阵（AGENTS.md 合规）

每次提交前：

- [ ] `npx vitest run <改动文件> --bail=1`（绝不跑全量套件）
- [ ] `npm run typecheck`（涉及 package 加对应 workspace）
- [ ] `npm run lint -- <改动文件>`
- [ ] `npm run format:files -- <改动文件>`（如偏离）
- [ ] 无新增固定 sleep；等待用 `vi.waitFor` / 事件驱动
- [ ] 无 `vi.mock` / JSDOM 冒充平台验证

平台验证要求（AGENTS.md：不以 web preview 代替 desktop/mobile）：

| 切片                       | 验证表面                                                         |
| -------------------------- | ---------------------------------------------------------------- |
| 1, 2, 3, 8（server）       | 真实 daemon（`CHISACODE_LOG_LEVEL=trace` 日志证据）              |
| **4（session 解耦 ★）**    | 真实 daemon 日志（accepted 先于 codex spawn）+ codex client 单测 |
| 5（发送非阻塞 + protocol） | 真实 web Playwright（accepted 毫秒级）+ protocol typecheck       |
| 6（app busy）              | 真实 web Playwright + **packaged Electron**                      |
| 7（新建 agent）            | 真实 web Playwright + **packaged Electron**                      |

UI 结论只来自真实目标表面；native 代码零改动的切片声明"未验证 native"。

---

## 14. 风险与回滚

| 风险                                                      | 缓解                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **session 解耦后 connect 失败丢错误**                     | `forwardTurn` 的 `startTurn` 内 `connect()` 失败 → `turn_failed` + `agent_state{error}`（约束 11）；`createSession` 构造失败仍同步 `accepted:false`（约束 2） |
| **register 容忍未连接导致 runtime info 缺失**             | connect 完成后 `onInitialized` 钩子异步补 `refreshRuntimeInfo` + `emitState`；app 先看 agent 后补全                                                           |
| 移除 `waitForAgentRunStart` 丢失 run-start 错误的同步上报 | `forwardTurn` 已保证 `turn_failed`+`agent_state{error}`（约束 1）；app 兜底超时 30s                                                                           |
| hydration 后台化导致首次 timeline 空                      | Slice 3 短超时等待 + `hydrating` 信号让 app 重拉；rewind 路径保留                                                                                             |
| CLI `--no-wait` 不报 run-start 失败                       | 文档化；wait 路径 `waitForFinish` 兜底（已验证）                                                                                                              |
| 新建 agent 初始 prompt 失败无 `agent_create_failed`       | app 新增 `agent_state{error}` 监听（Slice 7.3）                                                                                                               |
| `pendingRun`/`hydrating` 字段旧客户端不识别               | `.optional()`，旧客户端忽略（AGENTS.md:95 合规）                                                                                                              |
| reaper 误回收活跃 session                                 | 跳过 `activeForegroundTurnId`；下次发送自动 resume                                                                                                            |

回滚：每切片独立提交，单切片 `git revert` 即可，不互相纠缠。
**Slice 4/5/6/7 语义联动**（session 解耦 + 发送非阻塞 + app busy + 新建），建议同批回滚。
Slice 1/2/3/8 相对独立。

---

## 15. Roadmap 登记

已完成在 `docs/refactors/comprehensive-improvement-roadmap.md` 登记：

- "T3 首次创建/发送启动延迟优化" 条目，开工标 in-progress，每切片完成标 done

---

## 16. 对抗性复审（计划自检，开工前完成）

本计划在呈现前已做对抗性复审，确认无降级/漏洞：

1. **非阻塞化是否丢错误？** 否。`forwardTurn` 在 re-throw 前发 `turn_failed` + `agent_state{error}`
   （`foreground-execution-controller.ts:208-222`），终端事件有保证。`createSession` 构造失败仍同步
   `accepted:false`（约束 2）。connect 失败经 `startTurn` → `forwardTurn` 同样上报（约束 11）。
   CLI wait 路径 `waitForFinish` 兜底。
2. **session 解耦是否丢 runtime info？** 否。register 容忍未连接，connect 完成后 `onInitialized` 钩子
   异步补 `refreshRuntimeInfo` + `emitState`（Slice 4.2.3）。app 先看到 agent（runtime info 暂缺），
   connect 完成后 `agent_state` 更新补全。
3. **hydration 后台化是否丢历史？** 否。`fetchTimelineForClient` 短超时等待 + `hydrating` 信号 +
   rewind 路径保留；最坏返回空 + 重拉，不永久丢。
4. **是否最小方案？** 否。8 个切片覆盖 session 解耦、发送非阻塞、新建、hydration、预热、冗余 spawn、reaper，
   对齐 T3 的"消息即确认 + session 异步追赶"哲学，**消除全部四个可优化瓶颈**（spawn ①②③ + 阻塞 ④），
   非局部补丁。
5. **protocol 是否破坏兼容？** 否。`pendingRun`/`hydrating` 均 `.optional()`，旧客户端忽略。
6. **是否声称未验证项？** 否。每切片有真实表面验证要求（daemon 日志 / Playwright / Electron）。
7. **per-module 复审？** Slice 4/5/6/7 语义联动，其余独立；每切片完成做代码复审 + 对抗性复审再进下一个。
8. **首次对话加载过久是否被完全解决？** 是。瓶颈四层（① listModels 冗余 spawn → Slice 1 消除；
   ② createSession spawn+握手 → Slice 4 解耦到后台；③ 全量 hydrate → Slice 3 后台化；
   ④ waitForAgentRunStart 15s → Slice 5 移除）。无论预热是否完成（Slice 2 是锦上添花），
   `accepted` 都在毫秒级返回，spawn/hydrate 全部后台追赶——这正是 T3 的哲学。

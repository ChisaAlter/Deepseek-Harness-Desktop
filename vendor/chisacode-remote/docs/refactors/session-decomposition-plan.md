# Session God-File Decomposition Plan

`packages/server/src/server/session.ts` — 9116 lines, one `Session` class (declared line 724), 128 handlers, ~60 instance fields, 7 entangled domains. Goal: a **strictly behavior-preserving, incremental** decomposition into per-domain controllers, mirroring the existing `TerminalSessionController`.

## Chosen strategy: controller-context (per-domain option-bag controllers)

Each domain becomes a controller class in its own file with the **exact** contract the repo already proved twice (`TerminalSessionController` at `packages/server/src/terminal/terminal-session-controller.ts`, and `CreateAgentLifecycleDispatch`):

- An **options-bag constructor** injecting only what that domain reads.
- An **owned-type `ReadonlySet`** of message types.
- A **NON-async `dispatch(msg): Promise<void> | undefined`** that checks the owned-type set FIRST and returns `undefined` synchronously on a miss (verified at terminal-session-controller.ts:140-143).
- `start()` wired from `subscribeToOptionalManagers`, `dispose()` called by the shell's ordered `cleanup()`.

Session shrinks to a connection/dispatch shell: it keeps `handleMessage`, the `??` chain (1739-1751), `emit`/`emitBinary`, `sessionLogger`, connection identity, inflight metrics, lifecycle intents, and the **ordered** `cleanup()`. Each `dispatchXMessage` collapses to `return this.xController.dispatch(msg)`.

### Why this is safe at the dispatch seam (verified)

`dispatchInboundMessage` builds `a() ?? b() ?? ... ?? dispatchMiscMessage()` and short-circuits on the first non-`undefined` **Promise object** (not its resolved value). Message-type spaces are **disjoint** (no duplicate `case` labels across switches), so at most one dispatcher matches any message — collapsing to delegation cannot change which handler runs. `dispatchTerminalMessage` (2150-2153) already proves this. Two quirks preserved verbatim: schedule/\* is reached via the chat dispatcher's OWN `default` arm (2183), not the top-level `??`; and `start_workspace_script_request` (a workspace type) is special-cased before terminal delegation (2150).

Rejected alternatives: **feature-module** (free functions + wide context bag) cannot own the live state machines (workspaceUpdatesSubscription, agentUpdatesSubscription, ~25 voice fields) and adds a competing idiom; **mixin-composition** preserves the shared-`this` god object verbatim and requires widening ~325 private fields to protected.

## Slice ordering (least-coupled first)

The task recommended **git/checkout as the first slice — OVERRIDDEN.** Verification: `emitCheckoutStatusUpdate` is called from exactly ONE site (session.ts:4915), inside the workspace-owned `syncWorkspaceGitObserver` callback that ALSO fires workspace effects over shared watch-target maps. Extracting checkout first forces splitting the hardest workspace/git seam before workspace is touched. The strictly safer first cuts are **chat-schedule-loop** (only knot: `handleChatPostRequest`; touches no shared observer/git/voice state) and **provider-catalog** (one shared collaborator + injected predicates).

| #   | Slice                                                                         | Effort | Risk   |
| --- | ----------------------------------------------------------------------------- | ------ | ------ |
| 0   | Test net + disjointness tripwire (no extraction)                              | M      | low    |
| 1   | ChatScheduleLoopController — **STOP FOR REVIEW after green**                  | M      | low    |
| 2   | ProviderCatalogController                                                     | M      | medium |
| 3   | Split shared workspace-git observer + agent-subscribe fan-out (no controller) | M      | high   |
| 4   | GitCheckoutController                                                         | L      | medium |
| 5   | WorkspaceController                                                           | XL     | high   |
| 6   | Voice prereqs: emit() purity + abortController ownership                      | M      | high   |
| 7   | VoiceSessionController                                                        | XL     | high   |
| 8a  | Agent-lifecycle config setters                                                | M      | medium |
| 8b  | AgentLifecycleController                                                      | XL     | high   |

---

## Slice 0 — Test net + disjointness tripwire (prerequisite)

No production code moves. Add `session.dispatch-seam.test.ts`. This is the gate the whole plan rests on, because chat/schedule/loop have **zero** handleMessage coverage today (verified).

Write RED-then-GREEN against the **current in-place** Session:

- `chat/post` happy path (asserts `chat/post` response emitted) + fanout-limit error path (asserts the `chat/post` error envelope, NOT a bubbled `rpc_error`).
- one `schedule/*` and one `loop/*` round-trip.
- a handler that throws **synchronously** emits `rpc_error{code:"handler_error"}` + an `activity_log` error frame.
- a handler that **rejects async** emits the SAME pair.
- a table-driven assertion that the union of all controllers' owned-type `ReadonlySet`s is pairwise disjoint and covers the dispatched `SessionInboundMessage` union (grows as controllers land).

**Tests:** `session.dispatch-seam.test.ts`, `session.test.ts`.

---

## Slice 1 — ChatScheduleLoopController ← STOP FOR HUMAN REVIEW after this ships green

**Move:** all 21 handlers (`handleChat*` ×7, `handleSchedule*` ×9, `handleLoop*` ×5), the three rpc-error emitters (`emitChatRpcError`/`emitScheduleRpcError`/`emitLoopRpcError` — **kept separate, not merged**), `toScheduleSummary` → `packages/server/src/server/chat/chat-schedule-loop-controller.ts`. Collapse `dispatchChatScheduleLoopMessage` + `dispatchScheduleMessage` to `return this.chatScheduleLoopController.dispatch(msg)`.

**SessionContext surface:** `emit`, `sessionLogger`, `clientId` (authorAgentId fallback), `chatService`, `scheduleService`, `loopService`, and a narrow agent-control port `{ listAgents, resolveAgentIdentifier, agentStorage.list }` for `handleChatPostRequest` mention fanout.

**Owned-type set MUST include all 7 `chat/*` + 5 `loop/*` + 9 `schedule/*` types** — schedule/\* is currently routed via the chat dispatcher's own `default` arm, so it must stay inside this one controller, or schedule requests silently no-op.

**Behavior note:** least-coupled domain. Move the three rpc-error emitters verbatim (they differ in default code + the `ChatServiceError` branch). **Tests:** `session.dispatch-seam.test.ts`, `loop-service.test.ts`, `session.test.ts`.

---

## Slice 2 — ProviderCatalogController

**Move:** 7 provider handlers + `emitProviderDisabledResponse` + `getProviderSnapshotEntryForRead` → `packages/server/src/server/provider/provider-catalog-controller.ts`. Move the `providers_snapshot_update` PUSH wiring (1235-1254) into the controller's `start()`/`dispose()`. Collapse `dispatchProviderMessage`.

**SessionContext surface:** `emit`, `sessionLogger`, `providerSnapshotManager` (**shared by reference** — stays a daemon singleton read by checkout/lifecycle/workspace), `isProviderVisibleToClient` (predicate closing over `this`, reads `appVersion` live), `downgradeModeIconsForClient`, `downgradeEntryModesForClient`, agent-control reads `{ listProviderAvailability, listDraftFeatures }`.

**Behavior note:** COMPAT correctness — PUSH and PULL paths MUST call the SAME injected visibility/downgrade closures, reading `appVersion` LIVE (mutated post-construction via `updateAppVersion`). Keep `COMPAT(providersSnapshot)` and `COMPAT(customModeIcons)` comments verbatim. Do NOT pull `resolveStructuredGenerationProviders`/`getFocusedAgentSelectionForCwd` in. **Tests:** `session.dispatch-seam.test.ts`, `daemon-e2e/models.e2e.test.ts`, `session.test.ts`.

---

## Slice 3 — Split the shared observer seams (prerequisite, no controller)

In-place refactor on the shell, two named fan-outs:

1. **workspace-git observer** (4910-4917): make `emitCheckoutStatusUpdate` and `onBranchChanged` injectable callbacks; keep `workspaceGitWatchTargets`/`workspaceGitSubscriptions` shared by reference.
2. **agentManager.subscribe callback** (~1298): refactor into `{ onAgentUpdate, shouldAutoAllowVoicePermission(event), onStreamEvent }`.

**Behavior note:** the single hardest seam, split exactly once before the two domains that co-own it. The observer fires BOTH workspace (`handleWorkspaceGitBranchSnapshot`, `emitWorkspaceUpdateForCwd`) and checkout (`emitCheckoutStatusUpdate`) effects; the agent-subscribe callback is invoked by agent EVENTS (not the `??` chain) and does lifecycle + voice work. Add a test asserting BOTH a `workspace_update` and a `checkout_status_update` fire from one simulated git snapshot change, and a voice-permission test for the auto-allow path. **Tests:** `session.workspace-git-watch.test.ts`, `session.workspaces.test.ts`, `voice-permission-policy.test.ts`, `session.test.ts`.

---

## Slice 4 — GitCheckoutController

**Move:** ~22 `checkout_*`/`stash_*`/PR/github handlers + `handleSubscribeCheckoutDiffRequest`/`handleUnsubscribeCheckoutDiffRequest` + `emitCheckoutStatusUpdate` + `checkoutDiffSubscriptions` → `packages/server/src/server/checkout/git-checkout-controller.ts`. Collapse `dispatchCheckoutMessage`.

**SessionContext surface:** `emit`, `sessionLogger`, `checkoutDiffManager` (move in + dispose teardown), `github` (shared), `workspaceGitService` (**shared spine**), `workspaceGitWatchTargets`/`workspaceGitSubscriptions` (**shared**), `providerSnapshotManager.listRegisteredProviderIds`. `emitCheckoutStatusUpdate` is now owned here and injected back into the workspace observer seam from Slice 3.

**Behavior note:** safe now that Slice 3 split the observer. `checkoutDiffSubscriptions` teardown moves to `dispose()`, called by `cleanup()` at its current ordinal (8530). **Tests:** `session.dispatch-seam.test.ts`, `checkout-diff-manager.test.ts`, `daemon-e2e/checkout-diff-subscription.e2e.test.ts`, `session.test.ts`.

---

## Slice 5 — WorkspaceController (XL)

**Move:** all workspace handlers (incl. re-homed `handleProjectRenameRequest` and `start_workspace_script_request`) + ~25 private workspace helpers + the whole `workspaceUpdatesSubscription` state machine → `packages/server/src/server/workspace/workspace-controller.ts`.

**SessionContext surface:** `emit`, `sessionLogger`, `projectRegistry`/`workspaceRegistry`/`downloadTokenStore`/script stores/editor cache (**owned**), `workspaceGitService` + watch maps (**shared with checkout**), injected `emitCheckoutStatusUpdate`/`onBranchChanged`, `terminalManager`/`killTerminalsUnderPath`, an `agentUpdatesSubscription` write via a narrow `bufferAgentUpdate` command, `providerSnapshotManager.listRegisteredProviderIds`.

**Behavior note:** the workspaceUpdatesSubscription machine moves WHOLE. The eight already-public workspace methods stay a public surface re-exposed via the shell. Re-homes are atomic remove-from-old-dispatcher + add-to-new-owned-set. **Tests:** `session.workspaces.test.ts`, `session.workspace-git-watch.test.ts`, `session.workspace-resolution-invariants.test.ts`, `session.test.ts`.

---

## Slice 6 — Voice prerequisites (emit purity + abort ownership)

In-place, separately reviewable. Split the `audio_output` TTS-debug branch out of `emit()` (8421-8468, bypasses to `onMessage` at 8454) so `emit` is a pure trace+onMessage sink. Move `convertPCMToWavBuffer` (674-701) to `speech/audio.ts`. Decide abortController ownership.

**Behavior note:** TTS-debug split and abortController ownership are the SAME decision (`ttsDebugStreams.clear()` is tied to `createAbortController` reassignment at 8359). Keep `emit` (with the universal trace) on the shell and inject it everywhere — no trace-less emit. Do NOT inject the AbortController by value. Add: a TTS-debug persistence test (with the debug env flag) before the move, and a barge-in→cleanup regression test asserting the NEW run's signal is aborted. **Tests:** `voice-roundtrip.e2e.test.ts`, `voice-permission-policy.test.ts`, `session.test.ts`.

---

## Slice 7 — VoiceSessionController (XL)

**Move:** voice handlers + ~25 voice fields + the TTS-debug hook (Slice 6) + `voiceModeAgentId`/`isVoiceMode` + the `shouldAutoAllowVoicePermission` predicate (Slice 3) → `packages/server/src/server/voice/voice-session-controller.ts`. Carve voice types out of `dispatchVoiceAndControlMessage`, leaving infra (restart/shutdown/heartbeat/ping/abort) on the shell.

**SessionContext surface:** pure `emit`, `emitBinary`, `hasBinaryChannel`, `sessionLogger`/`sessionId`/`chisacodeHome`, `getSpeechReadiness`, agent-control port `{ loadAgent, reloadWithSystemPrompt, interruptIfRunning, isRunning, sendSpokenText, buildAgentPrompt }`, `getSignal`/`abortCurrent` (Slice 6).

**Behavior note:** depends on Slices 3 + 6. `cleanup()` stays the ordered orchestrator and calls `voiceController.dispose()` at the position the inlined voice teardown occupies today (8505-8525). **Tests:** `voice-roundtrip.e2e.test.ts`, `voice-local-agent.e2e.test.ts`, `session.voice-mcp-config.test.ts`, `session.test.ts`.

---

## Slice 8a — Agent-lifecycle config setters

Parameterize the 4 setter envelopes `handleSetAgentMode/Model/Feature/Thinking` (4209-4390) into one helper; re-home `handleListCommandsRequest` (misfiled in `dispatchMiscMessage`). Add a handleMessage-driven **failure** test per setter (force the command to reject, assert both the `*_response{accepted:false}` AND the `activity_log` error frame in order) BEFORE collapsing. **Tests:** `session.test.ts`, `session.lifecycle-boundary.test.ts`.

## Slice 8b — AgentLifecycleController (XL, LAST)

**Move:** remaining lifecycle handlers + the `agentUpdatesSubscription` fan-out (`bufferOrEmitAgentUpdate`, `flushBootstrappedAgentUpdates`, `matchesAgentFilter`, `forwardAgentUpdate`) → `packages/server/src/server/agent/agent-lifecycle-controller.ts`. Collapse the three lifecycle dispatchers.

**SessionContext surface:** `emit`, `sessionLogger`, `agentManager`/`agentStorage` (**owned**), injected `forwardAgentUpdate` → `buildProjectPlacementForCwd` (backed by WorkspaceController), `agentUpdatesSubscription` accessor (owned; workspace writes via `bufferAgentUpdate`), `isProviderVisibleToClient`, `resolveCreateAgentWorkspace`, `supports`, `mcpBaseUrl`, `terminalController.killTerminalForClose`.

**Behavior note:** done LAST — the shared-projection hub. `handleCloseItemsRequest` splits its terminal-kill half from its agent-archive half. **Tests:** `session.test.ts`, `session.wait-for-finish.test.ts`, `session.create-agent-title.test.ts`, `session.lifecycle-boundary.test.ts`, `daemon-client.e2e.test.ts`.

---

## Cross-cutting invariants (every slice)

- **Always** run `npm run typecheck` and `npm run lint` after each slice; run `npm run build:server` before diagnosing cross-package type errors.
- Controller `dispatch` is **NON-async**, guarded by an owned-type `ReadonlySet` check returning `undefined` synchronously on miss. Never `async dispatch`.
- Controllers add **no** try/catch inside `dispatch` — error handling stays in `handleMessage`.
- `cleanup()` stays the single ordered teardown orchestrator on the shell.
- Move domain error emitters **verbatim**; treat any cross-domain emitter merge as a separate, test-guarded change.
- Per-slice typecheck/lint/format via `npm run` scripts; never re-run the full suite locally (run only the listed files with `--bail=1`).

---

## Implementation Progress (2026-06-24~26)

### Strategy adaptation

The original plan called for "controller-context" (per-domain option-bag controllers with owned-type `ReadonlySet` dispatch). Implementation adopted a **simplified variant**: handlers are plain classes receiving a shared `SessionContext` interface, and dispatch stays in Session's existing `dispatchXMessage` methods (delegating to `this.xHandler.dispatch(msg)`). This avoids the owned-type set machinery while achieving the same separation. The `SessionContext` interface is populated incrementally — each handler extraction adds only the members it needs.

### Completed slices

| Step  | Handler file                                     | Lines | Methods moved                                                      | session.ts reduction |
| ----- | ------------------------------------------------ | ----- | ------------------------------------------------------------------ | -------------------- |
| Pre 1 | `session-helpers.ts`                             | 202   | 20 pure functions/types/constants                                  | 9728→9562            |
| Pre 2 | `session-audio.ts`                               | 55    | PCM constants + `convertPCMToWavBuffer`                            | 9562→9474            |
| Pre 3 | `session-internal-types.ts`                      | 69    | 8 internal types + `VoiceFeatureUnavailableError`                  | 9474→9474            |
| Infra | `session-handlers/session-context.ts`            | 243   | `SessionContext` + `DisposableHandler` interfaces (70+ members)    | —                    |
| 1     | `session-handlers/checkout-git-handler.ts`       | 999   | 20 checkout/PR/stash handlers + 7 helpers + 3 file-level functions | 9474→8496            |
| 2     | `session-handlers/chat-schedule-loop-handler.ts` | 523   | 26 chat/schedule/loop handlers                                     | 8496→7943            |
| 3     | `session-handlers/provider-handler.ts`           | 431   | 14 provider/preset/gateway handlers + 4 helpers                    | 7943→7535            |
| 4     | `session-handlers/terminal-script-handler.ts`    | 93    | `handleStartWorkspaceScriptRequest` + terminal dispatch            | 7535→7477            |
| 5     | `session-handlers/workspace-project-handler.ts`  | 795   | 13 workspace/project handlers + 3 helpers                          | 7477→6982\*          |
| 6     | `session-handlers/config-control-handler.ts`     | 770   | skills/mcp/config control handlers                                 | —                    |
| 7     | — (Voice removed)                                | —     | Voice 相关代码全部标记删除，残留 stub 清理                         | —                    |
| 8     | `session-handlers/agent-lifecycle-handler.ts`    | 2259  | Agent lifecycle handlers（最大领域）                               | —                    |

\* 步骤 5/6/7/8 合并为一个 commit (`87e8db8`)，中间行数记为合计效果。

**Total: session.ts 9728 → 2885 lines (-6843, -70.4%).** 7 handlers, 6113 lines of extracted code, Voice code fully removed. 后续清理再减 207 行（删除 5 个死方法/字段 + 35+ 个未使用 import/type）。

### 关联 commits（14 个，已推送 origin/cn-main）

| Commit    | 说明                                                             |
| --------- | ---------------------------------------------------------------- |
| `b00df69` | 抽取 session.ts 纯辅助函数到 session-helpers.ts                  |
| `d51afae` | 抽取 session.ts 音频函数和内部类型                               |
| `0d2b16f` | 新建 session-handlers 目录与 SessionContext 接口                 |
| `2c5e998` | 迁移 stash 方法到 CheckoutGitHandler（渐进式第一步）             |
| `edf4638` | CheckoutGitHandler 完整迁移 15 个 checkout 方法                  |
| `6dee49a` | 删除 session.ts 旧 checkout 方法 + 更新 dispatch                 |
| `d98e89b` | ChatScheduleLoopHandler 拆分                                     |
| `cf46b17` | ProviderHandler 拆分                                             |
| `5abb0c8` | TerminalScriptHandler 拆分                                       |
| `87e8db8` | Voice stub + ConfigControlHandler + WorkspaceProjectHandler 拆分 |
| `0b0d9f2` | AgentLifecycleHandler 拆分完成                                   |
| `29d664a` | 删除 session.ts 中重复 Git 辅助方法                              |
| `b8531db` | Voice 残留代码完全清理 + dispatch-seam 测试                      |
| `2ef7831` | 更新 session 拆分计划实施进度与 AGENTS.md                        |

### Slice 覆盖对照

| 计划 Slice                                        | 内容                                  | 状态                    |
| ------------------------------------------------- | ------------------------------------- | ----------------------- |
| 0 — Test net + disjointness tripwire              | `session.dispatch-seam.test.ts`       | ✅ 17 tests             |
| 1 — ChatScheduleLoopController                    | `chat-schedule-loop-handler.ts`       | ✅                      |
| 2 — ProviderCatalogController                     | `provider-handler.ts`                 | ✅                      |
| 3 — Split shared observer seams                   | `session.workspace-git-watch.test.ts` | ✅                      |
| 4 — GitCheckoutController                         | `checkout-git-handler.ts`             | ✅                      |
| 5 — WorkspaceController                           | `workspace-project-handler.ts`        | ✅                      |
| 6 — Voice prereqs (emit purity + abort ownership) | Voice 代码完全删除                    | ✅ (handled by removal) |
| 7 — VoiceSessionController                        | Voice 代码完全删除                    | ✅ (handled by removal) |
| 8a — Agent-lifecycle config setters               | `session.lifecycle-boundary.test.ts`  | ✅                      |
| 8b — AgentLifecycleController                     | `agent-lifecycle-handler.ts`          | ✅                      |

### session.ts 剩余 2885 行代码分布

| 大类                          | 估计行数 | 占比  | 说明                                                                 |
| ----------------------------- | -------- | ----- | -------------------------------------------------------------------- |
| imports/类型定义/接口         | ~180     | 6.4%  | imports + SessionOptions + 内部类型 + free functions                 |
| 构造函数 + SessionContext     | ~285     | 10.1% | constructor + createSessionContext                                   |
| 消息分发 dispatch             | ~240     | 8.5%  | handleMessage + 7 个 dispatch\* 方法                                 |
| Agent 辅助方法                | ~350     | 12.1% | buildAgentPayload/forwardAgentUpdate 等                              |
| Workspace/Git 辅助 + worktree | ~1030    | 35.7% | 查找/创建/描述 workspace、git observer/watch、worktree、脚本         |
| 结构化生成 (commit/PR text)   | ~150     | 5.3%  | generateCommitMessage/generatePullRequestText                        |
| Cleanup / emit / abort        | ~180     | 6.4%  | cleanup/emit/emitBinary                                              |
| 字段声明/暴露方法/其他        | ~205     | 7.3%  | 属性声明 + getClientActivity/getRuntimeMetrics + SessionRequestError |

### 测试文件（9 个 session 相关测试）

- `session.test.ts`
- `session.dispatch-seam.test.ts` — Slice 0
- `session.lifecycle-boundary.test.ts` — Slice 8a
- `session.workspace-git-watch.test.ts` — Slice 3
- `session.workspaces.test.ts`
- `session.workspace-resolution-invariants.test.ts`
- `session.voice-mcp-config.test.ts`
- `session.create-agent-title.test.ts`
- `session.wait-for-finish.test.ts`

### Key design decisions

- **`createSessionContext()` factory**: Session builds one context object shared by all handlers, eliminating per-handler duplication.
- **Cross-domain methods on SessionContext**: `notifyGitMutation`, `emitWorkspaceUpdateForCwd`, `generateCommitMessage`, `resolveAgentIdentifier`, `supports`, `emitWorkspaceScriptStatusUpdate` — owned by Session core, exposed via interface.
- **Duplicate helpers accepted**: `assertSafeGitRef`, `isWorkingTreeDirty`, `ensureCleanWorkingTree`, `checkoutExistingBranch` kept in both Session (called by non-checkout code) and CheckoutGitHandler (independent copy). Acceptable tradeoff to avoid over-exposing Session internals.
- **`github` field non-optional**: SessionContext declares `github: GitHubService` (not `| undefined`) because Session's constructor always creates one via `github ?? createGitHubService()`.
- **Voice 代码完全删除**: 原始计划 Step 7 VoiceController 拆分被 Voice 代码完全删除替换（项目已不支持 Voice）。

### 后续可优化项

- session.ts 中 Workspace/Git 辅助方法（~1030 行，35.7%）仍可考虑进一步提取为 `workspace-core.ts` 等独立模块
- Agent 辅助方法（~350 行）可视情况提取到独立的 agent 辅助模块
- SessionContext 接口（70+ 成员）可考虑按域拆分为多个子接口

### Verification

All commits passed: `typecheck` (full workspace) ✔, `lint` (oxlint) ✔, `format` (oxfmt) ✔, `session.wait-for-finish.test.ts` ✔.

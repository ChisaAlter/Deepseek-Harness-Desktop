# Comprehensive Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use workflow:subagent-driven-development (recommended) or workflow:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复全面审查确认的全部 P1 与设计纳入的高价值 P2，并用兼容门禁、定向回归测试和项目级质量检查证明修复有效。

**Architecture:** 按信任边界和状态机拆成 11 个独立任务。Wire 兼容先于 GenUI 行为变更；安全路径和凭据修复先于 UI/平台修复；每个任务独立执行 RED→GREEN→REFACTOR，并独立提交。

**Tech Stack:** TypeScript、Zod、Vitest、Node.js、React Native/Expo、Electron、Kotlin Android、GitHub Actions、npm workspaces。

## Global Constraints

- 使用 PATH 中的 Node.js 和 npm workspace；不得引入 pnpm/yarn。
- 不删除或收窄既有 wire 字段；新增字段 optional/defaulted，兼容 shim 标记 `COMPAT(name)` 与移除目标。
- 新 RPC 使用 dotted `.request` / `.response` 名称；旧 flat RPC 在兼容窗口内继续解析。
- 测试使用真实临时文件系统或 typed fake port；不得新增 `vi.mock`、固定 sleep、弱断言或条件 skip。
- 只运行修改过的 Vitest 文件：`npx.cmd vitest run <path> --bail=1`；不得运行完整 workspace/package suite。
- Desktop smoke 不得动态运行；移动端验证不得用 Web 结果替代。
- Electron `contextIsolation`、`nodeIntegration:false`、webview attach 校验和 privileged IPC sender 校验不得弱化。
- AppImage 之外不得扩展 `--no-sandbox`。
- 每完成一个系统性任务，更新 `docs/refactors/comprehensive-improvement-roadmap.md` 状态；完成项保留历史记录。
- 代码风格使用 oxfmt；定向 lint 通过 `npm run lint -- <paths>`。

---

### Task 1: Schedule ID 路径安全

**Files:**

- Create: `packages/protocol/src/schedule/rpc-schemas.test.ts`
- Modify: `packages/protocol/src/schedule/rpc-schemas.ts`
- Modify: `packages/server/src/server/schedule/store.ts`
- Modify: `packages/server/src/server/schedule/store.test.ts`
- Modify: `packages/server/src/server/schedule/service.test.ts`

**Interfaces:**

- Produces: `ScheduleIdSchema: z.ZodString`
- Produces: `ScheduleStore.filePath(id)` 在任何调用点都不能解析到 `this.dir` 外。

- [ ] **Step 1: 写 RPC schema 失败测试**

```ts
test.each(["../config", "..\\config", "a/b", "a\\b", "", "a".repeat(129)])(
  "rejects unsafe schedule id %j",
  (scheduleId) => {
    expect(
      ScheduleDeleteRequestSchema.safeParse({
        type: "schedule/delete",
        requestId: "req_1",
        scheduleId,
      }).success,
    ).toBe(false);
  },
);
```

- [ ] **Step 2: 运行 RED**

Run: `npx.cmd vitest run packages/protocol/src/schedule/rpc-schemas.test.ts --bail=1`  
Expected: FAIL，因为 `../config` 当前被 `z.string()` 接受。

- [ ] **Step 3: 写 store 越界失败测试**

在真实临时目录中创建 `schedules/` 与相邻 `config.json`，调用 `store.delete("../config")`，断言 reject 且相邻文件仍存在。

- [ ] **Step 4: 运行 store RED**

Run: `npx.cmd vitest run packages/server/src/server/schedule/store.test.ts --bail=1`  
Expected: FAIL，相邻文件被删除或操作未拒绝。

- [ ] **Step 5: 实现共享 schema 与 store 防御**

```ts
export const ScheduleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
```

RPC 中每个客户端可控 `scheduleId` 改用该 schema。store 使用 `resolve(this.dir, `${id}.json`)`，并要求 `dirname(candidate) === resolve(this.dir)`，否则抛 `Invalid schedule id`。

- [ ] **Step 6: 运行 GREEN**

Run:

```text
npx.cmd vitest run packages/protocol/src/schedule/rpc-schemas.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/schedule/store.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/schedule/service.test.ts --bail=1
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

Run `git add -- <Task 1 files>` followed by `git commit -m "fix(server): constrain schedule ids to schedule storage"`.

### Task 2: Script proxy 凭据剥离

**Files:**

- Modify: `packages/server/src/server/script-proxy.ts`
- Modify: `packages/server/src/server/script-proxy.test.ts`

**Interfaces:**

- Produces: `sanitizeForwardedHeaders(headers)` 删除 HTTP daemon auth。
- Produces: `sanitizeWebSocketProtocols(value)` 删除 `chisacode.bearer.*`，保留其他子协议。

- [ ] **Step 1: 写 HTTP/WS RED 测试**

真实启动本地 upstream HTTP server，通过 proxy 请求后断言 upstream 不含 `authorization`。WS upgrade 测试传入 `chat.v1, chisacode.bearer.secret`，断言 upstream 只收到 `chat.v1`。

- [ ] **Step 2: 运行 RED**

Run: `npx.cmd vitest run packages/server/src/server/script-proxy.test.ts --bail=1`  
Expected: FAIL，upstream 当前能读到 daemon bearer。

- [ ] **Step 3: 实现最小剥离**

在 header copy 后无条件删除 `authorization`。对 `sec-websocket-protocol` 按逗号拆分、trim、过滤 bearer token；结果为空则删除 header，否则用 `, ` 重新连接。

- [ ] **Step 4: 运行 GREEN 并定向 lint**

Run test above, then `npm run lint -- packages/server/src/server/script-proxy.ts packages/server/src/server/script-proxy.test.ts`.

- [ ] **Step 5: Commit**

Run `git add -- packages/server/src/server/script-proxy.ts packages/server/src/server/script-proxy.test.ts` followed by `git commit -m "fix(server): strip daemon credentials from script proxy"`.

### Task 3: Packaged smoke 隔离与 PID 所有权

**Files:**

- Create: `packages/desktop/scripts/smoke-packaged-desktop-app.test.ts`
- Modify: `packages/desktop/scripts/smoke-packaged-desktop-app.js`
- Modify: `packages/server/src/server/pid-lock.ts`
- Modify: `packages/server/src/server/pid-lock.test.ts`
- Modify: `packages/server/src/server/exports.ts`
- Modify: `packages/cli/src/commands/daemon/local-daemon.ts`
- Modify: `packages/cli/src/commands/daemon/local-daemon.supervision.test.ts`
- Modify: `docs/development.md`

**Interfaces:**

- Produces: smoke env 显式包含临时 `CHISACODE_HOME`。
- Produces: server root export `getPidLockOwnerStatus(lock): Promise<"match" | "mismatch" | "unknown" | "not_running">`，CLI 在 RPC fallback signal 前复用该 verifier。

- [ ] **Step 1: 写 smoke env RED 测试**

导出纯 helper `createSmokeRuntime()`；断言 desktop env、CLI env 和 cleanup stop env 使用相同临时 home，且不删除 `CHISACODE_HOME`。

- [ ] **Step 2: 运行 RED**

Run: `npx.cmd vitest run packages/desktop/scripts/smoke-packaged-desktop-app.test.ts --bail=1`  
Expected: FAIL，因为 helper 不存在且当前 env 删除 home。

- [ ] **Step 3: 写 PID 复用 RED 测试**

复用 `pid-lock.ts` 已有的 Windows CreationDate、Linux `/proc/<pid>/stat`、POSIX `ps etimes` 实现，提取 `getPidLockOwnerStatus`。在临时 home 写入指向测试 fixture 的 PID，但使用不匹配的 `startedAt`；调用 stop，断言 fixture 仍运行且结果说明 owner identity mismatch。

- [ ] **Step 4: 实现隔离 runtime 和 fail-closed signal**

smoke 创建 `smokeHome` 与 `userData`，所有子命令继承同一 home；finally 删除两者。CLI 只在 owner status 为 `match` 时 signal；`mismatch`、`unknown` 和 `not_running` 均不 signal。server 的既有 lock acquisition 把 `match` 与 `unknown` 都视为已有 owner，保持 fail-safe 启动语义。

- [ ] **Step 5: 运行 GREEN**

Run:

```text
npx.cmd vitest run packages/desktop/scripts/smoke-packaged-desktop-app.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/pid-lock.test.ts --bail=1
npx.cmd vitest run packages/cli/src/commands/daemon/local-daemon.supervision.test.ts --bail=1
```

Do not run packaged smoke.

- [ ] **Step 6: 更新文档并 Commit**

文档明确 smoke 使用隔离 home，不会操作默认 daemon。Commit: `fix(desktop): isolate packaged smoke daemon state`.

### Task 4: Loop 取消与 relay 连接容量

**Files:**

- Modify: `packages/server/src/server/loop-service.ts`
- Modify: `packages/server/src/server/loop-service.test.ts`
- Modify: `packages/server/src/server/relay-transport.ts`
- Modify: `packages/server/src/server/relay-transport.test.ts`

**Interfaces:**

- `runVerifyCheck({ cwd, command, signal, timeoutMs })`
- Constants: `MAX_RELAY_CONNECTION_IDS = 256`, `MAX_RELAY_CONNECTION_ID_LENGTH = 128`.

- [ ] **Step 1: 写 verify abort RED 测试**

使用 injected command runner port，返回仅在 signal abort 时 reject 的 Promise。启动 loop、进入 verify、调用 stop，断言 stop resolve、runner 收到 aborted signal、loop 状态为 stopped。

- [ ] **Step 2: 写 relay cap RED 测试**

发送 257 个唯一 ID 的 sync，断言 createWebSocket 调用不超过 256；超长/非法 ID 不创建 socket；重复 ID 只创建一次。

- [ ] **Step 3: 运行 RED**

Run loop and relay test files separately; both must fail for the expected missing limits.

- [ ] **Step 4: 实现 signal/deadline 与容量限制**

把 loop AbortSignal 传给 child-process runner；signal abort 时重新抛 `Loop aborted`，不能转成普通 verify failure。relay parser 规范化、去重、限制输入；`ensureClientDataSocket` 在 Map 达到上限时记录 warn 并返回。

- [ ] **Step 5: 运行 GREEN、lint、Commit**

Commit: `fix(server): bound relay sockets and cancel loop verification`.

### Task 5: GenUI wire compatibility 与单一渲染源

**Files:**

- Modify: `packages/protocol/src/client-capabilities.ts`
- Modify: `packages/protocol/src/messages.ts`
- Modify: `packages/protocol/src/generative-ui/rpc-schemas.ts`
- Modify: `packages/protocol/src/generative-ui/rpc-schemas.test.ts`
- Modify: `packages/server/src/server/agent/agent-manager.ts`
- Modify: `packages/server/src/server/agent/agent-manager-gen-ui-integration.test.ts`
- Modify: `packages/server/src/server/session-handlers/agent-lifecycle-handler.ts`
- Modify: `packages/server/src/server/wire-compat.test.ts`
- Modify: `packages/client/src/daemon-client.ts`
- Modify: `packages/client/src/daemon-client.test.ts`

**Interfaces:**

- `CLIENT_CAPS.generativeUi = "generative_ui"`.
- `server_info.features.generativeUi?: boolean`.
- New RPC types: `generative_ui.action.request` / `.response`.
- Legacy flat names remain accepted as `COMPAT(generativeUiActionFlatRpc)`.

- [ ] **Step 1: 写 compatibility RED 测试**

旧 client schema 解析不含 GenUI item 的 timeline response；未声明 capability 的 session 不发 GenUI event；新 client 对 feature=false/缺失时拒绝发送 action。

- [ ] **Step 2: 写 single-source RED 测试**

更新 integration test：含 fence 的 assistant event 最终 timeline 只有一条 `assistant_message`，不再有第二条 `generative_ui`。

- [ ] **Step 3: 运行 RED**

Run protocol RPC, server integration, wire-compat and client tests separately.

- [ ] **Step 4: 实现 capability、feature 和 RPC shim**

hello 宣告 GenUI capability；server_info 宣告 feature；新 client 发送 dotted RPC。server parser 同时接受 legacy/new，response 与请求命名配对。移除 fence 检测后自动追加 timeline row 的路径。

- [ ] **Step 5: 运行 GREEN、重建 producer 包并 Commit**

Run `npm run build:client` before cross-package type diagnosis. Commit: `fix(gen-ui): gate wire support and remove duplicate fence rows`.

### Task 6: GenUI action 排队、验证和失败恢复

**Files:**

- Create: `packages/server/src/server/agent/generative-ui-action-queue.ts`
- Create: `packages/server/src/server/agent/generative-ui-action-queue.test.ts`
- Modify: `packages/server/src/server/agent/agent-manager.ts`
- Modify: `packages/server/src/server/agent/agent-manager.test.ts`
- Modify: `packages/server/src/server/session-handlers/generative-ui-handler.ts`
- Create: `packages/server/src/server/session-handlers/generative-ui-handler.test.ts`
- Modify: `packages/server/src/server/session-handlers/session-context.ts`
- Modify: `packages/app/src/generative-ui/generative-ui-renderer.tsx`
- Modify: `packages/app/src/generative-ui/registry/registry.ts`
- Modify: `packages/app/src/generative-ui/use-generative-ui-action.ts`
- Create: `packages/app/src/generative-ui/action-dispatch.ts`
- Create: `packages/app/src/generative-ui/action-dispatch.test.ts`
- Modify: `packages/app/src/generative-ui/components/generative-form-card.tsx`
- Create: `packages/app/src/generative-ui/components/generative-form-state.ts`
- Create: `packages/app/src/generative-ui/components/generative-form-state.test.ts`

**Interfaces:**

- `AgentManager.enqueueGenerativeUiAction(agentId, action): { queued: true }`.
- `GenerativeUiActionQueue` is owned once by AgentManager, so actions from multiple client sessions share ordering and coalescing.
- Component `sendAction` continues returning `Promise<boolean>`; form awaits it.

- [ ] **Step 1: 写 queue RED 测试**

running 状态下 enqueue 不调用 `replaceAgentRun`；AgentManager 处理当前 turn terminal event 后一次启动合并 prompt。两个同 field change 只保留最后值，submit 保留并触发 flush。两个不同 SessionContext 对同一 agent enqueue 时仍只产生一条后续 prompt。

- [ ] **Step 2: 写 App validation/form RED 测试**

在 `action-dispatch.test.ts` 中使用 typed fake sender，断言未知 action/payload 不调用 sender。在 `generative-form-state.test.ts` 中断言 sendAction false 后状态恢复 editable+error，true 后才进入 submitted。

- [ ] **Step 3: 运行 RED**

Run:

```text
npx.cmd vitest run packages/server/src/server/agent/generative-ui-action-queue.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/session-handlers/generative-ui-handler.test.ts --bail=1
npx.cmd vitest run packages/app/src/generative-ui/action-dispatch.test.ts --bail=1
npx.cmd vitest run packages/app/src/generative-ui/components/generative-form-state.test.ts --bail=1
```

- [ ] **Step 4: 实现队列与 validation**

handler 对 running/idle agent 都调用 AgentManager 的统一 enqueue API 并立即 response received=true。AgentManager 在 idle 时调度下一 microtask 启动，在 running 时等 terminal event 后启动；禁止调用 `replaceAgentRun`。App renderer 用 componentId 包装纯 `dispatchValidatedAction`，先调用 `validateActionPayload`。form 使用纯状态 reducer，并在 `await sendAction` 后按 boolean 更新状态。

- [ ] **Step 5: 运行 GREEN、Commit**

Commit: `fix(gen-ui): queue actions without interrupting active turns`.

### Task 7: Claude Ultracode 契约统一

**Files:**

- Modify: `packages/server/src/server/agent/providers/claude/agent.ts`
- Modify: `packages/server/src/server/agent/providers/claude/models.test.ts`
- Modify: `packages/server/src/server/agent/providers/claude/agent.test.ts`

**Interfaces:**

- `type ClaudeThinkingOption = ClaudeThinkingEffort | "ultracode"`.
- `buildFlagSettingsOptions(..., { ultracode })` 始终保留 env/fastMode/settingSources。

- [ ] **Step 1: 写动态切换与 settings RED 测试**

断言 `setThinkingOption("ultracode")` 不抛并标记 query restart；build options 同时含 `settings.ultracode=true`、runtime env 和 gateway `settingSources`。

- [ ] **Step 2: 运行 RED**

Run changed Claude test files separately; expected unknown option/settings loss.

- [ ] **Step 3: 实现共享 union 与 additive merge**

删除替换 `flagSettingsOptions` 的分支；调用 `buildFlagSettingsOptions(..., { ultracode })`，并让动态 setter 接受共享 union。

- [ ] **Step 4: 运行 GREEN、Commit**

Commit: `fix(claude): preserve settings when enabling ultracode`.

### Task 8: Android service、通知与状态栏策略

**Files:**

- Create: `packages/app/src/native/android-foreground-service-policy.ts`
- Create: `packages/app/src/native/android-foreground-service-policy.test.ts`
- Modify: `packages/app/src/hooks/use-client-activity.ts`
- Modify: `packages/app/modules/chisacode-android-runtime/android/src/main/java/expo/modules/chisacoderuntime/ChisaCodeForegroundService.kt`
- Modify: `packages/app/modules/chisacode-android-runtime/android/src/main/java/expo/modules/chisacoderuntime/ChisaCodeAndroidRuntimeModule.kt`
- Modify: `packages/app/src/native/android-runtime.android.ts`
- Modify: `packages/app/src/utils/notification-routing.ts`
- Modify: `packages/app/src/utils/notification-routing.test.ts`
- Modify: `packages/app/src/hooks/use-status-bar-theme.ts`
- Modify: `packages/app/src/styles/theme.test.ts`

**Interfaces:**

- Pure policy: `shouldRunAndroidForegroundService({ appState, connectionStatus }): boolean`.
- Notification data uses one JSON extra key: `chisacode.notification.data`.
- Theme exposes/derives `isDark` rather than comparing theme names.

- [ ] **Step 1: 写 policy/route/theme RED 测试**

断言 foreground only for background+connected；notification payload round-trips serverId/agentId；liquid-neon/chisaki/aemeath 的 status bar style 与主题亮度一致。

- [ ] **Step 2: 运行 RED**

Run the three changed TS test files separately.

- [ ] **Step 3: 实现 TS policy 与 Kotlin lifecycle**

hook 订阅 AppState 和 connection state；Kotlin service 返回 `START_NOT_STICKY`，实现 timeout stop path；启动异常回传 JS 并记录。notification data 写入 launch Intent extra，JS 启动时消费后清除。

- [ ] **Step 4: 运行 GREEN 和 Android 静态构建边界**

Run TS tests and app typecheck. If a generated Android project already exists, run targeted Gradle compile task; otherwise record native device/build verification as unavailable, not passed.

- [ ] **Step 5: Commit**

Commit: `fix(android): align foreground service and notification lifecycle`.

### Task 9: DaemonClient 连接与文件帧边界

**Files:**

- Modify: `packages/protocol/src/binary-frames/file-transfer.ts`
- Modify: `packages/client/src/daemon-client.ts`
- Modify: `packages/client/src/daemon-client-reconnect.test.ts`
- Modify: `packages/client/src/daemon-client-binary-frames.test.ts`

**Interfaces:**

- `MAX_FILE_TRANSFER_BYTES` exported from protocol.
- `close()` rejects the current connect promise with `Daemon client closed`.
- FileEnd requires `receivedBytes === metadata.size`.

- [ ] **Step 1: 写 RED 测试**

`connect()` 后立即 `close()`，断言 Promise rejects；声明 size 小于/大于 chunks 时分别明确 reject；超过上限在分配前 reject。

- [ ] **Step 2: 运行 RED**

Run reconnect and binary frame test files separately.

- [ ] **Step 3: 实现 settle 与长度上限**

close 先保存/reject pending resolver 再清理；accumulator 记录 receivedBytes，在每个 chunk 与 FileEnd 检查上限/精确长度。

- [ ] **Step 4: 运行 GREEN、build client、Commit**

Commit: `fix(client): settle connections and validate file frame lengths`.

### Task 10: Hydration、日志与 server 资源边界

**Files:**

- Modify: `packages/app/src/contexts/session-workspace-hydration.ts`
- Modify: `packages/app/src/contexts/session-workspace-hydration.test.ts`
- Modify: `packages/server/src/server/websocket-server.ts`
- Modify: `packages/server/src/server/websocket-server.relay-reconnect.test.ts`
- Modify: `packages/protocol/src/chat/rpc-schemas.ts`
- Modify: `packages/server/src/server/chat/chat-service.ts`
- Modify: `packages/server/src/server/chat/chat-service.test.ts`

**Interfaces:**

- Hydration success flag only changes after all pages succeed.
- Constants: explicit WS `maxPayload`, session inflight ceiling, chat wait default/max deadline.
- Error logs expose metadata only, never full parsed payload.

- [ ] **Step 1: 写 hydration/log/chat RED 测试**

失败或 timeout 后 `hasHydratedWorkspaces` 仍 false；迟到 response 不覆盖 retry 的新结果。日志 sink 不包含 prompt secret。`chat/wait` 缺 timeout 时使用 finite default，dispose 清 waiter。

- [ ] **Step 2: 写 WS limit RED 测试**

构造超过 inflight ceiling 的并发 session messages，断言明确 busy/error response；验证 WebSocketServer 创建参数含 maxPayload。

- [ ] **Step 3: 运行 RED**

Run:

```text
npx.cmd vitest run packages/app/src/contexts/session-workspace-hydration.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/websocket-server.relay-reconnect.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/chat/chat-service.test.ts --bail=1
```

- [ ] **Step 4: 实现边界**

hydration 用 request generation token 忽略迟到响应；error path 不置 hydrated。日志改为安全摘要。chat waiter 绑定 session AbortSignal/deadline。session 超限时 fail fast，不再 fire-and-forget 无限增长。

- [ ] **Step 5: 运行 GREEN、Commit**

Commit: `fix(runtime): bound waits, hydration and websocket work`.

### Task 11: CI、exports、lockfile、测试债与路线图

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy-relay.yml`
- Modify: `.github/workflows/nix.yml`
- Modify: `.github/workflows/nix-update-hash.yml`
- Modify: `.github/workflows/release-notes-sync.yml`
- Modify: `packages/protocol/src/package-exports.test.ts`
- Modify: `package-lock.json`
- Modify: tracked files rewritten by the repository `npm run format` command
- Modify: tests responsible for current `npm run test:audit` deltas
- Modify: `docs/refactors/comprehensive-improvement-roadmap.md`

**Interfaces:**

- Workflow default branch is `cn-main`; server worktree fetch uses `origin/cn-main`.
- package exports test enumerates the frozen v1.0.2 public subpaths and verifies explicit mappings.
- lockfile resolved hosts match CI allowlist without widening the allowlist.

- [ ] **Step 1: 写/更新 static gate tests**

package exports test includes an explicit array of v1.0.2 public subpaths and asserts each has `types` and `default`; it no longer requires unrestricted `./*`.

- [ ] **Step 2: 运行 protocol RED/GREEN**

Run: `npx.cmd vitest run packages/protocol/src/package-exports.test.ts --bail=1`.

- [ ] **Step 3: 修正 workflows 与 lockfile**

替换默认分支引用；CI lint job 增加 format check。运行 `npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org` 重新生成 lockfile resolved URL，不手工放宽 `--allowed-hosts npm`。

- [ ] **Step 4: 消除当前 test-audit 增量**

运行 `npm run test:audit`，按报告逐项移除新增 module mock、conditional skip、weak assertion 和直接 env mutation；不得修改 baseline 数字。

- [ ] **Step 5: 格式与路线图**

运行 `npm run format`，确认 `npm run format:check` 和 `git diff --check` 通过。路线图新增本批次条目，列出各任务 commit 和最终验证结果。

- [ ] **Step 6: 项目级验收**

Run:

```text
npm run lint
npm run typecheck
npm run format:check
npm run test:audit
```

Expected: all exit 0. 不运行全量测试；汇总此前每个任务的定向测试证据。

- [ ] **Step 7: 最终安全复核与 Commit**

复核 Schedule 无 path separator 旁路、proxy 无 bearer、smoke 不接触默认 home、relay 有容量、旧 client 不收到 GenUI wire。Commit: `chore: close comprehensive audit remediation gates`.

---

## Plan Self-Review

- 设计中的全部 P1 分别映射到 Task 1–8 或 Task 11。
- 高价值 P2 映射到 Task 6、7、9、10、11。
- 所有行为修复都有明确 RED 与 GREEN 命令。
- 没有要求运行完整 workspace Vitest、完整 Playwright、真实 provider 或危险 desktop smoke。
- 跨包 producer 变化后明确要求重建 protocol/client stack。

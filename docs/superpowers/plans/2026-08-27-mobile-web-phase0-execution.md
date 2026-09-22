# Mobile/Web Phase 0 执行计划 — P0 正确性与恢复

Date: 2026-08-27

Feature: `mobile-remote`

Base: `cursor/mobile-web-gap-analysis-ed5c`（含差距分析 `2026-08-27-mobile-web-desktop-gap-analysis.md`）

Work branch: `cursor/mobile-web-phase0-ed5c`

## 范围（来自差距分析 Phase 0，全部必做）

1. **真实 access / permission mode**：删除 `state.accessMode` 本地假切换。当前会话 mode 只来自 agent snapshot（`availableModes` / `currentModeId`），切换调用 `DaemonClient.setAgentMode`，失败回滚并显示 daemon 错误；`agent_stream.mode_changed` 事件写回 UI。
2. **新会话 workspace / provider chooser**：`createMobileAgent` 不再复用第一条 agent 的 `provider/cwd`。新会话先经 `fetchWorkspaces` 选工作区，再经 `getProvidersSnapshot({ cwd })` 选 ready provider，可选 mode（snapshot `modes` / `defaultModeId`），最后把 `workspaceId/cwd/provider(/modeId)` 显式传给 `createAgent`。
3. **连接状态与重连后权威 resync**：订阅 `subscribeConnectionStatus`；离线 / 重连中 / 已连接三态可见；断线时发送按钮不假装在线；重连后重新 `fetchAgents`（含订阅）并刷新当前会话 `fetchAgentTimeline` 与 pending 审批；未发送草稿按 serverId+sessionId 本地保留。

同时按差距分析第 9 条：把 v2 有状态编排从 `app.js` 抽成可测模块（`controller.js`），`app.js` 保持 UI binder。

## 不做（Phase 1+，明确出界）

归档/删除/重命名、timeline 分页、完整审批 actions、模型 picker、Files 下钻、Diff、MCP/Skills、终端、Browser surface、marketplace、dsh-im。禁止 `callUnary` / `callShell` / `/__remote__/*` fallback；禁止 `chisacode.sh` 生产中继。

## 模块设计

### 新增 `mobile/web/chisacode/controller.js`（纯逻辑，fake client 可测）

- `connectionPhase(state)`：DaemonClient `ConnectionState` → `{ phase: 'online'|'connecting'|'offline', label }`。
- `watchConnection(client, { onStatus, onReconnected })`：包装 `subscribeConnectionStatus`；初始 `connected` 不触发 resync；出现 `connecting`/`disconnected` 后再回到 `connected` 才触发 `onReconnected`；返回 disposer。
- `resyncAfterReconnect(client, { sessionId })`：`fetchAgents({ page:{limit:100}, subscribe:{} })` + 当前会话 `fetchAgentTimeline(tail 200, projected)`；返回 `{ rows, timeline }`，错误向上抛（调用方进 banner，不静默）。
- `createDraftStore(storage, serverId)`：`load/save/clear(sessionId)`，key `dsh-chisacode-drafts:<serverId>`；storage 异常不炸 UI（草稿是尽力而为的本地便利，不是正确性路径）。

### `mobile/web/chisacode/parity.js` 变更

- 删除 `discoverAgentDefaults`（“猜第一条 agent”正是 P0 缺陷）。
- 新增 `listWorkspaceChoices(client)`：`fetchWorkspaces(activity_at desc, limit 50)` → `{ id, name, project, cwd, branch }[]`；空列表抛可见错误。
- 新增 `listReadyProviders(client, cwd)`：`getProvidersSnapshot({ cwd })` → ready+enabled 的 `{ provider, label, modes, defaultModeId }[]`；空列表抛可见错误。
- `createMobileAgent(client, { workspaceId, cwd, provider, modeId })`：显式参数，缺 `cwd`/`provider` 抛错；`modeId` 可选透传。
- 新增 `agentModeState(agent)`：snapshot → `{ modes, currentModeId, currentLabel }`（纯函数，供 chip 与权限 pane）。

### `mobile/web/app.js` / `index.html` / `app.css` / `ui/settings-hub.js`

- 删除 `state.accessMode`；access chip 显示 `agentModeState(currentRow()?.chisacodeAgent).currentLabel`（无可切换 mode 时显示「权限」并进入诚实禁用 pane）。
- 权限 pane：列出 snapshot modes，当前项标记；点击=乐观更新→`setAgentMode`→失败回滚+banner（daemon 错误原文）。无会话 / 无 modes / 旧 transport 均为诚实说明，不出现假开关。
- 新会话：sheet 三步（工作区 → 提供方 → 可选 mode）；加载中 / 空 / 错误均有可见状态；确认后 `createMobileAgent`。
- 连接条 `#conn-banner`：offline「连接已断开…」、connecting「正在重新连接…」，connected 隐藏；断线时禁用发送/停止路径（发送前再守卫一次，不假成功）。
- `finishChisaCodeConnect` 挂 `watchConnection`；`onReconnected` → `resyncAfterReconnect` → 整体替换 sessions / events / pendingApproval；失败进 banner。disposer 并入 `paired.dispose`，`forceLogout` 释放。
- 草稿：input 时 `draftStore.save(sessionId, text)`；`openSession` 恢复；发送成功后 `clear`；重连不清 textarea。
- `settings-hub.settingsGroups` 的权限行 desc 使用真实 mode 标签（无则「由提供方决定」类文案）。

## 验收标准（2026-08-27 全部达成，证据见 [QA 报告](../../qa/results/2026-08-27/mobile-web-phase0.md)）

- [x] 新会话可从 daemon workspace registry 选择目标；`createAgent` 收到的 `workspaceId/cwd/provider(/modeId)` 与选择一致；不再读“第一条 agent”（浏览器集成检查记录到 `{provider:'dsh', cwd:'/repo/mobile', workspaceId:'ws-mobile', modeId:'plan'}`）。
- [x] 当前会话 mode 显示值 = snapshot `currentModeId`；切换调用 `setAgentMode`；daemon 拒绝时 UI 回滚且错误可见；`mode_changed` 流事件写回。
- [x] 连接条呈现 offline / reconnecting / online；重连后自动 `fetchAgents` + 当前 timeline 刷新；断线时发送被拒绝并提示，不假装在线。
- [x] 草稿按 serverId+sessionId 本地保留，重连与切会话不丢。
- [x] `node --test "mobile/web/**/*.test.js"` 全绿（86 pass）；controller / parity 新逻辑有 fake-client 单测；`src/main/chisacode-remote.test.js` 不回归（12 pass / 2 skipped 与基线一致）。
- [x] 这些流程全路径无 `callUnary` / `callShell` / `/__remote__/*`；无静默 catch 吞 P0 错误（审查发现并修复一处 create 后 openSession 失败被吞的路径）。

真机 relay / 多 workspace 实数据 / Android WebView 仍为 BLOCKED 发布验收项（见 QA 报告矩阵），不计入本轮可达成范围。

## 测试策略

1. **单测（node:test + fake DaemonClient）**：`controller.test.js`（phase 映射、初始 connected 不 resync、掉线→重连触发一次 resync、disposer、草稿存取与坏 storage 容错）；`parity.test.js` 更新（workspace choices 映射与空错误、ready provider 过滤、显式 createMobileAgent 参数与 modeId 透传、agentModeState）。
2. **回归**：全量 `mobile/web/**/*.test.js`、`src/main/chisacode-remote.test.js`。
3. **浏览器 QA（静态 serve）**：`python3 -m http.server` 起 `mobile/web`；用页面控制台注入 fake 场景验证连接条、chooser sheet、权限 pane、断线守卫的 DOM 状态；截图记录。
4. **BLOCKED（真机）**：真实 relay 配对、多 workspace 真建、真 provider mode 切换、断网重连 — 云环境无 Trent 桌面/中继，记入 QA 矩阵为 BLOCKED，静态预览不替代真机结论。

## 文件 touch list

- `mobile/web/chisacode/controller.js`（新）+ `controller.test.js`（新）
- `mobile/web/chisacode/parity.js` + `parity.test.js`
- `mobile/web/app.js`、`mobile/web/index.html`、`mobile/web/app.css`
- `mobile/web/ui/settings-hub.js` + `settings-hub.test.js`（权限行 desc）
- `docs/features/mobile-remote.md`、`docs/handbook/flows/remote-pair.md`
- `docs/qa/results/2026-08-27/mobile-web-phase0.md`（新）
- 本计划文档

均在 `mobile-remote` 卡 Allowed touch 内。

## 风险与对策

- **bundle 陈旧**：已验证 `daemon-client.bundle.js` 含 `subscribeConnectionStatus` / `setAgentMode` / `listProviderModes` / `fetchWorkspaces` / `getProvidersSnapshot`，无需重打包。
- **重连语义**：`reconnect: { enabled: true }` 下 client 自恢复 socket；`watchConnection` 只观察状态，不重建 client；`forceLogout` 仍走既有 dispose 路径。
- **乐观 mode 更新竞态**：回滚以「调用前快照值」为准；若期间收到 `mode_changed`/`agent_update`，以 daemon 值覆盖（daemon 权威）。
- **草稿隐私**：草稿只落本机 localStorage，按 serverId 隔离，解除配对（forceLogout 清 secret）时同时清除该 serverId 草稿。

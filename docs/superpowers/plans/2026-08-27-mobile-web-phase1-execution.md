# Mobile/Web Phase 1 执行计划 — P1 会话与对话闭环

Date: 2026-08-27

Feature: `mobile-remote`

Base: `cursor/mobile-web-phase0-ed5c`（Phase 0：workspace chooser、真实 mode、重连 resync、`controller.js`）

Work branch: `cursor/mobile-web-phase1-ed5c`

## 范围（来自差距分析 Phase 1，全部必做）

1. **Agent cursor 分页**：`fetchAgents` 当前只取 100 条即截断。会话抽屉按 `pageInfo.nextCursor/hasMore` 增加「加载更多会话」，按 agentId 去重合并。
2. **Timeline 向上分页**：当前只取 tail 200。日志顶部按 `hasOlder/startCursor` 增加「加载更早消息」，`direction:'before'` 取页，按 seq 去重前插，保持滚动锚点。
3. **归档 / 历史 / 删除 / 重命名 / 取消归档**：`archiveAgent`、`fetchAgentHistory`、`deleteAgent`、`updateAgent({name/regenerateTitle})`；取消归档走 `refreshAgent(agentId)`（见下方语义验证）。destructive 操作有确认；daemon 失败不乐观删除。
4. **完整 permission actions**：按 daemon `request.actions`（label/behavior/variant）渲染；无 actions 才画 generic 允许/拒绝。响应带 `selectedActionId`。处理 `agent_stream.permission_resolved` 与 `agent_permission_resolved`（另一客户端解决）清 pending、恢复 composer；支持 snapshot 多条 `pendingPermissions` 排队。
5. **模型 picker**：composer chip 显示 snapshot 当前 model；「模型」pane 用 `listProviderModels(provider,{cwd})` 列表 + `setAgentModel`（乐观更新→失败回滚+banner）；新会话 chooser 增加可选 model 步（providers snapshot 自带 `models`），选中值传入 `createAgent.model`。
6. **Slash commands**：输入以 `/` 开头（单 token）时按当前 agent `listCommands` 拉取（按 agent 缓存），popup 过滤显示 name/description/argumentHint，点击插入。
7. **按会话草稿补全**：Phase 0 已做文本（localStorage）；本轮补附件跨会话切换保留（内存 per-session；图片字节不落 localStorage——1.5MB/张会撑爆配额，刷新后附件不恢复，文档明示）。
8. **子 agent 只读轨道**：用 snapshot `relation.kind==='subagent'/parentAgentId` 在抽屉里把子 agent 折到直接父会话名下；父未加载的子 agent 顶层显示并标「子智能体」。打开子 agent / 已归档 agent 进入只读视图（隐藏 composer，显示原因条），发送被守卫拒绝。
9. **结构化 timeline**：助手消息安全 Markdown（自写 parser→DOM builder，绝不 innerHTML 注入）；reasoning 独立弱化样式；tool_call 显示 detail（shell 命令/输出、read/edit/write 路径、search 查询与计数、fetch URL、sub_agent、plan、plain_text）可展开；todo/compaction/turn_changes/generative_ui/未知类型均有可见 fallback，不再被静默丢弃。

## 协议证据（vendored `@chisacode/{client,protocol}`，bundle 已含全部方法，无需重打包）

| 能力 | RPC / schema | 证据 |
| --- | --- | --- |
| agent 分页 | `fetchAgents({page:{limit≤200,cursor}})` → `pageInfo{nextCursor,prevCursor,hasMore}` | `daemon-client-query-commands.ts`、`agent/messages.ts` `AgentDirectoryPageInfoSchema` |
| timeline 分页 | `fetchAgentTimeline(id,{direction:'before',cursor,limit})` → `startCursor/endCursor/hasOlder/hasNewer`，cursor=`{epoch,seq}` | `daemon-client-agent-interaction.ts`、`FetchAgentTimelineResponseMessageSchema` |
| 归档 | `archiveAgent(id)`（30s timeout，级联子 agent） | `daemon-client-agent-lifecycle.ts` |
| 历史 | `fetchAgentHistory({filter,sort,page})`；server 端默认 `includeArchived:true` 且含 unavailable persisted | `agent-directory-handler.ts` `listFetchAgentsEntries` |
| 删除 | `deleteAgent(id)` → `agent_deleted` | 同上 lifecycle |
| 重命名/重生成标题 | `updateAgent(id,{name?/regenerateTitle?})`，`accepted:false` 抛错 | 同上 |
| **取消归档** | `refreshAgent(id)`：server `handleRefreshAgentRequest` 先 `unarchiveAgentState` 再从持久化 reload —— ChisaCode 官方 app 的「取消归档」按钮（`archived-agent-callout.tsx`）就是这条路径 | `agent-lifecycle-handler.ts:1153` |
| permission actions | `AgentPermissionRequestPayloadSchema.actions[{id,label,behavior:'allow'\|'deny',variant?,intent?}]`；响应 `AgentPermissionResponse{behavior,selectedActionId?}` | `agent/state.ts` |
| 跨客户端解决 | `agent_stream.permission_resolved{requestId,resolution}` + 顶层 `agent_permission_resolved` message；`client.on(type,handler)` 可订阅 | `agent/state.ts`、`agent/messages.ts:633`、`daemon-client.ts:730` |
| 模型 | snapshot `model`（nullable）、`listProviderModels(provider,{cwd})`（payload 可带 `error`）、`setAgentModel(id, modelId\|null)` | `provider/messages.ts`、lifecycle |
| slash | `listCommands(agentId)` → `commands[{name,description,argumentHint}]`，payload `error` nullable | `agent/messages.ts:666` |
| 子 agent | snapshot `relation{kind∈[subagent,detached,handoff,team-slot],parentAgentId?}` | `agent-labels.ts`、`AgentSnapshotPayloadSchema` |
| timeline item 全集 | `user_message/assistant_message/reasoning/tool_call(detail 判别联合)/generative_ui/todo/error/compaction/turn_changes` | `AgentTimelineItemPayloadSchema` |

**「恢复」语义结论（诚实标注）**：ChisaCode 没有独立 unarchive RPC；`resumeAgent(persistenceHandle)` 是「从 provider 持久化句柄重建会话」，不等于 dsh 的 unarchive。官方 app 的取消归档 = `refreshAgent`（unarchive 快照 + reload）。本轮采用与官方 app 相同的 `refreshAgent` 路径并命名「取消归档」，不使用「恢复」一词，不调用 `resumeAgent`。真机验证（真实 provider reload）仍属 BLOCKED 项。

## 模块设计

### 新增 `mobile/web/chisacode/directory.js`（会话目录：分页 / 分组 / 生命周期）

- `agentPageInfo(payload)` → `{ nextCursor, hasMore }`（缺 pageInfo → `{null,false}`）。
- `mergeAgentRows(existing, incoming)` → 按 sessionId 去重：已有行原位更新，新行追加（load-more 语义）。
- `groupSessionRows(rows)` → `[{ row, children, orphanSubagent }]`：`relation.kind==='subagent' && parentAgentId` 且父在已加载集合 → 折入父；父未加载 → 顶层 + `orphanSubagent:true`。
- `listArchivedAgents(client,{cursor})` → `fetchAgentHistory(sort updated_at desc, filter{includeArchived:true}, page{limit:50,cursor?})` → `{ rows, nextCursor, hasMore }`。
- `archiveMobileAgent` / `deleteMobileAgent` / `renameMobileAgent`（空名抛错）/ `regenerateMobileTitle` / `unarchiveMobileAgent`（=`refreshAgent`）——全部错误上抛，调用方进 banner/toast。

### 新增 `mobile/web/chisacode/timeline.js`（timeline 向上分页）

- `timelinePageInfo(payload)` → `{ startCursor, hasOlder }`。
- `fetchOlderTimeline(client, agentId, cursor, {limit=200})` → `direction:'before'` + cursor + projected；payload.error 抛错。
- `mergeOlderEntries(older, current)` → 以 `seqStart` 为键去重（已存在的 seq 丢弃 older 版本），返回 older+current 顺序。

### 新增 `mobile/web/chisacode/approvals.js`（完整审批）

- `approvalFromRequest(request)` → `{ requestId, title, command, actions[{id,label,behavior,variant}] }`（无 actions → `[]`）。
- `approvalsFromAgent(agent)` → snapshot `pendingPermissions` 全量映射（排队）。
- `removeApproval(list, requestId)`。
- `responseForAction(action)` → `{behavior, selectedActionId}`；`genericResponse('allow'|'deny')`。

### 新增 `mobile/web/chisacode/commands.js`（slash）

- `slashQuery(text)` → 首 token 为 `/xxx` 且无空格换行时返回查询串，否则 null。
- `filterSlashCommands(commands, query)`（前缀优先 + 包含）。
- `applySlashCommand(text, name)` → 替换首 token 为 `/name `。
- `listAgentCommands(client, agentId)` → payload.error 抛错，映射 `{name,description,argumentHint}`。

### `parity.js` 扩展

- `agentModelState(agent)` → `{ modelId, label }`（`agent.model` ?? `runtimeInfo.model` ?? null）。
- `listAgentModels(client, provider, cwd)` → `listProviderModels` 映射 `{id,label,description,isDefault}`；payload.error / 空列表抛可见错误。
- `listReadyProviders`：条目增加 `models` 映射（snapshot 自带，chooser 不再发额外 RPC）。
- `createMobileAgent`：可选 `model` 透传。

### `controller.js` 扩展

- 草稿 store 增加 `loadAttachments/saveAttachments/clearAttachments(sessionId)`：内存 per-session（图片字节不落 localStorage；`clear`/`clearAll` 一并清附件）。

### `conversation/markdown.js`（新，纯 parser）+ `fold.js` 扩展

- `parseMarkdown(text)` → block 树（code fence / heading / list / quote / paragraph；span：text/code/strong/em/link——link 仅保留 http(s) href，其余降级纯文本）。app.js 只用 `createElement/textContent` 建 DOM，无 innerHTML。
- `foldEvents`：`reasoning` → 独立 role；`tool_call` 行带 `detail/status`；新增 `todo`（items）、`meta`（compaction/generative_ui/未知类型 fallback 文本）、`changes`（turn_changes summary+files）。

### `app.js` / `index.html` / `app.css`

- 抽屉：分组渲染（子 agent 缩进 + 「子」标记）、每行溢出「⋯」→ 会话操作 sheet（重命名 / 重新生成标题 / 归档 / 删除-danger）、列表尾「加载更多会话」、入口「已归档会话」→ 历史 sheet（分页、取消归档、只读打开）。
- 确认对话框：归档 / 删除各自文案（不混用）；重命名 dialog 带输入框。全部失败路径 toast/banner 显示 daemon 错误原文，不移除行。
- 日志：顶部「加载更早消息」；prepend 后 `scrollTop += (newHeight - oldHeight)` 保锚点；助手 Markdown、reasoning 弱化、tool `<details>` 展开 detail、todo/meta/changes 卡片。
- 审批：`#approval-actions` 动态渲染 actions（variant → primary/ghost/danger 类）；无 actions → generic 允许一次/拒绝；响应发 `selectedActionId`；`permission_resolved`/`agent_permission_resolved` 清对应 pending 并显示下一条或恢复 composer。
- 模型 chip + 「模型」pane：当前 model 标记，切换乐观 + 回滚 + banner；「提供方默认」= `setAgentModel(id,null)`。
- 新会话 chooser：provider → (mode 步) → (model 步，snapshot models 非空时)；均有「默认」项。
- Slash popup：composer 上方浮层；`/` 触发、按 agent 缓存、点击插入、失焦/清空关闭。
- 只读会话（subagent / archived）：隐藏 composer，显示 `#readonly-note` 原因；send/cancel 守卫。

## 不做（出界）

Phase 2（Files 下钻 / Diff / MCP / Skills）、终端、Browser surface、marketplace、dsh-im、HTTP v1（`callUnary`/`callShell`/`/__remote__/*`）、`resumeAgent(handle)` 式「恢复」、message rewind/编辑重发（P2）。

## 验收标准

- [ ] >100 agent：抽屉能按 cursor 连续加载且无重复行。
- [ ] >200 timeline：顶部能连续向上加载且 seq 不重复、滚动位置不跳。
- [ ] 归档/删除/重命名/取消归档：确认框文案区分、失败可见且不乐观移除；取消归档走 `refreshAgent`。
- [ ] 审批按 daemon actions 渲染（label/variant/selectedActionId）；另一客户端解决后 pending 自动清、composer 恢复；多条 pending 逐条呈现。
- [ ] 模型 chip/pane 与重新 fetch 的 snapshot 一致；`setAgentModel` 失败回滚。
- [ ] `/` 出现命令 popup，插入正确。
- [ ] 子 agent 只出现在直接父会话轨道（父已加载时），打开为只读。
- [ ] 富 timeline：Markdown/代码块安全渲染、tool detail 可见、todo/compaction/turn_changes/未知类型有 fallback。
- [ ] `node --test "mobile/web/**/*.test.js"` 全绿；`src/main/chisacode-remote.test.js` 不回归。
- [ ] 浏览器 fake-daemon 集成覆盖：分页、load-older、会话菜单三操作、审批 actions + 远端解决、模型切换回滚、slash、子 agent 只读。

## 测试策略

1. **单测（node:test + fake client）**：`directory.test.js`、`timeline.test.js`、`approvals.test.js`、`commands.test.js`、`parity.test.js`（模型/model 透传）、`controller.test.js`（附件草稿）、`fold.test.js`（新 item 类型）、`markdown.test.js`（安全性：HTML 原文保持文本、javascript: 链接降级）。
2. **浏览器集成（提交至 `tools/mobile-web-qa/`，产品包外）**：把 Phase 0 的临时 harness 落成仓库资产——`fake-daemon-client.mjs`（行为等价 fake DaemonClient：可注入 >100 agents、>200 timeline、permission actions、远端 resolved、model 拒绝一次）+ `server.mjs`（静态 server，将 `chisacode/daemon-client.bundle.js` 路由到 fake）+ `run-qa.mjs`（puppeteer-core 驱动 headless Chrome 断言 + 截图）。放 `tools/` 而非 `mobile/web/qa/`：electron-builder `files` 打包 `mobile/web/**/*`（仅排除 `*.test.js`），QA 资产不得进产品包。puppeteer-core 临时安装（node_modules 已 gitignore）。
3. **BLOCKED（真机）**：真实 relay 配对、真 provider setAgentModel/listCommands、真实归档→取消归档 reload、Android WebView——云环境无 Trent 桌面，与 Phase 0 相同记入 QA 矩阵。

## 文件 touch list

- 新增：`mobile/web/chisacode/{directory,timeline,approvals,commands}.js` + 各自 `.test.js`；`mobile/web/conversation/markdown.js` + `.test.js`；`tools/mobile-web-qa/{fake-daemon-client.mjs,server.mjs,run-qa.mjs}`
- 修改：`mobile/web/chisacode/{parity,controller}.js` + tests、`mobile/web/conversation/fold.js` + test、`mobile/web/{app.js,index.html,app.css}`
- 文档：`docs/features/mobile-remote.md`、`docs/handbook/flows/remote-pair.md`（如涉及）、`docs/qa/results/2026-08-27/mobile-web-phase1.md`、本计划

均在 `mobile-remote` 卡 Allowed touch（`mobile/web/`）内。

## 风险与对策

- **bundle 覆盖**：已 grep 验证 bundle 含 `fetchAgentHistory/archiveAgent/deleteAgent/updateAgent/refreshAgent/listProviderModels/setAgentModel/listCommands/respondToPermission/agent_permission_resolved`，无需重打包。
- **archive 超时（daemon 侧 10–12s/个）**：client 已用 30s timeout；UI 在等待期间禁用该行操作而非乐观移除。
- **cursor 失效（`staleCursor/reset`）**：load-older 响应若 `reset===true` 或 `staleCursor===true`，以响应 entries 整体替换并重置分页态，不与旧窗口拼接。
- **附件草稿配额**：图片字节只留内存；刷新丢失是明示行为，不写 localStorage 假持久化。
- **Markdown XSS**：parser 输出结构化 span，渲染只走 `textContent`；链接 scheme 白名单 http/https。
- **子 agent 误伤**：只有 `kind==='subagent'` 折叠；`detached/handoff/team-slot` 顶层平铺（与桌面语义一致的保守选择）。

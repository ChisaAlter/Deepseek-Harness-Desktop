# 2026-07-12 深度代码审查

## 结论与评分

| 维度     | 当前评分 | 主要证据                                                                                                                       | 距离 10 分的核心差距                                                                            |
| -------- | -------: | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 架构设计 |      9.9 | dependency-cruiser 0 违规；protocol 721 行；workspace 1541 行；Claude 873 行；ACP 926 行；Pi 581 行                            | workspace 仍承担 route/authority 与跨域 view-model 协调，应只按真实职责继续拆分                 |
| 安全设计 |      9.7 | relay E2EE 单调 nonce；Ed25519 socket 认证；Expo 57/Bundle Mode 已迁移；生产审计 12 项且 0 high/0 critical                     | 当前 Expo 工具链仍含 `xcode` 嵌套 UUID；EAS 云端验证与 relay 认证升级需持续兼容性发布管理       |
| 产品能力 |      9.6 | app、CLI、MCP 已覆盖 agents、terminals、schedules、worktrees、providers、permissions、chat、loop 与只读 diagnostics/tooling    | 更新安装仍属于 desktop 平台生命周期；其余差距主要是发布验证与少量 surface 深度差异              |
| 代码质量 |      9.9 | typecheck/lint/format/test-audit/高信号 Knip/依赖边界均有门禁；Expo 57 通过 Doctor、Android Kotlin 编译与 Hermes bundle export | 历史 test debt 高，核心测试文件超过 5k 行，完整 Knip unused-export 结果仍有大量噪声与真实债混合 |
| 综合     |  **9.8** | 核心安全、主要产品域 parity、依赖迁移与持续领域拆分均有代码级实现和精确验证                                                    | 继续提升需要完成 EAS 认证发布验证、测试减债与剩余小型 surface 收口                              |

## 本轮已修

### 安全设计

- Relay server-control/server-data URL 的签名新增 `issuedAt`，并将签发时间纳入 Ed25519 签名消息。
- Relay 默认拒绝缺失、格式错误、过期、未来时间、签名错误和重复使用的认证凭证。
- 已使用 nonce 保存在 Durable Object storage，WebSocket hibernation 或实例恢复后仍保留短期重放窗口。
- 重放检查发生在 `closeExistingServerSockets` 之前；捕获的旧 URL 不能再抢占合法 daemon socket。
- `SECURITY.md` 的 E2EE nonce 描述与实际 `salt(16)+seq(8)` 单调语义对齐。
- Electron 右键菜单外链与 IPC opener 复用同一 `URL` protocol validator。
- Server 的 11 个 UUID 生产调用点统一迁移到 `node:crypto.randomUUID()`，删除直接 `uuid` / `@types/uuid` 依赖；残余通告仅来自 Expo `xcode` 嵌套链。

### 架构与代码质量

- CI typecheck 构建顺序补齐 `@chisacode/expo-two-way-audio`，不再依赖本地残留 build 产物。
- Knip 门禁收敛到高信号类别：依赖、未声明依赖、unresolved import 和 binary；这些类别当前为 0。
- 修复 5 个失效 import 和 12 个直接使用但未声明的依赖归属。
- Relay E2E 显式声明 Wrangler，并通过公开的 `wrangler/package.json` 定位 CLI，不依赖 workspace hoist 或封闭子路径。
- Vitest Browser 升至 4.1.10，移除 4.1.7 及以下 Browser Mode RCE；Wrangler 升至 4.110.0。
- CI 与 app/relay 发布工作流统一阻断 critical advisories；已记录的 high/moderate 通告按 major migration 单独治理。
- 将锁文件中 125 个由本机 npm mirror 写入的 `resolved` URL 规范化回 `registry.npmjs.org`，保持版本与 integrity 不变并恢复 lockfile-lint 门禁。
- 旧客户端 provider 过滤重新接回 Session 的版本兼容策略，避免向不认识新 provider id 的客户端发送 `pi` 等条目。
- 将一条依赖微任务时序的测试断言改为 `vi.waitFor`，消除调度竞态。
- 2026-07-13：MCP 新增完整 Chat/Loop 一等工具；工具注册拆到独立领域模块，Chat WebSocket 与 MCP 复用同一投递/fan-out 命令，避免 surface 语义漂移。
- 2026-07-13：agent-scoped Chat 工具锁定 caller author identity，Loop 启动复用既有 scoped cwd resolver；top-level MCP 仍需显式 author/cwd。
- 2026-07-13：DaemonClient 的 terminal 目录订阅、RPC、stream slot 与 binary 路由提取到独立领域客户端；核心只保留 façade、连接生命周期通知和 metrics 分类，公开类型兼容不变。
- 2026-07-13：voice/dictation 的 ack/error/final 竞速、服务端 timeout budget 和 waiter cleanup 提取到独立领域客户端；核心降至 3920 行，连接断开仍由共享 waiter authority 统一拒绝。
- 2026-07-13：agent lifecycle/config 的 CRUD、persistence、rewind/cancel 与 runtime settings 提取到独立领域客户端；公开创建/导入/查询类型重导出兼容，核心进一步降至 3471 行。
- 2026-07-13：agent timeline、消息发送与 Generative UI action 提取到独立 interaction/query 客户端；能力门禁、60 秒冷启动预算、messageId/附件映射与 `DaemonRpcError` 元数据保持兼容，核心降至 3368 行。
- 2026-07-13：correlated RPC、waiter timeout/cancel、连接中请求队列、flush 和断线拒绝提取到统一 request coordinator；领域客户端共享同一 authority，核心降至 3040 行，私有 waiter 状态测试改为 deadline 行为测试。
- 2026-07-13：transport factory/E2EE、hello、connect/reconnect、连接状态订阅、发送与 liveness 提取到独立 connection controller；核心只接收 active transport 数据和生命周期回调，降至 2319 行，公开连接配置与状态类型兼容。
- 2026-07-13：protocol terminal inbound/outbound schema、snapshot 类型与 union tuple 提取到 `terminal/messages.ts`；旧 `messages` 入口兼容重导出，并新增显式 package subpath，主文件从 5213 降至 4941 行。
- 2026-07-13：checkout status/diff、Git 操作、PR/timeline、branch/stash 与 GitHub search 提取到 `checkout/messages.ts`；22 个 inbound/23 个 outbound schema 由 tuple 聚合，主文件降至 4142 行。
- 2026-07-13：workspace/worktree/directory/editor/file explorer 等 14 个 inbound、18 个 outbound schema 与 descriptor/setup 状态提取到 `workspace/messages.ts`；附件归一化独立到 `agent/attachments.ts`，旧入口保持兼容，主文件降至 3339 行。
- 2026-07-13：provider discovery/snapshot/diagnostic/tooling/usage/recent sessions 的 11 个 inbound、12 个 outbound schema 与 model/mode/feature 基础契约提取到 `provider/messages.ts`；`agent-types.ts` 解除对 god-file 的附件类型反向依赖，主文件降至 2860 行。
- 2026-07-13：OpenAI SDK 升至 6.46.0；Zod 直接依赖统一到 4.3.6，既有 schema 通过 `zod/v3` 保持语义；Claude Agent SDK 0.2.141、Anthropic SDK 0.93.0 与 MCP SDK 1.29.0 peer 对齐，Claude/Anthropic 生产通告清零。
- 2026-07-13：生产路径中的 `ajv`、`brace-expansion`、`js-yaml`、`postcss` 与 `tar` 完成兼容补丁升级；npm 10.9.4 clean-install dry-run 接受新锁，生产审计从 24 降至 19 且保持 0 high/0 critical。
- 2026-07-13：App 升至 Expo 55.0.27 / React Native 0.83.6 / React 19.2.0，Expo 模块与本地音频模块同步迁移；Gesture Handler 补丁升级至 2.30.1，Android runtime 删除 `implementation project(":expo")` 以解除新版聚合模块循环。Expo Doctor 19/19、App 与模块 typecheck/build、Android prebuild、自定义模块和 App Kotlin 编译通过；生产审计从 19 降至 11 且保持 0 high/0 critical。
- 2026-07-13：App 继续升至 Expo 56.0.15 / React Native 0.85.3 / React 19.2.3，Expo Router、Reanimated、Worklets、Gesture Handler、本地音频模块与 TypeScript 6 同步对齐；直接 React Navigation 依赖移除，导航 hooks 改走 Expo Router，RN 原生 absolute fill API 与 TS6 type-only import 完成兼容迁移。Expo Doctor 21/21、App 依赖栈 build/typecheck、17 个目标文件 lint、3 个聚焦测试文件 13 个断言、Android clean prebuild、两个自定义模块与 App Kotlin 编译通过；生产审计为 12 moderate、0 high/0 critical。
- 2026-07-14：App 升至 Expo 57.0.4 / React Native 0.86.0，Reanimated 4.5.0、Worklets 0.10.0、Gesture Handler 2.32.0 与本地音频模块同步对齐；启用官方 Worklets Bundle Mode，并应用 Metro/Metro Runtime 0.84.4 官方补丁，保留 ChisaCode 自定义 Metro overlay/resolver。npm 10 clean-lock/ci dry-run、四个 postinstall 补丁、Expo Doctor 20/20、App 依赖栈 build/typecheck、目标 lint/format、Android clean prebuild、两个自定义模块与 App Kotlin 编译、5,551 模块 Android Hermes bundle export 均通过；生产审计仍为 12 moderate、0 high/0 critical。EAS 20.5.1 live config 因缺少 Expo 登录未执行云端解析，本地 Expo config 已确认 runtimeVersion、updates URL、projectId 与 Android package。
- 2026-07-13：Skills 与 MCP server 管理的配置、scope、payload 及 8 个 inbound/8 个 outbound schema 提取到 `agent/extensions.ts`；总 union 改由只读 tuple 聚合，旧 `messages` 入口兼容重导出并新增显式 package subpath，主文件降至 2436 行。
- 2026-07-13：daemon status/pairing/config/project config/lifecycle 的 8 个 inbound、6 个 outbound、3 个 status payload 与 mutable config 提取到 `daemon/messages.ts`；旧入口兼容重导出并新增显式 package subpath，主文件降至 2164 行。
- 2026-07-14：usage summary/export/clear 的 3 个 inbound、3 个 outbound schema、兼容默认值与 payload/type 提取到 `usage/messages.ts`；总 union 改由只读 tuple 聚合，旧入口兼容重导出并新增显式 package subpath，主文件降至 2073 行。
- 2026-07-14：voice mode/audio、dictation stream 的 7 个 inbound、9 个 outbound schema、server voice capability 与消息类型提取到 `voice/messages.ts`；旧入口兼容重导出并新增显式 package subpath，主文件降至 1895 行。通用 `abort_request` 保留在主会话控制域，不错误归入 voice。
- 2026-07-14：agent status/capability、permission、tool/timeline、stream event、snapshot/list payload 与 relation schema 提取到 `agent/state.ts`；旧入口兼容重导出并新增显式 package subpath，七个既有 schema 保持运行时同一性，主文件降至 1449 行。
- 2026-07-14：agent lifecycle/config/interaction 的 23 个 inbound、23 个 outbound 与 4 个 lifecycle status payload 提取到 `agent/messages.ts`；旧入口兼容重导出并新增显式 package subpath。`abort_request`、`close_items_*`、项目重命名、MoA 测试及 heartbeat/ping/push 继续留在跨域聚合层，legacy `send_agent_message` 保持导出但不进入 correlated inbound union；主文件降至 721 行。
- 2026-07-13：移动端 workspace tab switcher、presentation fallback、tab menu 与全部局部样式提取到 `workspace-mobile-tab-switcher.tsx`；主屏保持 props/行为兼容并从 5453 降至 4926 行。
- 2026-07-13：tab、pane、dock、sidebar 与 command-center 五组 workspace action 注册/路由提取到 `use-workspace-keyboard-actions.ts`；handler 改用 `useStableEvent`，避免屏幕重渲染时重复注册，主屏降至 4657 行。
- 2026-07-13：layout tab reconcile、setup cache 恢复、空 workspace draft seed 与 setup tab auto-open 提取到 `use-workspace-persistence-hydration.ts`；storage schema 与 effect 顺序保持不变，主屏降至 4451 行。
- 2026-07-13：draft 创建、tab focus、imported agent、文件/side-pane/browser 打开、mobile switcher 与 split 后创建提取到 `use-workspace-tab-open-actions.ts`；移动端切回 agent、后台 draft、Electron gate 与 pane placement 语义保持不变，主屏降至 4270 行。
- 2026-07-13：pending close 防重、terminal 确认/kill、agent 本地 tab close、browser cleanup、auto-open suppression 与 bulk-close 选择/确认提取到 `use-workspace-tab-close-actions.ts`；既有纯 helper 保持复用，主屏降至 3970 行。
- 2026-07-13：dock state/command/placement 路由提取到 `use-workspace-dock-actions.ts`，pane focus suppression 与 split/move/resize/reorder 提取到 `use-workspace-pane-layout-actions.ts`；命令可用性、Electron gate 和 keyboard suppression 语义保持不变，主屏降至 3809 行。
- 2026-07-13：pane child open/close/retarget、file disposition、descriptor identity cache、3-tab mounted retention 与 mobile/desktop adapter 提取到 `use-workspace-pane-content-models.ts`；desktop focus-before-open 与 side-pane parent/source 语义保持不变，主屏降至 3703 行。
- 2026-07-13：environment panel responsive threshold、visibility mode 恢复、dock state、panel/explorer toggle 与 changes explorer transition 提取到 `use-workspace-environment-panel-state.ts`；样式宽度继续作为单一输入，主屏降至 3623 行。
- 2026-07-13：explorer checkout/actions/gesture/native back 提取到 `use-workspace-explorer-actions.ts`，URL intent normalization/ready gate/once-consumption/history cleanup 提取到 `use-workspace-open-intent.ts`；mobile/web/native 路由语义保持不变，主屏降至 3505 行。
- 2026-07-13：focused agent、subagents、todo/turn stream selector、source/status 派生与 status/activity model 聚合提取到 `use-workspace-environment-data.ts`；主屏保留 pane identity 和 archive action 编排，降至 3423 行。
- 2026-07-13：desktop environment rail、inspector、branch switcher、Git popover 与专用样式提取到 `workspace-environment-panel.tsx`；同步删除 45 个无调用点的历史 environment 样式，主屏降至 2592 行。
- 2026-07-13：workspace menu、responsive title、desktop tab presentation、mobile scripts、header toggles、静态 icon 与专用样式提取到 `workspace-header.tsx`；删除 8 个静态 icon 透传 props，主屏降至 1959 行。
- 2026-07-13：移动端 header/tab、mounted content、桌面 split pane、environment rail 与 route gate shell 提取到 `workspace-center-column.tsx`；同步删除无调用 tab/content 样式，主屏从 1959 降至 1541 行。
- 2026-07-13：ACP tool/config/transport/process 分域后，新增 `acp/terminal-controller.ts` 独立拥有 terminal 子进程、输出截断、exit waiter 与关闭清理；`acp/workspace-path.ts` 统一 fs/terminal 意图边界，越界仍 fail-closed，同时只匹配真实 `..` 路径段，不再误拒 `..cache`。主文件从 2860 降至 1866 行，原公开入口继续兼容重导出。
- 2026-07-13：ACP message assembly、tool snapshot 生命周期、user echo suppression、session update 路由与 running tool 取消态合成提取到 `acp/session-update-controller.ts`；mode/config/session-info/commands 继续通过窄回调由 Session 持有，原私有 `translateSessionUpdate` 保留委托；wrapper smoke 的 tool snapshot 证据改为统计公开 timeline 事件，不再读取 Session 私有 map。主文件进一步降至 1752 行。
- 2026-07-13：ACP foreground prompt 派发、active turn、usage、user echo suppression、bootstrap thread 事件、canceled tool 合成、终态与 process-exit failure 提取到 `acp/foreground-turn-controller.ts`；每回合 usage 显式重置，进程退出/关闭/替换后的迟到 prompt resolve/reject 被忽略，JSON-RPC code/data 继续进入诊断。测试以重叠回合拒绝及完成/失败后可重试证明公开行为，不再读取私有 active turn。主文件进一步降至 1575 行。
- 2026-07-13：ACP slash-command snapshot、首次异步 `available_commands_update` 等待、timeout 与 close 唤醒提取到 `acp/command-catalog.ts`；Session 的 listCommands() 与 update callback 收敛为薄委托，原立即返回和等待异步目录行为保持一致。主文件进一步降至 1517 行。
- 2026-07-13：ACP mode/model/thinking 状态、启动 override、provider writer、config response 规范化、current-mode/config-option update 提取到 `acp/session-config-controller.ts`；Session 配置 API 全部变为薄委托，`SessionStateResponse` 从原入口兼容重导出。控制器新增 mode 目录来源跟踪，config-derived mode 走 `setSessionConfigOption`，不再误用原生 `setSessionMode`；测试配置改通过控制器 state API 建立，不再直接修改 Session 配置字段。主文件进一步降至 1070 行。
- 2026-07-13：ACP child/connection/capabilities/session identity、new/load/resume、history replay、close/terminate 与 diagnostics 提取到 `acp/session-lifecycle-controller.ts`；初始化失败会终止并清空进程状态，load replay 在失败时也通过 `finally` 复位，close 统一 cancel/close/terminal/terminate 且幂等。Session 仅保留 façade 与领域控制器接线，主文件降至 926 行，ACP 核心 god-file 拆分完成。
- 2026-07-13：Pi extension UI/ask_user permission 映射提取到 `pi/permission-mapper.ts`，unknown record/string/boolean/string-array 读取提取到 `pi/event-values.ts`；Session 保留 pending request、runtime response 与事件时序，主文件从 1874 降至 1613 行。
- 2026-07-13：Pi captured entry/index、live user-message 对齐、entry capture/tree navigation 命令、marker/result promise 与 close/process-exit 清理提取到 `pi/extension-history-controller.ts`；脚本生成器与控制器复用同一命令/marker 常量，prompt 失败只撤销 pending result，避免额外未处理拒绝。主文件进一步降至 1423 行。
- 2026-07-13：Pi active turn、tool lifecycle、extension UI pending、ask_user follow-up、runtime event routing、process-exit failure 与 turn completion 提取到 `pi/session-event-controller.ts`；Session 只保留启动/配置/持久化/状态刷新编排，主文件进一步降至 1110 行。
- 2026-07-13：Pi state/runtime info、模型/思考配置、usage、持久化与幂等 close 提取到 `pi/session-runtime.ts`；new/resume、MCP probe、临时配置/extension、初始化失败清理与 capability 投影提取到 `pi/session-lifecycle.ts`。恢复会话补齐 launch env 与 gateway model prefix，MCP secret 配置文件显式使用 `0600`；主文件降至 581 行，Pi 核心 god-file 拆分完成。
- 2026-07-13：Claude session identity、fresh/rebind、persistence、query/runtime model、gateway override 与 runtime-info cache 提取到 `claude/session-identity.ts`。SDK session ID 变化、mode 切换和清空 model 后不再返回陈旧 runtime info，run completion 继续保留原生 runtime model 诊断；Session 降至 1057 行。
- 2026-07-13：Claude prompt/图片/附件转换、foreground turn 启动/取消、autonomous turn 收口、`/rewind` 与 close reset 提取到 `claude/foreground-turn-controller.ts`；Session 降至 873 行，provider 核心拆分完成。

## 产品能力矩阵

| 能力域                                    | App/Desktop            | CLI                                    | MCP                                      | 结论                                 |
| ----------------------------------------- | ---------------------- | -------------------------------------- | ---------------------------------------- | ------------------------------------ |
| Agent 生命周期、发送、等待、归档、终止    | 完整                   | 完整                                   | 完整                                     | 核心能力一致                         |
| Terminal 列表、创建、捕获、输入、终止     | 完整                   | 完整                                   | 完整                                     | 一致                                 |
| Schedule 创建、查询、更新、暂停、运行记录 | 完整                   | 完整                                   | 完整                                     | 一致                                 |
| Worktree 创建、列表、归档                 | 完整                   | 完整                                   | 完整                                     | 一致                                 |
| Provider/model discovery                  | 完整                   | 完整                                   | 完整                                     | 本轮修复旧客户端过滤回归             |
| Provider 工具安装/更新/重装               | 完整                   | 完整                                   | 只读版本/状态                            | MCP 禁止全局包变更是安全边界         |
| Permission 查询与响应                     | 完整                   | allow/deny/list                        | 完整                                     | 语义一致，CLI 偏运维表达             |
| Chat                                      | 完整                   | 完整                                   | 完整：房间、消息、等待、mention          | 一致；复用共享投递/fan-out 命令      |
| Loop                                      | 完整                   | 完整                                   | 完整：启动、查询、日志、停止             | 一致；cwd 继承 caller scope          |
| Diagnostics/update                        | daemon 诊断 + 平台更新 | daemon 诊断 + provider inspect/refresh | 脱敏 daemon 诊断 + 只读 provider tooling | 诊断读能力基本一致；安装仍是平台边界 |

## 最高优先级剩余项

1. **P1 依赖安全/发布验证（继续推进）**：AI SDK、Claude SDK、OpenAI SDK、Zod 4、五类兼容型生产补丁、server 直接 UUID 移除及 Expo 55/56/57 本地迁移已完成；下一步只在显式发布时完成 EAS 认证 config/build 验证，并跟踪 Expo 上游何时移除 `xcode` 嵌套 `uuid`，不做破坏性 override。
2. **P1 provider 文件拆分（核心完成）**：`providers/base/` 错误抽象已删除，Codex/OpenCode/ACP/Pi/Claude 均已完成 composition-first 核心拆分；后续只在真实复杂度或缺陷证明收益时继续分域，不再按行数做低收益碎片化拆分。
3. **P1 client/protocol 拆分（核心完成）**：`daemon-client.ts` 已完成主要领域、request 与 connection 分域并降至 2319 行；protocol `messages.ts` 已完成 terminal/checkout/workspace/provider/attachment/agent-extension/daemon/usage/voice-dictation/agent-state/agent-message 域提取并降至 721 行，当前只保留跨域 session/WS 聚合、server info 与通用控制消息。后续仅在真实复杂度或缺陷证明收益时继续拆分。
4. **P2 app 工作台拆分（核心完成）**：移动端 navigation、workspace command routing、layout/setup persistence/hydration、tab/pane/dock/content、environment panel state/data/view、header/center-column view、explorer 与 open-intent 已提取，`workspace-screen.tsx` 从 5453 降至 1541 行；后续只在 route/authority 或跨域协调出现真实复杂度时继续分域，并保持 native/web/electron surface 验证分离。
5. **P2 产品 parity（持续收口）**：MCP 已补齐一等 chat/loop 工具与脱敏 daemon diagnostics；CLI 已补齐 provider install/update/reinstall，并可主动刷新 tooling snapshot。CLI/MCP 复用 protocol 的五态只读 tooling 投影；App/CLI 可显式修改全局 provider 工具，agent-scoped MCP 继续只读，避免把全局包安装权限下放给 agent。
6. **P2 测试减债**：按包逐步降低 module mock、conditional skip、fixed wait、weak assertion、process.env mutation 基线，不再只维持 no-new-debt。

## 验证证据

- `npm@10.9.4 ci --ignore-scripts --dry-run`
- `npm audit --audit-level=critical`
- `npm run knip -- --include dependencies,unlisted,unresolved,binaries`
- dependency-cruiser：807 modules / 1888 dependencies / 0 violations
- Relay/Protocol/Server/Desktop 精确 Vitest：80 项通过
- `packages/server/src/server/session.test.ts`：92 项通过，1 项跳过
- Relay Wrangler E2E：3 项通过
- Relay、Protocol、Server 受影响包 typecheck 通过
- 2026-07-13 MCP Chat/Loop 批次：server typecheck、7 个目标文件 lint、2 个精确 MCP 契约测试通过
- 2026-07-13 Client terminal 批次：client typecheck/build、3 个目标文件 lint、3 个专用测试与 6 个既有 terminal 集成场景通过
- 2026-07-13 Client voice/dictation 批次：client typecheck/build、3 个目标文件 lint、3 个专用状态机测试与 2 个既有 timeout/final 场景通过
- 2026-07-13 Client agent lifecycle 批次：client typecheck/build、3 个目标文件 lint、3 个专用契约测试与 7 个既有 create/import/model 场景通过
- 2026-07-13 Client agent interaction 批次：client typecheck/build、4 个目标文件 lint、3 个专用契约测试与 5 个既有 timeline/Generative UI/SDK façade 场景通过
- 2026-07-13 Client request coordinator 批次：client typecheck/build、4 个目标文件 lint、3 个专用状态机测试与 10 个既有 timeout/send-failure/status/namespaced/close 场景通过
- 2026-07-13 Client connection controller 批次：client typecheck/build、3 个目标文件 lint、3 个专用连接测试与 16 个既有 connect/reconnect/liveness/binary/terminal/dictation/SDK 场景通过
- 2026-07-13 Protocol terminal messages 批次：protocol typecheck/build、5 个目标文件 lint、42 个聚焦断言及 client/server/app/CLI 消费者 typecheck 通过
- 2026-07-13 Protocol checkout messages 批次：protocol typecheck/build、4 个目标文件 lint、66 个聚焦断言及 client/server/app/CLI 消费者 typecheck 通过
- 2026-07-13 Protocol workspace/attachment messages 批次：protocol typecheck/build、6 个目标文件 lint、44 个聚焦断言及 client/server/app/CLI 消费者 typecheck 通过
- 2026-07-13 Protocol provider messages 批次：protocol typecheck/build、8 个目标文件 lint、87 个聚焦断言及 client/server/app/CLI 消费者 typecheck 通过
- 2026-07-13 Claude SDK/Zod 4 批次：严格 npm peer 解析及 `npm ls` 通过；protocol/client/server build、protocol/client/server/app/desktop/CLI typecheck、88 个改动文件 lint、148 个聚焦断言通过；生产审计 24 项且 0 high/0 critical，Claude/Anthropic 通告为 0
- 2026-07-13 兼容型依赖安全补丁批次：npm 10.9.4 clean-install dry-run、lockfile-lint、目标格式检查与生产审计通过；生产通告从 24 降至 19，五类已修通告清零，0 high/0 critical
- 2026-07-13 Server UUID 依赖移除批次：npm 10.9.4 lockfile/clean-install dry-run、server typecheck、11 个目标文件 lint 与 client message ID 4 个精确断言通过；生产审计维持 19 且 0 high/0 critical，残余 UUID 通告仅为 Expo `xcode@3.0.1 -> uuid@7.0.3`
- 2026-07-13 Expo SDK 55 批次：`expo install --check`、Expo Doctor 19/19、核心 React/Expo 依赖树、npm 10.9.4 clean install、App typecheck、音频模块 typecheck/build、目标 lint、Android prebuild、两个自定义模块与 App `compileDebugKotlin` 通过；生产审计降至 11 且 0 high/0 critical
- 2026-07-13 Expo SDK 56 批次：`expo install --check`、Expo Doctor 21/21、核心 React/Expo 依赖树、npm 10.9.4 clean-install dry-run、App 依赖栈 build/typecheck、17 个目标文件 lint、3 个导航相关测试文件 13 个断言、Android clean prebuild、两个自定义模块与 App `compileDebugKotlin` 通过；生产审计为 12 moderate 且 0 high/0 critical
- 2026-07-14 Expo SDK 57 批次：npm 10.9.4 clean-lock/`ci --dry-run`、四个 postinstall 补丁、`expo install --check`、Expo Doctor 20/20、App 依赖栈 build/typecheck、目标 lint/format、Android clean prebuild、两个自定义模块及 App `compileDebugKotlin`、Android Hermes bundle export 通过；本地 Expo config 解析通过，EAS live config 因无 Expo 登录留到发布阶段；生产审计为 12 moderate 且 0 high/0 critical
- 2026-07-13 Protocol agent extension 批次：protocol typecheck/build、3 个目标文件 lint、18 个聚焦断言、显式 package subpath 运行时导入及 client/server/app/desktop/CLI 消费者 typecheck 通过
- 2026-07-13 Protocol daemon messages 批次：protocol typecheck/build、3 个目标文件 lint、32 个聚焦断言、显式 package subpath 运行时导入及 client/server/app/desktop/CLI 消费者 typecheck 通过
- 2026-07-14 Protocol agent messages 批次：protocol typecheck/build、4 个目标文件 lint、6 个聚焦测试文件 66 个断言、显式 package subpath 运行时导入及 client/server/app/desktop/CLI 消费者 typecheck 通过
- 2026-07-13 App workspace mobile navigation 批次：App typecheck、2 个目标文件 lint 与 15 个 tab menu/layout 聚焦断言通过；未以 web 预览替代 native mobile 验证
- 2026-07-13 App workspace command routing 批次：App typecheck 与 2 个目标文件 lint 通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace persistence/hydration 批次：App typecheck 与 2 个目标文件 lint 通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace tab open actions 批次：App typecheck 与 2 个目标文件 lint 通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace tab close actions 批次：App typecheck、2 个目标文件 lint 与 2 个关闭测试文件 7 个断言通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace pane/dock actions 批次：App typecheck、3 个目标文件 lint 与 dock model 18 个断言通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace pane content models 批次：App typecheck、2 个目标文件 lint 与 pane-content 2 个断言通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace environment panel state 批次：App typecheck 与 2 个目标文件 lint 通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace explorer/open-intent 批次：App typecheck、3 个目标文件 lint 与 open-intent 9 个断言通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace environment data 批次：App typecheck、2 个目标文件 lint 与 environment panel model 39 个断言通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace environment panel view 批次：App typecheck、2 个目标文件 lint 与 environment panel model 39 个断言通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace header view 批次：App typecheck 与 2 个目标文件 lint 通过；未运行全量 App/Playwright 测试
- 2026-07-13 App workspace center-column view 批次：App typecheck、2 个目标文件 lint 与目标格式检查通过；未运行全量 App/Playwright 或以 web 替代 native/desktop 验证
- 2026-07-13 ACP tool mapper 批次：server typecheck、3 个目标文件 lint、新 mapper 5 个断言与既有 generic permission 透传场景通过
- 2026-07-13 ACP session config 批次：server typecheck、2 个目标文件 lint 与既有 mode/model/config 7 个聚焦断言通过
- 2026-07-13 ACP NDJSON transport 批次：server typecheck、2 个目标文件 lint 与既有 stream/compat 3 个聚焦断言通过
- 2026-07-13 ACP process runtime 批次：server typecheck、3 个目标文件 lint 与 initialize timeout fail-cleanup 聚焦测试通过
- 2026-07-13 ACP terminal/path 批次：server typecheck、4 个目标文件 lint、既有 terminal 3 个与 workspace path 1 个聚焦场景通过
- 2026-07-13 ACP session update controller 批次：server typecheck、3 个目标文件 lint 与 7 个 mode/config/permission/commands/message 聚焦场景通过
- 2026-07-13 ACP foreground turn controller 批次：server typecheck、3 个目标文件 lint 与 3 个 prompt completion/failure/JSON-RPC diagnostic 聚焦场景通过
- 2026-07-13 ACP command catalog 批次：server typecheck、2 个目标文件 lint 与 2 个立即返回/异步 update 命令发现聚焦场景通过
- 2026-07-13 ACP session config controller 批次：server typecheck、3 个目标文件 lint 与 11 个配置初始化、stored override、mode provenance、config update、canonical response 聚焦场景通过；真实 provider wrapper smoke 因凭据门禁未在本地运行
- 2026-07-13 ACP session lifecycle controller 批次：server typecheck、3 个目标文件 lint、4 个 new-session/fail-cleanup/load-replay/close 单测与 6 个配置/turn/command Session 接线场景通过
- 2026-07-13 Pi permission mapper 批次：server typecheck、3 个目标文件 lint 与既有 extension UI/ask_user 6 个聚焦场景通过
- 2026-07-13 Pi extension history 批次：server typecheck、2 个目标文件 lint 与既有 live user entry ID/rewind tree navigation 2 个聚焦场景通过
- 2026-07-13 Pi session event controller 批次：server typecheck、2 个目标文件 lint 与 Pi agent 23 个 permission/tool/message/turn/process-exit 聚焦场景通过
- 2026-07-13 Pi runtime/session lifecycle 批次：server typecheck、4 个目标文件 lint 与 Pi agent 24 个 create/resume/env/model/MCP/permission/tool/message/turn 聚焦场景通过
- 2026-07-13 Claude session identity 批次：server typecheck、4 个目标文件 lint 与 6 个 mode/session/model/persistence/session-switch 聚焦场景通过
- 2026-07-13 Claude foreground turn 批次：server typecheck、2 个目标文件 lint 与 5 个 interrupt/reuse/stale abort/rewind 聚焦场景通过
- 2026-07-15 CLI Provider 工具管理批次：CLI typecheck、4 个目标文件 lint、2 个成功/失败 runner 场景，以及 `provider --help` / `provider install --help` 真实命令入口通过；MCP 继续只读
- 2026-07-15 Provider tooling 只读状态 parity 批次：protocol/CLI/server build、CLI/server typecheck、8 个目标文件 lint、CLI 3 个 refresh/list/降级场景、MCP 2 个 list/inspect 场景与真实 `provider ls --help` 入口通过；MCP 未新增任何全局工具变更能力

未在本地运行全仓测试或全量 Playwright/Maestro；按仓库规则只做改动对应的聚焦验证，普通开发不触发远端 CI。

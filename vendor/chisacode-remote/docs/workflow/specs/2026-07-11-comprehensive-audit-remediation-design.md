# 全面审查修复设计

> 日期：2026-07-11  
> 状态：已批准执行  
> 审查基线：`v1.0.2...f42694468`  
> 目标分支：`codex/comprehensive-audit-fixes`

## 1. 目标

本设计把 2026-07-10 全面审查中确认的问题收敛为可独立验证的修复批次：

1. 修复全部已确认 P1，不保留默认开启的危险兼容行为。
2. 一并修复与 P1 共用根因或代码路径的高价值 P2。
3. 为每个行为缺陷补充先失败、后通过的定向回归测试。
4. 保持 protocol 的旧客户端/旧 daemon 解析兼容性。
5. 更新综合改进路线图，记录问题、批次、状态与验证证据。
6. 以受影响测试、lint、typecheck、格式检查和安全复核完成验收。

## 2. 非目标

- 不在本批次完成 provider god-file 全量拆分。
- 不清理所有历史 P3、所有 knip 告警或所有测试债。
- 不运行完整 workspace Vitest、完整 Playwright、真实 provider 或破坏性资源耗尽测试。
- 不以 Web 预览替代 Electron 桌面或 Android 原生验证。
- 不改变 AppImage 仅该发行格式使用 `--no-sandbox` 的既有安全决策。

## 3. 方案选择

采用分批方案，而不是一次性巨型补丁：

- 每个批次只跨越一个清晰的信任边界或状态机。
- 每个批次有独立测试文件和回滚边界。
- wire 变更先增加兼容能力，再改变生产行为。
- 配置/CI 修复与运行时代码分开，避免把门禁失败和功能回归混在一起。

## 4. 修复批次

### 4.1 文件路径与认证凭据

#### Schedule ID

- 在 protocol 提供唯一的 `ScheduleIdSchema`：1–128 个 ASCII 字母、数字、下划线或连字符。
- 所有客户端可控 `scheduleId` RPC 复用该 schema；磁盘记录继续按既有 schema 读取，避免收窄历史数据格式。
- store 仍做防御性路径解析：解析后的父目录必须等于 schedule 目录。
- 非法 ID 在进入文件系统前返回 RPC validation error。

#### Script proxy

- HTTP 转发始终删除 daemon 的 `Authorization`。
- WebSocket 子协议只删除 `chisacode.bearer.*`，保留上游应用自己的子协议。
- 认证仍在剥离前完成，因此不会削弱 daemon 的入口鉴权。

### 4.2 Desktop daemon 生命周期

- packaged smoke 创建独立临时 `CHISACODE_HOME` 和 Electron `userData`。
- desktop、bundled CLI、terminal smoke 与 cleanup 全程使用同一个隔离 home。
- cleanup 只停止隔离 home 中由本次 smoke 启动的 daemon。
- CLI stop 在 RPC 不可达、准备发信号前验证 PID 身份；共享 verifier 返回 match/mismatch/unknown，CLI 仅在 match 时发送信号。daemon 启动锁对 unknown 保持既有保守语义，避免因平台探针失败启动第二个 daemon。

### 4.3 Loop 与 relay 资源边界

- verify command 接收 `AbortSignal`；loop stop 必须能终止子进程并让 Promise settle。
- `maxTimeMs` 同时约束正在运行的 verify command，而不只在迭代边界检查。
- relay control message 对 connection ID 做字符、长度、去重和批量上限校验。
- daemon `dataSockets` 设置硬容量；超限记录警告并拒绝新增连接，不驱逐已建立连接。

### 4.4 Generative UI wire 与渲染模型

- `CLIENT_CAPS` 新增 GenUI capability；`server_info.features` 新增 daemon 支持标志。
- 新客户端只在 daemon 宣告支持时发送交互；新 daemon 只向宣告 capability 的客户端发送新 GenUI wire 类型。
- fence 的唯一权威表示是原始 `assistant_message`；服务端不再为同一 fence 追加第二条 `generative_ui` timeline row。
- App 继续从 Markdown fence 渲染组件；独立 timeline 类型保留用于未来显式 tool-produced UI，但必须经过 capability gate。
- 新 RPC 使用 `generative_ui.action.request/response`；旧 flat 名称继续解析，标记 `COMPAT`，但新 client 只发送新名称。

### 4.5 Generative UI action 状态机

- running agent 的 UI action 不调用 `replaceAgentRun`。
- action 由 AgentManager 按 agent 全局合并排队，避免多个客户端 Session 各自形成并发队列；当前 turn settle 后，以一个系统通知 prompt 注入下一轮。
- 同一 instance 的连续 `change` 只保留每个 field 的最新值；`submit` 保留顺序并触发一次 flush。
- App 在发送前调用 registry 的 `validateActionPayload`。
- server 校验 action/instance/component 字符长度及序列化 payload 上限。
- 表单只在 RPC 成功后进入 submitted；失败恢复可编辑状态并显示可重试错误。

### 4.6 Provider 与 Android

- Claude 的启动和动态 `setThinkingOption` 共用 `ClaudeThinkingOption`，包含 `ultracode`。
- Ultracode 在现有 `flagSettingsOptions` 上合并，而不是替换 runtime env、fast mode 或 gateway setting sources。
- Android foreground service 只在 App 后台且连接需要保活时运行；捕获并记录启动失败。
- dataSync service 实现平台 timeout 回调并及时 `stopSelf()`，不使用无限粘性重启语义。
- 本地通知把结构化 data 写入启动 Intent，并由 JS 入口恢复路由。
- 状态栏样式从实际主题元数据派生，不维护易漂移的主题名白名单。

### 4.7 高价值可靠性修复

- `DaemonClient.close()` 必须 reject 未完成的 `connect()`。
- file transfer 在分配前限制声明大小，并要求累计 chunk 长度精确等于声明值。
- workspace hydration 失败不能标记为成功；保留 retry 状态，并忽略迟到的已超时响应。
- WebSocket 错误日志只记录消息类型、requestId 和截断后的安全摘要，不记录完整 parsed payload。
- `chat/wait` 必须有有限 deadline，session dispose 时清理 waiter。
- WebSocket 设置明确 `maxPayload` 和每 session inflight 上限。

### 4.8 CI 与发布门禁

- 所有默认分支 workflow 使用 `cn-main`；worktree 测试 fetch `origin/cn-main`。
- CI 增加 `npm run format:check`。
- protocol exports 的决策是保留显式 exports，同时让兼容测试验证 v1.0.2 已发布 subpath 集合，不重新开放无限 wildcard。
- lockfile host 策略与仓库 lockfile 收敛到 npm registry；不得通过放宽 allowlist 掩盖镜像来源。
- 修复当前 test-audit 增量，不抬高 baseline。

## 5. 兼容策略

- wire schema 只新增 optional/defaulted 字段，不删除或收窄旧字段。
- 新 GenUI RPC 与旧 flat RPC 并存一个兼容窗口。
- 旧客户端未声明 capability 时，不接收其 schema 无法解析的 timeline/event。
- schedule 列表仍可读取既有合法磁盘记录；客户端定向访问只接受无路径分隔符的安全 ID。

## 6. 测试策略

- 单元测试使用真实临时目录、内存 port/fake，不使用 `vi.mock` 或固定 sleep。
- 每个 bug 先运行对应测试并确认因原缺陷失败，再实现并确认通过。
- 只运行发生变化的 Vitest 文件，使用 `--bail=1`。
- Desktop smoke 本身不动态运行；通过 env/home 构造和 stop 目标单测证明隔离。
- Android Kotlin 逻辑以纯 helper/JVM 可测边界和 TypeScript contract 测试覆盖；设备验证保留为未验证项，不能用 Web 替代。

## 7. 验收标准

- 全部计划任务的定向测试通过。
- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run format:check` 通过，且 `git diff --check` 无输出。
- `npm run test:audit` 不高于既有 baseline。
- protocol package exports 测试通过。
- 最终安全复核确认 schedule、proxy、smoke、relay、GenUI compatibility 没有旁路。
- 工作区没有非计划产物，路线图包含本批次完成记录。

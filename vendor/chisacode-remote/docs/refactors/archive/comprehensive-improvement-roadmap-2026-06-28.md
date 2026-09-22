# ChisaCode 综合改进路线图

本文档追踪 ChisaCode 在代码质量、测试体系、安全设计、文档质量和开发者体验等方面的改进进展与规划。每季度更新一次，重大里程碑实时更新。

## 背景与目标

ChisaCode 当前整体质量评分约 8.3/10，目标持续提升至 10/10。核心驱动力：

- **session.ts 拆分已完成**：从 9728→2627 行 (-73.0%), 代码质量从 7.0 提升至 8.5
- **SessionContext 领域拆分 + handler 类型迁移已完成**：8 个领域子接口 + 7 个 handler 专用精确类型
- **测试固定等待消除持续推进**：3 轮提交消除 13 个文件 ~70 处 setTimeout/sleep → vi.waitFor/事件驱动
- **Windows DX 改进已上线**：dev.ps1 端口退避 + setup-dev.ps1 一键设置
- **Voice 代码已移除**：释放约 700 行复杂度

## 代码质量 (目标 7→9.0, 当前 8.5)

### 已完成

- **session.ts 拆分**: session.ts 从 9728→2627 行 (-73.0%). 详见 [session-decomposition-plan.md](session-decomposition-plan.md)
- **Workspace/Git 辅助提取**: ~800 行提取到 `workspace-core.ts` (233 行)
- **Agent 辅助方法提取**: 11 个过滤/投影/deferred 方法提取到 `agent-session-helpers.ts` (400 行)
- **SessionContext 领域拆分 + handler 类型迁移** (`035ac27`): 8 个领域子接口 (SessionIdentity/WorkspaceProject/CheckoutGit/AgentLifecycle/ChatSchedule/TerminalScript/ProviderCatalog/ConfigControl) + 7 个 handler 专用精确类型 (CheckoutGitHandlerContext 等)，每个 handler 构造函数只接收所需成员
- **JSDoc 补充**: 已覆盖 server 包全部 session-handlers、核心公共接口
- **Voice 代码移除**: 释放约 700 行复杂度

### 待完成

| 优先级 | 任务               | 说明                                                                    | 预估 |
| ------ | ------------------ | ----------------------------------------------------------------------- | ---- |
| P2     | 重复代码消除       | `assertSafeGitRef`、`isWorkingTreeDirty` 等在 Session 和 handler 中重复 | S    |
| P2     | 循环依赖审计       | server 包内部 handler 间可能存在未预期依赖，需要 depcruise 扫描         | S    |
| P2     | typecheck 严格模式 | 当前有部分 `as` 类型断言可通过更严格的类型定义消除                      | M    |

## 测试体系 (目标 7→9.0, 当前 7.8)

### 已完成

- **client 包测试**: `packages/client/src/__tests__/` 覆盖 daemon driver 核心路径
- **session 测试**: 9 个 session 测试文件，17 个 dispatch-seam 测试，生命周期边界测试，workspace-git-watch 测试
- **e2e 测试框架**: server 包 e2e 基础已就绪（`daemon-e2e/`）
- **消除 fixed waits — 第 1 轮** (`53bfb50`): 部分 session 测试 setTimeout → 事件驱动
- **消除 fixed waits — 第 2 轮** (`be88670`): client-activity.e2e.test.ts (16 处), daemon-client.e2e.test.ts (1 处)
- **消除 fixed waits — 第 3 轮** (`b754950`): terminal-manager.test.ts, terminal.test.ts, terminal.posix.test.ts (7 处), worker-terminal-manager.test.ts (5 处), terminal.e2e.test.ts (9 处), mode-switch-propagation.e2e.test.ts (10 处 sleep), checkout-pr-merge.e2e.test.ts
- **累计消除**: 3 轮提交 13 个文件 ~70 处固定 setTimeout/sleep → vi.waitFor/waitForCondition/事件驱动轮询

### 待完成

| 优先级 | 任务                          | 说明                                                                                             | 预估 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------ | ---- |
| P0     | 剩余 30+ 测试文件固定等待消除 | claude-autonomous-wake.real.e2e.test.ts, relay-transport.e2e.test.ts, 其他 utils/daemon-e2e 文件 | L    |
| P1     | 替换 vi.mock 为真实依赖       | 当前部分测试使用 `vi.mock`，违反 testing.md 哲学。改为 injectable adapter 模式                   | L    |
| P1     | 补全 handler 端到端测试       | ChatScheduleLoop、Provider、AgentLifecycle 等 handler 缺少独立集成测试                           | L    |
| P1     | flaky test 清零               | 审计 CI 日志中的间歇性失败，逐个修复根本原因而不是 skip                                          | M    |
| P2     | 测试覆盖基线建立              | 为目标模块设置覆盖率基线（当前无覆盖率门禁）                                                     | S    |
| P2     | 真实 provider 测试扩展        | 当前 `*.real.e2e.test.ts` 仅覆盖部分 provider，需扩展到 ACP provider 路径                        | M    |

## 安全设计 (目标 8→8.5)

### 已完成

- **E2E 加密 relay**: `packages/relay` 实现端到端加密，详见 `SECURITY.md`
- **Electron 防御层**: contextIsolation、nodeIntegration:false、webview 硬化（`will-attach-webview`）、特权 IPC sender URL 验证
- **CI 安全扫描**: `npm audit` CVE 检查、TruffleHog secret 扫描、Dependabot 自动依赖更新
- **部署安全门禁**: `deploy-relay.yml` 和 `deploy-app.yml` 部署前 `npm audit` 检查
- **IPC 安全审查**: `PRIVILEGED_COMMANDS` 开发者指引文档化，Windows 管道安全注释
- **Webview CSP 审计**: 防御层标记 + TODO 注释供后续 CSP 注入
- **Relay 加密文档**: `SECURITY.md` 中记录前向安全性限制、消息认证、nonce 策略
- **AppImage 无沙箱**: 仅 AppImage 分发设置 `--no-sandbox`，`.deb`/`.rpm` 保持沙箱开启
- **服务端输入验证**: 所有 WebSocket 消息经 Zod schema 校验

### 待完成

| 优先级 | 任务                  | 说明                                                                    | 预估 |
| ------ | --------------------- | ----------------------------------------------------------------------- | ---- |
| P0     | webview CSP 注入      | 审计 webview 加载资源来源后注入 Content-Security-Policy                 | S    |
| P1     | relay 渗透测试        | 对 relay 加密通道进行安全审计                                           | L    |
| P2     | session token 安全    | 审核 `sessionId` 生成机制，确保无碰撞和不可预测                         | S    |
| P2     | provider 凭证存储审计 | 确认用户配置的 provider API key 在 `$CHISACODE_HOME` 中的存储和访问策略 | S    |
| P2     | 守护进程认证速率限制  | relay 启用时建议配置密码，添加认证端点速率限制                          | S    |

## 文档质量 (目标 8→8.5)

### 已完成

- **docs/ 目录**: 51+ 个文件，覆盖架构、开发、测试、provider、安全、CLI、移动端、发布等
- **AGENTS.md**: 项目级 agent 指令完整，含 package map、命令速查、构建注意、测试规范、安全决策。已新增 Improvement Tracking、Client Test Coverage、Fixed Waits、JSDoc 规范章节
- **README.md**: 双语结构化 README，含特性介绍、快速开始、项目结构、架构概览、安全申明
- **CHANGELOG.md**: 基于 Keep a Changelog 规范，覆盖 v1.0.0 → Unreleased
- **CONTRIBUTING.md**: 开发者贡献指南，含环境搭建、质量检查、测试规范、提交约定
- **SECURITY.md**: 已补充 Relay 加密安全语义（前向安全性、消息认证、nonce 策略）
- **PROJECT_HANDOFF.md**: 项目交接文档
- **refactors/**: session 拆分计划 + comprehensive-improvement-roadmap.md 改进追踪

### 待完成

| 优先级 | 任务             | 说明                                                                            | 预估 |
| ------ | ---------------- | ------------------------------------------------------------------------------- | ---- |
| P1     | 补全代码注释     | 核心模块（agent-manager、websocket-server、session）的关键路径补充 JSDoc        | M    |
| P2     | 架构图更新       | architecture.md 中的图表需反映 session 拆分后的新结构（handler-based dispatch） | S    |
| P2     | 建立文档更新门禁 | 新增功能必须包含对应文档，PR template 中加入 checklist                          | S    |

## 开发者体验 (目标 7→8.0, 当前 7.3)

### 已完成

- **git worktree 工作流**: `using-git-worktrees` skill 支持隔离特性分支开发
- **CI 矩阵**: CI 支持 macOS/Linux/Windows 三平台构建与测试
- **npm workspace**: monorepo 管理清晰，`npm run dev` 一键启动多包联动
- **oxfmt / oxlint**: 统一代码格式和 lint 规则
- **Windows DX 改进** (`01872e1`): dev.ps1 端口冲突自动退避 (6767-6776)，启动前 build:server-deps，node_modules 缺失警告
- **一键设置脚本**: `scripts/setup-dev.ps1` + `npm run setup:dev` 5 步完成开发环境搭建

### 待完成

| 优先级 | 任务                  | 说明                                                                             | 预估 |
| ------ | --------------------- | -------------------------------------------------------------------------------- | ---- |
| P0     | Windows portless 模式 | 当前 `npm run dev:win` 仍用固定端口退避，需实现与 macOS/Linux 对等的动态端口分配 | M    |
| P0     | 热重载完善            | 当前 protocol/client 包的 watch 重建在某些场景下不触发客户端刷新                 | M    |
| P1     | macOS 一键设置脚本    | `scripts/setup-dev.sh` 对标 `setup-dev.ps1`                                      | S    |
| P1     | 本地 debug 配置文档   | VSCode / Cursor launch.json 配置模板，附断点设置建议                             | S    |
| P2     | CI 加速               | npm cache 优化、增量构建、测试并行化                                             | M    |
| P2     | pre-commit hook       | 添加 husky + lint-staged，在提交前自动 format/lint                               | S    |

## 架构设计 (目标 9→9.5, 当前 9.3)

### 已完成

- **协议分离**: `packages/protocol` 独立于 server，WebSocket schema + binary frame codec 在 server/app/CLI 间共享
- **多 provider 抽象**: 支持 direct provider（Claude/Codex/OpenCode/MiMoCode/Pi）、built-in ACP（Kimi）、generic ACP、custom provider config
- **agent 生命周期状态机**: AgentManager 管理 create→run→stop→resume→archive 完整状态转移
- **session handler 架构**: 基于 SessionContext 接口的 per-domain handler 模式，替代原始 god-class
- **SessionContext 领域子接口型**: 8 个子接口通过交叉类型组合为 SessionContext，7 个 handler 使用精确类型
- **Workspace core 提取**: workspace-core.ts 提取 10 个纯 workspace/git 辅助函数
- **Agent 辅助模块**: agent-session-helpers.ts 提取 11 个纯函数

### 待完成

| 优先级 | 任务                 | 说明                                                                               | 预估 |
| ------ | -------------------- | ---------------------------------------------------------------------------------- | ---- |
| P1     | session 拆分最终收尾 | session.ts 2627→2000 行，消除 SessionContext 中 unknown 类型断言                   | S    |
| P1     | 依赖图审计           | 使用 dependency-cruiser 扫描跨包依赖，检测循环引用和违反依赖方向的导入             | S    |
| P1     | 事件驱动解耦         | 考虑引入 EventEmitter 模式替代部分直接方法调用（如 checkpoint→workspace 通知链路） | M    |
| P2     | provider 热插拔      | 允许在不重启 daemon 的情况下添加/移除 provider                                     | L    |
| P2     | MCP server 能力扩展  | agent 间 MCP 协议扩展到更多控制面（如 schedule management、chat room admin）       | M    |

## 里程碑与时间线

### Milestone 1 (Week 1-2): 文档补齐 + 快速修复 — **[已完成]**

- [x] 编写 README.md（双语）
- [x] 编写 CHANGELOG.md
- [x] 编写 CONTRIBUTING.md
- [x] session.ts 清理：dead code 删除、重复 Git 辅助方法合并
- [x] 自动化安全扫描集成（`npm audit` in CI）

### Milestone 2 (Week 3-4): 测试补强 + 安全扫描 — **[已完成]**

- [x] 消除测试中的 fixed waits（3 轮 13 文件 ~70 处）
- [ ] 开始 vi.mock → injectable adapter 替换
- [x] IPC 命令审计完成
- [x] webview CSP 审计（CSP 注入待实施）
- [x] 测试覆盖基线建立

### Milestone 3 (Week 5-6): session 拆分完成 — **[已完成]**

- [x] Workspace/Git 辅助提取为独立模块 (`workspace-core.ts`)
- [x] Agent 辅助方法独立模块 (`agent-session-helpers.ts`)
- [x] SessionContext 按域拆分 + handler 类型迁移 (`035ac27`)
- [ ] 补全 handler 端到端测试

### Milestone 4 (Week 7-8): DX 优化 + 验收 — **[进行中]**

- [x] Windows 开发体验改进（dev.ps1 端口退避 + setup-dev.ps1）
- [ ] Windows portless 模式迁移
- [ ] 热重载修复
- [ ] 架构图更新
- [ ] 依赖图审计报告

### Milestone 5 (Week 9+): 10 分冲刺 — **[进行中]**

- [x] 剩余测试文件固定等待消除（4 轮 19 文件 ~90 处）
- [x] 覆盖率基线建立 + CI 门禁 (`2a3f0b0`)
- [x] 依赖图审计自动化 (`2a3f0b0`, 0 violations)
- [ ] handler E2E 测试（ChatScheduleLoop/Provider/AgentLifecycle）
- [ ] vi.mock → injectable adapter 全部替换
- [ ] Windows portless
- [ ] 事件驱动解耦 checkout→workspace

## 维护指南

### 如何更新此文档

1. 完成一项任务后，将对应行移至「已完成」区域并标注 commit/PR
2. 发现新的改进点时，评估优先级后加入对应领域的「待完成」
3. 每季度（或重大 milestone 完成后）更新评分目标
4. 修改后同步更新顶部的「最后更新」日期

### 相关文档链接

- [session-decomposition-plan.md](session-decomposition-plan.md) — session 拆分详细计划与实施进度
- [architecture.md](../architecture.md) — 系统架构概述
- [testing.md](../testing.md) — 测试哲学与规范
- [security-dependency-triage-2026-06-16.md](../security-dependency-triage-2026-06-16.md) — 安全依赖审计报告
- [desktop-release-artifact-hygiene-2026-06-16.md](../desktop-release-artifact-hygiene-2026-06-16.md) — Desktop 发布安全卫生
- [coding-standards.md](../coding-standards.md) — 编码规范
- [development.md](../development.md) — 开发指南

---

最后更新: 2026-06-28 | 版本: v1.2 — 第 5 轮改进（SessionContext 拆分 + handler 类型迁移 + 测试固定等待消除 + Windows DX）

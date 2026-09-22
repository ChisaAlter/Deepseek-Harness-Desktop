# ChisaCode 借鉴 Cindy 清单

> 基于 ChisaCode (841bcb7) 与 Cindy (makecindy/cindy@main) 的代码级对比审查。
> 第二轮全面重审后更新，含优先级重评 + 8 项新发现。

## 高优先级

### 1. Project Context（代理维护的项目知识层）🆕

- **Cindy 实现**：`packages/project-context`——自动发现仓库模块，为每个模块生成 markdown 知识文件（frontmatter: id/type/covers/depends_on/stale），用 agent 根据 git diff 自动更新，"是什么"段落注入 session system prompt TOC
- **ChisaCode 现状**：agent 每次启动都要重新理解项目，无持久化项目知识
- **建议方案**：daemon 侧加 `project-context` 服务：扫描 workspace 模块 → 生成/更新知识文件 → 注入 agent system prompt
- **可直接参考**：`knowledge.ts`（frontmatter + 原子写入）、`discovery.ts`（模块发现）、`config.ts`（small_diff_threshold 触发更新）
- **复杂度**：中
- **价值**：极高——直接减少 agent 的冷启动理解成本

### 2. Goal 系统（自主目标追踪）🆕

- **Cindy 实现**：`goal-host/`——完整状态机（active/paused/blocked/complete/budgetLimited/usageLimited），三重安全护栏（maxTurns/budgetTokens/noProgressLimit），usageLimited 到点自动续跑，目标达成落持久记录
- **ChisaCode 现状**：只有 cron scheduler（定时触发），无"给目标让 agent 自主跑到完成"
- **建议方案**：daemon 侧加 `goal-service`：设目标 → 每轮结束裁决（继续/暂停/完成/撞限）→ 自动续轮 → 安全护栏
- **可直接参考**：`types.ts`（GoalState/GoalLimits/GoalStatus 完整定义）、controller 的状态机编排、`usageResetAt` 自动续跑 timer
- **复杂度**：中
- **价值**：高——把 agent 从"一问一答"升级为"自主执行"

### 3. Lead/Worker 协同编排（Orca）

- **Cindy 实现**：四服务分离（Lifecycle/WorkerCreation/Team/InterAgentDispatcher），Worker 是完整持久 session，消息排队（list/update/cancel），MCP 控制面 16 个工具，数量闸（soft/hard limit）
- **ChisaCode 现状**：subagent 委派是一次性的，无角色分工、无消息队列、无持久 worker
- **建议方案**：daemon 侧 `team-service`，worker 复用现有 session 基础设施，MCP 工具暴露控制面，team 状态放 JSON 文件（不需要 Cindy 的 SQLite）
- **重评**：设计思路极好，但 Cindy 强依赖 SQLite + Electron IPC。ChisaCode 要做需要适配 daemon 架构
- **复杂度**：高

### 4. SSH 远程代理执行

- **Cindy 实现**：`maker-remote-ssh`（连接池）+ `maker-cc-manager`（远程 NDJSON RPC daemon，detach/reattach + ring buffer）
- **ChisaCode 现状**：relay 只解决远程访问本地 daemon
- **建议方案**：远程 agent = transport 为 SSH stdio 的 ACP provider
- **重评**：与 ChisaCode 的 ACP 协议天然兼容，工程量可控
- **复杂度**：中

### 5. 消息渲染可读性

- **Cindy 实现**：react-markdown + 7 remark + 4 rehype 插件（KaTeX 公式、CJK URL 修复、mermaid、diff 块、路径 chip），流式节流 100ms，15px/1.6 排版
- **ChisaCode 现状**：RN markdown 渲染，无公式/mermaid/diff 专用渲染
- **建议方案**：Web 端迁移 react-markdown 体系；移动端优先补公式和代码块
- **重评**：用户体感最直接，但 RN 端受限大，分两步走
- **复杂度**：中（Web）/ 高（RN）

### 6. Git Snapshot/Rewind（自动快照回滚）🆕 ✅ 已落地

- **Cindy 实现**：`git-snapshot/`——编辑前后自动创建 snapshot commit（XDT trailer 元数据），文件安全过滤 + secret 脱敏，阻塞检测（merge/rebase 时不快照），配合 file rewind executor 做文件级回滚
- **ChisaCode 现状**：有 worktree 管理但无自动快照/回滚
- **建议方案**：daemon 侧在 agent 编辑操作前后自动 `git commit`（独立分支），暴露 rewind MCP tool
- **可直接参考**：`snapshotFileFilter.ts`（安全过滤）、`snapshotTrailers.ts`（元数据格式）、`secretRedactor.ts`（脱敏）——上游 Cindy 仓库 `makecindy/cindy`，参考时请 pin 到具体 commit
- **复杂度**：中
- **价值**：高——agent 改错代码时用户能一键回滚
- **安全前置依赖**：**必须先实现 #17 敏感路径检测，并在 snapshot 前过滤/脱敏；否则不得自动 commit。** ChisaCode 已落地 `packages/server/src/utils/sensitive-path.ts` 并接入 git-snapshot 过滤（见硬化计划 S2/S4）。
- **落地状态**：`packages/server/src/server/git-snapshot.ts` + `snapshot-handler.ts` + `snapshot/{create,list,rewind,status}` RPC。硬化修复：`commitHash` hex 校验防注入、临时 `GIT_INDEX_FILE` 不动用户暂存区、`cwd` 绑定已注册 workspace。

## 中优先级

### 7. 统一模型目录

- **Cindy 实现**：per-agent 分组模型清单 + 跨供应商一致性校验 + 运行时动态发现 + OSS 热更
- **ChisaCode 现状**：模型列表散落在各 provider
- **重评**：Cindy 的 builtin.ts 里模型列表全是空数组（运行时注入），ChisaCode 不需要这么复杂——静态目录 + provider 自报即可
- **复杂度**：中

### 8. 同会话 Agent 切换 + 配置迁移

- **Cindy 实现**：VendorSegmentedSwitcher + cross-agent-convert（4 项配置文件转换）
- **重评**：从"高"降到"中"。ChisaCode 的 session 是 JSON 记录，加个 providerId 可变字段就行；配置迁移是锦上添花
- **复杂度**：低（切换）/ 中（配置迁移）

### 9. Learn 系统（从代码审查中学习）🆕

- **Cindy 实现**：`learn-host/`——collecting（证据打包）→ distilling（后台 session 蒸馏）→ staging（校验提案）→ awaiting-review（用户审查，7 天过期）→ apply/discard。全局并发 1
- **ChisaCode 现状**：无
- **建议方案**：daemon 侧加 learn pipeline，用现有 agent session 做蒸馏
- **复杂度**：中
- **观察**：与 SkillHub 配合才有完整价值，单独做收益有限

### 10. 测试分层

- **Cindy 实现**：五级测试 + guard 层架构不变量检查
- **重评**：保持，低成本高收益
- **复杂度**：低

### 11. i18n 门禁

- **重评**：保持，低成本
- **复杂度**：低

## 低优先级 / 观察

### 12. 插件/扩展系统

- **Cindy 实现**：GhostManager——zip 安装 + staging + 签名验证 + trust registry + 沙箱 + 面板渲染 + 市场
- **重评**：从"高"降到"观察"。完整插件分发体系工程量巨大（GhostManager 本身 ~500 行，加 60+ 个 cindy-brain 模块）。ChisaCode 当前阶段应聚焦核心能力，插件生态是产品成熟后的事
- **最小可行**：daemon 侧 MCP 插件注册（不做分发市场）

### 13. 浏览器控制能力

- **重评**：从"高"降到"观察"。Cindy 的 ~200 个文件大量是 `_generated` shim（从闭源仓库同步），真正可参考的是架构思路。MCP tool 方案合理但工程量巨大，短期 ROI 不高

### 14. IM / Webhook 触发

- **Cindy 实现**：`hook-control/`——Slack/Telegram 深链 → 创建 session → 派活，配合 Goal 系统 = "从 IM 发消息让 agent 自主跑到完成"
- **重评**：从"低"升级。与 Goal 系统（#2）配合价值极高
- **观察**：ChisaCode 的 daemon 架构天然适合（webhook → daemon HTTP → 创建 session）

### 15. SkillHub（技能市场）🆕

- **Cindy 实现**：`skillhub/`——auto-sync、folder hash、frontmatter 验证、install lock、market API、publish service、usage analytics
- **观察**：与 Learn 系统（#9）配合才有完整价值

### 16. 全文搜索

- **重评**：从"中"降到"观察"。ChisaCode 用户场景是管理运行中的 agent，不是翻历史

### 17. 敏感路径检测 🆕 ✅ 已落地

- **Cindy 实现**：`security/sensitivePath.ts`——独立的敏感文件检测器，20+ 种规则（.env、SSH 私钥、.npmrc、.aws/、.kube/、pem/key/p12/jks/keystore 扩展名、gcloud/gh 凭证、secrets/credentials 目录），返回检测器名称，支持 allowEnvTemplates 和 excludeCredentialConfigDirs 选项（上游 `makecindy/cindy`，参考时 pin 到具体 commit）
- **ChisaCode 现状**：agent 文件操作和 worktree 管理无敏感文件感知
- **建议方案**：在 `packages/server` 加 `sensitive-path.ts`，用于 git snapshot 过滤、agent 文件下载拦截、worktree 归档警告
- **可直接参考**：`sensitivePath.ts` 完整实现（~120 行，零依赖，纯函数）
- **复杂度**：极低
- **落地状态**：`packages/server/src/utils/sensitive-path.ts` 已落地并接入 git-snapshot 过滤（硬化计划 S2/S4）。剩余接入点（agent 文件下载拦截、worktree 归档警告）作为后续——需先明确 attachment 下载与 worktree 归档的具体代码路径。

### 18. 定时任务引擎独立化

- **重评**：从"观察"移到"不借鉴"。收益太小

## 明确不借鉴

| Cindy 的做法                       | 原因                                     |
| ---------------------------------- | ---------------------------------------- |
| SQLite + Drizzle + 81 个 migration | ChisaCode 的 JSON 持久化是刻意的极简选择 |
| 桌面端作为大脑                     | ChisaCode 的 daemon-centric 是核心优势   |
| 云服务依赖                         | 与 local-first 定位矛盾                  |
| DCO 签名                           | 门槛过高                                 |
| 协议翻译桥                         | ChisaCode 直接 spawn agent 进程，不需要  |
| pnpm                               | 纯偏好差异                               |
| 定时任务引擎独立化                 | 收益太小                                 |

## ChisaCode 独有优势（不应丢失）

| 优势              | 说明                                            |
| ----------------- | ----------------------------------------------- |
| E2E 加密 relay    | Curve25519 + XSalsa20-Poly1305 + 序列号重放保护 |
| 二进制帧协议      | 终端流和文件传输走二进制帧                      |
| Generative UI     | Agent 在聊天里渲染图表/表格/表单（Cindy 没有）  |
| CLI               | Docker 风格命令行（Cindy 没有）                 |
| 真正的多客户端    | 手机/Web/CLI/桌面都是 daemon 的平等客户端       |
| 7+ agent provider | Cindy 只有 Claude Code + Codex                  |

## 审查进度

- [x] 仓库结构对比
- [x] 进程模型与架构哲学
- [x] Agent 抽象与 Provider 体系
- [x] 持久化层
- [x] 协议设计
- [x] 桌面端内部（含 cindy-brain、goal-host、learn-host、git-snapshot、usage、hook-control）
- [x] 移动端
- [x] 包拆分哲学
- [x] 测试体系
- [x] 开发者工具链
- [x] 模型配置共享机制
- [x] 同会话 Agent 切换 + 配置迁移
- [x] Lead/Worker 协同编排（Orca）
- [x] 消息渲染可读性
- [x] Project Context（项目知识层）
- [x] Goal 系统（自主目标追踪）
- [x] Learn 系统（技能提取）
- [x] Git Snapshot/Rewind
- [x] GhostManager 插件运行时
- [x] SkillHub 技能市场
- [x] 用量/费用追踪
- [x] Hook Control / Webhook 触发
- [x] anthropic-compat-proxy / responses-chat-bridge
- [x] ChisaCode 独有优势盘点
- [x] Cindy device-link 协议（云中继 envelope + IPC 隧道白名单 + presence/heartbeat）
- [x] Cindy 安全模型（CSP 注入、sensitivePath 检测、safeStorage 凭证、默认拒绝白名单）
- [x] voice-input-core（provider-neutral 听写状态机）
- [x] embedding-client / file-browser-core / project-context CLI

## 审查结论

两轮全面审查完成。共识别 **17 项可借鉴**（6 高 / 5 中 / 6 观察）+ **7 项明确不借鉴** + **6 项 ChisaCode 独有优势**。

高优先级 6 项如果全部落地，ChisaCode 将从"agent 遥控器"进化为"自主执行平台"：

1. Project Context → agent 不再冷启动
2. Goal 系统 → 给目标自主跑到完成
3. Orca 协同 → 多 agent 分工协作
4. SSH 远程 → 远程机器跑 agent
5. 消息渲染 → 用户体感质的飞跃
6. Git Snapshot → agent 改错一键回滚

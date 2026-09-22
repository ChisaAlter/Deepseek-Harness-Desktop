# Cindy 集成硬化与收尾开发计划

> **状态：规划中（2026-07-29）**
>
> 基于 `origin/cn-main`（领先本地 `841bcb7` 共 14 个提交、67 文件、约 8500 行）的代码级对抗性审查 + `docs/cindy-borrow-checklist.md` 落地核实。
> 本文是**单一事实源**，整合"需要修复的缺陷"与"未落地的借鉴项"两条工作线，给出可执行的修复/收尾路径。
> 上游集成尚未合入本地 `cn-main`；本文假定修复在合入前于 `origin/cn-main` 之上进行，或合入后立即跟进。
>
> 相关文档：
>
> - 借鉴清单：[`docs/cindy-borrow-checklist.md`](../cindy-borrow-checklist.md)
> - 路线图主索引：[`comprehensive-improvement-roadmap.md`](comprehensive-improvement-roadmap.md)
> - Session 分解：[`session-decomposition-plan.md`](session-decomposition-plan.md)

---

## 0. 背景与执行原则

`origin/cn-main` 把 Cindy 的 6 个高优借鉴项几乎全部"形"上落地了（Project Context / Goal / Orca team / SSH 远程 / 消息渲染 / Git Snapshot），外加 5 个中优项里的 4 个（模型目录 / 配置迁移 / Learn / 测试+i18n 门禁）。但审查发现：**几乎所有项都带着 high/critical 缺陷一起落地**，两个"门禁"项只写了代码却没接进任何执行路径，多项编排核心路径无集成测试。

本计划的目标：在宣称"借鉴成功落地"之前，把以下三类问题清零——

1. **安全硬伤**：默认无密码 daemon 下，若干 handler 等于主机级文件覆写/任意 repo git 操作原语。
2. **数据安全与正确性**：snapshot 会误删用户暂存区；goal/team 取消不传播；多 agent 自续竞争。
3. **门禁形同虚设 + 未落地项**：guard/i18n 脚本从不运行；消息渲染只到 diff/CJK/检测；同会话 agent 切换未做。

**执行原则**（与 `AGENTS.md` 一致）：

- 协议改动纯加性，不删字段、不把 optional 改 required、不收窄类型；新 RPC 用 `domain/feature.operation` + `/response`，feature gate 放 `server_info.features.*` 并带 `COMPAT(name)` + 具体 added/removal 版本。
- 测试用真实端口/fake，禁 `vi.mock` 内部、禁 JSDOM/mount、禁 fixed `setTimeout` 轮询（用 `vi.waitFor` 或事件驱动）；改了 client/handler 就补 error/cancel 路径单测。
- 不在 Web 上验证桌面/移动行为；桌面验证只用 packaged Electron，移动只用真机/模拟器。
- 每完成一个 Slice 更新本文状态 + `comprehensive-improvement-roadmap.md` 对应条目。

---

## 1. 工作总览

按"阻断合并 → 安全加固 → 正确性 → 收尾与未落地"分四阶段，共 11 个 Slice。建议串行执行，Slice 间互不阻塞的可在 PR 内并行。

| 阶段      | Slice  | 标题                                                                           | 严重度        | 影响                                        | 预估 |
| --------- | ------ | ------------------------------------------------------------------------------ | ------------- | ------------------------------------------- | ---- |
| P0 阻断   | S1 ✅  | 协议 `exports` 补齐 + feature gate 真正生效                                    | critical      | 外部消费者编译/发布即坏；旧客户端被推送打破 | S    |
| P0 阻断   | S2 ✅  | snapshot `commitHash` 注入 + `cwd`/`workDir` 绑定 workspace                    | critical/high | 主机级文件覆写 + 任意 repo git 操作         | M    |
| P1 安全   | S3 ✅  | SSH 加固：host key / sshOptions 白名单 / quote / env                           | high          | MITM、本地命令执行、远程注入                | M    |
| P1 安全   | S4 ✅  | snapshot 用临时 index + try/finally                                            | high          | 误删用户暂存区、index 留脏                  | S    |
| P1 安全   | S5 ✅  | team worker 回收 + spawn 失败处理 + 队列 mutex（全局上限后续）                 | high          | 进程泄漏、孤儿 worker                       | M    |
| P2 正确性 | S6 ✅  | goal 取消传播 + 自续 guard + onGoalTurnCompleted try/catch（usedTools 后续）   | high          | 取消无效、双 stream 竞争                    | M    |
| P2 正确性 | S7 ✅  | GoalStatus 枚举 + goal leak 修复 + learn filename guard（distill cancel 后续） | high/medium   | 缺 failed/cancelled、路径穿越               | M    |
| P2 正确性 | S8 ✅  | model-catalog 大小写/回退 + Claude 1M 定价 + cost:{}→null                      | high/medium   | 静默选最贵模型、成本低估                    | S    |
| P3 收尾   | S9 ✅  | 门禁接入 CI：guard 强制 + i18n glossary 校验 + 删副本                          | critical      | 守卫从不运行、glossary 无校验、副本漂移     | M    |
| P3 收尾   | S10 ✅ | Native 消息渲染：流式节流 + math/diagram 视觉块（Web 不考虑）                  | —             | 清单高优项只到 diff/CJK/检测                | M    |
| P3 收尾   | S11 ✅ | 敏感路径批量 helper + checklist 修订 + 切换现状说明                            | —             | 切换 server 侧已支持、缺 client UI          | S    |

> 预估栏：S≈半天，M≈1-2 天，L≈3+ 天。下文每个 Slice 给出**问题 / 根因 / 方案 / 验收 / 回归风险**。

---

## P0 — 合并前阻断

### Slice S1 — 协议 `exports` 补齐 + `cindyModules` gate 真正生效

**问题**

- `packages/protocol/package.json` 的 `exports` 是显式 map（无通配），7 个新 schema 文件全部未列入：`./cindy/messages`、`./goal/rpc-schemas`、`./learn/rpc-schemas`、`./team/rpc-schemas`、`./snapshot/rpc-schemas`、`./migration/rpc-schemas`、`./project-context/rpc-schemas`。现有同类（`./loop/rpc-schemas` 等）都已导出。外部按既有模式 `import { GoalSetRequestSchema } from "@chisacode/protocol/goal/rpc-schemas"` 会 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
- `server_info.features.cindyModules` 在 `packages/protocol/src/messages.ts:281` 和 `websocket-server.ts:1093` 声明为 `true`，但 `session.ts:1196` 的 `dispatchCindyMessage` 无条件 dispatch，**且 `session.ts:585-603` 的 `migration/available` 主动推送不查 negotiated capability**。`SessionOutboundMessageSchema` 是 closed `z.discriminatedUnion`，旧客户端用同 schema parse 会在 `migration/available` 上 throw——违反 AGENTS.md "OLD clients must still parse new messages"。
- 两处 `COMPAT(cindyModules)` 注释用占位符 `v0.1.X`，无具体 added/removal 版本（sibling `generativeUi` 用的是 `v0.1.101` + 日期）。

**根因**：exports 漏加是疏忽；gate 只声明不强制 + 主动推送无门控，是把"特性已就绪"误当"特性已协商"。

**方案**

1. 在 `packages/protocol/package.json` `exports` 补 7 条，指向 `./dist/<path>.{d.ts,js}`，shape 对齐 `./loop/rpc-schemas`。
2. `dispatchCindyMessage` 入口查 negotiated `cindyModules` capability，未协商时对 inbound 返回 `rpc_error{code:"unsupported_feature"}`。
3. `migration/available` 推送前查 capability，未开启则不发——这是最关键的一条，因为它主动打破旧客户端。
4. 把两处 `v0.1.X` 替换为实际发布版本 + 具体移除日期（例：`added in v0.1.103; remove no earlier than 2027-07-29 when client/daemon floor >= v0.1.103`）。
5. 客户端侧文档化：对未知 outbound discriminator 容错（ignore），作为 defense-in-depth。

**验收**

- `npm run build:client` 后，外部 consumer `import { GoalSetRequestSchema } from "@chisacode/protocol/goal/rpc-schemas"` 成功。
- 新增单测：模拟旧客户端（`cindyModules` 缺省）→ 发 `goal/set` 收 `rpc_error`；服务端 provider-config 变更不向其推 `migration/available`。
- `npm run typecheck` + `npm run lint` 绿。

**回归风险**：低。gate 强制只影响未协商客户端，已协商路径行为不变。

---

### Slice S2 — snapshot `commitHash` 注入 + `cwd`/`workDir` 绑定 workspace

**问题**

- `packages/server/src/server/session-handlers/snapshot-handler.ts:103-116` + `git-snapshot.ts:229-235`：`rewindToSnapshot` 把客户端可控 `commitHash` 传给 `git log -1 --format=%B <commitHash>`。`SnapshotRewindRequestSchema.commitHash` 仅 `z.string().trim().min(1)`，无 hex 校验。`--output=<path>` 是合法 git 选项，`commitHash: "--output=/home/user/.bashrc"` 会把日志写到该路径**覆写文件**，且 XDT trailer 检查在 `git log` 执行**之后**才跑。
- snapshot/migration/project-context 三个 handler 都直接用客户端 `cwd`/`workDir`（仅 `min(1)`），跑 git 操作或写 `AGENTS.md`/`CLAUDE.md`。daemon 默认无密码（`websocket-server.ts:627-629`），任何 allowed origin 连接都能在任意目录跑 git / 任意目录建 `AGENTS.md`。Session 已有 `findWorkspaceByDirectory`/`resolveRegisteredWorkspaceIdForCwd`，这些 handler 绕过了。

**根因**：把"连接已认证"等同于"任意路径已授权"；schema 只校验语法不校验语义。

**方案**

1. `packages/protocol/src/snapshot/rpc-schemas.ts`：`commitHash` 改 `z.string().trim().regex(/^[0-9a-f]{40,64}$/i)`。`git-snapshot.ts:rewindToSnapshot` 入口再做一次同样校验（防御纵深），拒绝含 `=` 或以 `-` 开头的值。
2. 在 `session.ts` 的 `dispatchCindyMessage` 前加一个共享守卫：把所有带 `cwd`/`workDir` 的 Cindy 请求解析到已注册 workspace，未注册回 `rpc_error{code:"workspace_not_found"}`。复用 `dispatchWorkspaceAndProjectMessage` 用的 workspace-authority 检查，不要在单个 handler 里各写一遍。
3. project-context 的 `workDir` 同样走守卫。
4. `rewindToSnapshot` 的 `git log`/`git checkout` 调用前 assert `commitHash` 已过 hex 校验。

**验收**

- 新单测：`commitHash="--output=/tmp/x"` 被拒；`commitHash` 非 40/64 hex 被拒；合法 SHA 通过。
- 新单测：未注册 `cwd` 的 `snapshot/create` 收 `workspace_not_found`；注册 `cwd` 通过。
- 不引入新 required 字段、不收窄既有字段（commitHash 仍是 string，只加 regex）。

**回归风险**：中。守卫会拒绝以前能跑的"任意 cwd"调用——但那是漏洞行为，拒绝是预期。需确认没有合法用例依赖在非注册目录跑 snapshot（应无）。

---

## P1 — 安全加固

### Slice S3 — SSH 加固：host key / sshOptions 白名单 / quote / env

**问题（文件：`packages/server/src/server/ssh-transport.ts`）**

1. `buildSSHArgs`（:60/:120）不设 `StrictHostKeyChecking`/`UserKnownHostsFile`，继承用户 ssh_config，可被 `no` 化 → MITM NDJSON ACP 通道。测试甚至断言 `StrictHostKeyChecking=no` 被**接受**（`ssh-transport.test.ts:62-67`）。
2. `config.sshOptions: string[]`（:104-110）原样 `push("-o", opt)` 无 allowlist。`PKCS11Provider=/path/evil.so` 加载原生库，`ProxyCommand` 连接时执行任意本地命令，`ControlMaster`/`ControlPath` 可被劫持。
3. `shellQuote`（:148-156）POSIX-only：`^[a-zA-Z0-9._/-]+$` 直接返回，`-rf /` 这类以 `-` 开头的值被当选项；单引号包裹未处理换行，含换行的 env 值在 `&&` 链中注入远程命令；Windows 远端 `cmd.exe` 单引号转义完全错误。
4. `createSSHSpawner`（:142-145）注释写 "Don't inherit local env"，代码却 `env: {...process.env}`，把 daemon 的 `OPENAI_API_KEY`/`GITHUB_TOKEN`/daemon 密码塞进 ssh 子进程 env，本机 `/proc/<pid>/environ` 可读。

**根因**：把 SSH 当成"普通 spawn"，忽略它是能把本地命令执行和原生库加载进客户端的特权通道。

**方案**

1. 默认 `StrictHostKeyChecking=accept-new` + 显式 `UserKnownHostsFile`；维护安全选项白名单（`BatchMode`/`ConnectTimeout`/`ServerAlive*` 等），拒绝 `ProxyCommand`/`RemoteCommand`/`PKCS11Provider`/`ControlMaster`/`ControlPath`/`LocalCommand`/`PermitLocalCommand`/`IdentityAgent`。更新测试断言 `StrictHostKeyChecking=no` 被**拒绝**。
2. `shellQuote`：以 `-` 开头的值强制加引号；拒绝含换行/NUL 的 env 值；`cd` 前加 `--`；对 Windows 目标检测并改用 `cmd` 转义，或避免 `cd && export && cmd` 链，改用 ssh 单 argv exec + `SendEnv`/`SetEnv` + `RemoteCommand`。
3. `createSSHSpawner` 传最小 env：`{ PATH, HOME, LANG }` + 仅需的 remote env，不再 spread `process.env`。删除矛盾注释。
4. `identityFile` 校验路径不越出允许的 key 目录，拒绝含 shell 元字符或以 `-` 开头的值。

**验收**

- 新单测：`sshOptions` 含 `PKCS11Provider`/`ProxyCommand` 被拒；env 值含 `\n` 被拒；`-` 前缀值被引号包裹；`process.env` 不出现在子进程 env（用 fake spawn 捕获 env）。
- 真实 SSH 端到端属 `*.real.e2e.test.ts`，需凭证，不在本 Slice 必须项。

**回归风险**：中。收紧 `sshOptions` 可能让某些现有 provider 配置失效——需在 release notes 说明并给迁移路径（白名单内的选项不受影响）。

---

### Slice S4 — snapshot 用临时 index + try/finally

**问题（`packages/server/src/server/git-snapshot.ts:131-141`）**

`createSnapshot` 在用户**真实** index 上 `git add -- <files>` → `write-tree` → `commit-tree` → `git reset HEAD --`。问题：

- `reset HEAD --` 无 pathspec，**全量清空用户所有已暂存改动**，非只撤销 snapshot 的 add——数据丢失。
- `add` 与 `reset` 之间崩溃（node 被 kill / 30s 超时 SIGKILL）→ reset 不跑，index 留脏。无 try/finally。
- `pLimit(8)` 下并发 snapshot / 用户并发的 `git add`/`commit` 争用同一 index 文件。

**方案**

1. 用临时 index：`runGitCommand([...], { cwd, envOverlay: { GIT_INDEX_FILE: <tmp> } })`，让 `add`/`write-tree` 在 tmp index 上跑，用户真实 index 不被动。
2. 任何 index 变更包在 try/finally 里，finally 恢复原始 index 状态并删 tmp。
3. 若必须 reset，带 pathspec 只 reset 本次 add 的文件。
4. per-`cwd` 串行化 snapshot（promise chain 或 mutex），杜绝并发 index 争用——这也修 S6/S7 里 `snapshotOnTurn` 的并发问题。

**验收**

- 新单测：snapshot 前用户 `git add` 一个文件 → snapshot 后该文件仍 staged（不被清空）。
- 新单测：snapshot 中途抛错（mock `write-tree` 失败）→ 用户 index 不留脏、tmp 被删。
- 新单测：并发两次 snapshot 同一 cwd → 串行执行，无 index 冲突。

**回归风险**：低。语义从"碰用户 index"变成"用私有 index"，对合法 snapshot 行为是纯增强。

---

### Slice S5 — team worker 全局上限 + 结束回收 + spawn 失败处理

**问题**

- `team-handler.ts:188-216`：`spawnWorker` 抛错时只 log，`agentId` 仍 null，`addWorker` 用 `randomUUID()` 伪造 `sessionId`，response 返回 `error: null`。该 worker 永无 agent 接管，队列消息永久堆积，UI 显示 idle 实则死。
- `team-handler.ts:165-180` + `session.ts:1108-1115`：`DEFAULT_WORKER_LIMITS.hardLimit=10` 仅限单 team；N 个 lead session 可起 N×10 worker。`endActiveTeam`/`archiveWorker` 只改状态字段，从不 `closeAgent`/`cancelAgentRun`，worker 子进程（Claude/Codex CLI）存活到 daemon 退出，Windows 上泄漏句柄/端口。
- `team-handler.ts:88-103`：`flushQueue` 的 `consumeMessage` 重赋数组，并发 `enqueueMessage` push 到旧引用被丢弃 → 消息静默丢失（`teamQueueFlushInProgress` 只防重入 drain，不防 enqueue-vs-drain）。
- `session.ts:1086-1095` + `team-handler.ts:233-258`：`drainTeamWorkerQueue` 在 `idle` 转换时触发，可与直接 `sendToAgent` 双投递，runControl replace 丢消息。

**方案**

1. `spawnWorker` 失败时回 `rpc_error`（或 response 带 `error`），**不 add worker**；或置 `status:"error"` 并暴露 spawn 错误。绝不生成假 sessionId。
2. agent-manager 加全局 worker/agent 上限（共享 registry），`spawnWorker` 前检查。
3. `TeamManager.endActiveTeam` 和 `archiveWorker` 调 `terminateWorker(agentId)`（在 session.ts 接到 `agentManager.closeAgent`/`cancelAgentRun`）；session dispose 时 reap 该 session 所有 worker。
4. per-worker mutex 串行化所有队列变更（enqueue + drain 同一把锁）；drain 进行中时 `sendToAgent` 改入队而非直接投递。

**验收**

- 新单测：mock `spawnWorker` 抛错 → response 含 error、无 worker 记录、无假 sessionId。
- 新单测：超过全局上限 → 拒绝创建。
- 新单测：`endActiveTeam` 后对应 worker agent 被 `closeAgent`（fake agent-manager 记录调用）。
- 新单测：并发 enqueue + drain → 无消息丢失（计数守恒）。

**回归风险**：中。全局上限可能让多 team 场景配额变紧——设上限值要基于实际负载测算，默认保守（如 32）。

---

## P2 — 正确性

### Slice S6 — goal 取消传播 + 自续竞争 + judge 可取消

**问题（`packages/server/src/server/agent/agent-manager.ts`）**

1. `cancelGoal`（:1079-1133）只把 `status` 改 `paused`，不调 `runControl.cancel`/`cancelAgentRun`。正在跑的 continuation turn 跑完才停；`judgeTurn` 仍可能触发下一轮。`evaluateGoalContinuation` 仅入口检查 status。
2. `evaluateGoalContinuation`（:1106-1130）调 `foregroundExecution.stream` 前不检查 `pendingReplacement`/已有 foreground run。judge `await` 与 stream 之间窗口里用户可发 run → 两条并发 stream 交错，`currentTurnToolCallCount` 互相 reset，timeline 顺序错乱。
3. completion judge 用 `generateStructuredAgentResponseWithFallback` 跑独立 LLM 调用，promise 不被 `backgroundTasks` 跟踪，取消 goal 时 judge 仍跑完耗 token。
4. `agent-timeline-event-controller.ts:58-60` vs `agent-turn-event-controller.ts:172`：`tool_call` timeline 事件在 `turn_started` 之前到达时，计数器在旧 turn 自增后被 reset 为 0，`onGoalTurnCompleted` 的 `usedTools` 误为 false，连续 5 turn（默认 `noProgressLimit`）后 goal 被误暂停。

**方案**

1. `cancelGoal` 同时 `cancelAgentRun(agentId)`；`evaluateGoalContinuation` 在 stream 调用前双检查 `goal.status === "active" && lifecycle === "idle" && !pendingReplacement && !foregroundRuns.has(id)`。
2. 把 continuation turn 走 `runControl.replace`/queue 同一通道，复用已有串行化，而不是裸调 `stream`。
3. judge 调用纳入 `backgroundTasks` 并 race 取消信号；取消时短路返回。
4. `usedTools` 改从 timeline 按 `turnId` 查询 `tool_call` 项，不再跨 controller 互改可变计数器。
5. `onGoalTurnCompleted` 调用包 try/catch，judge 抛错不阻塞 lifecycle→idle 转换。

**验收**

- 新集成测试：goal 跑中 `goal/cancel` → 在飞 turn 被中止（fake runControl 记录 cancel 调用）、judge 被取消、无下一轮 turn。
- 新集成测试：goal 自续中用户发 chat → 两条 stream 不并发（assert 串行化）。
- 新单测：`tool_call` 事件早于 `turn_started` → 该 turn `usedTools` 仍为 true。
- `GoalStatus` 加 `failed`/`cancelled`（见 S7），`cancelGoal` 用 `cancelled` 终态。

**回归风险**：中。改 continuation 走 runControl 可能改变 turn 调度时序——需对比单 agent goal 跑完的 turn 数与旧行为一致。

---

### Slice S7 — goal/team/learn 编排路径集成测试 + 状态枚举补全

**问题**

1. **零 handler 级测试**：diff 里只有 service 级 `.test.ts`（goal-service/team-service/learn-service/project-context），handler（`goal-handler.ts`/`team-handler.ts`/`learn-handler.ts`/`project-context-handler.ts`）一个测试都没有。被吞错误和竞争逻辑都在 handler 层。
2. **自续循环零集成测试**：`evaluateGoalContinuation` 的 turn→continuation→turn 循环是最高风险新行为，无测试验证 `maxTurns`/`noProgress`/`budgetTokens`/`signalledComplete` 真的能停。
3. `GoalStatus`（`goal/rpc-schemas.ts:5-11`）缺 `failed`/`cancelled`，agent 崩溃/取消无合法字面量，UI switch 无 failure 分支。
4. learn distillation 是 fire-and-forget，`cancelRun` 不中止 agent；distill agent 跑完不 `closeAgent`，留在 agent manager 当残留。
5. learn proposal `filename`（`learn/rpc-schemas.ts`）是 `z.string()` 无校验，`deriveSkillName("..md")` → `".."` → `path.join(stagingDir, "..")` 逃出 staging（`writeProposalsToSkillRoots` 在 install 前无 `validSkillName` 拦截）。

**方案**

1. 加 `goal-handler.test.ts`/`team-handler.test.ts`/`learn-handler.test.ts`/`project-context-handler.test.ts`，覆盖：spawn 失败、cancel 传播、队列并发、distill cancel、proposal filename 校验。
2. 加 `agent-manager.goal-continuation.test.ts`：用 fake foregroundExecution 验证自续循环在 `maxTurns`/`noProgress`/`budgetTokens`/`signalledComplete`/cancel 各条件下正确终止。
3. `GoalStatusSchema` 加 `"failed"`、`"cancelled"`（加性，安全）。server 代码用 `cancelled` 表达用户取消、`failed` 表达 agent 崩溃。client UI switch 补对应分支。
4. `learn-handler.ts:cancelRun` 记录 distill agent id，cancel 时 `cancelAgentRun`/`closeAgent`；distill 结束后 `closeAgent` 临时 agent。
5. `LearnProposalSchema.filename` 收紧为 `/^[a-z0-9_-]+(\.md)?$/i`；`deriveSkillName` 输出过 `validSkillName`，拒绝 `..`/`/`/`\`/控制字符。

**验收**

- 新测试文件全部绿；`npx vitest run <path> --bail=1` 逐个跑过。
- `GoalStatus` 新枚举值在 protocol typecheck 通过；server/client 对新值的 switch 分支覆盖。
- `filename: "..md"` 被 schema 拒；`deriveSkillName` 对 `..` 抛错。

**回归风险**：低。加性枚举 + 新测试，不改既有行为。distill closeAgent 是新增清理，不影响正常蒸馏流程。

---

### Slice S8 — model-catalog 大小写/回退 + Claude 1M 定价

**问题**

1. `model-catalog.ts:43-60`：`findCatalogModel` 用 `m.id === modelId` 严格比，大小写敏感；`defaultModelForProvider` 无 `isDefault` 时返回 `providerModels[0]`（合并顺序非确定）。`find(...) ?? default...` 模式下 miss 静默选首个，可能是最贵 Opus 1M = 成本尖峰。
2. `providers/claude/models.ts:30-32`：`OPUS_COST`/`SONNET_COST` 同时用于 `claude-opus-4-8[1m]`（1M）和 200K 版本。真实 1M 上下文有 2x+ 溢价，`estimateTurnCost` 低估约 50-60%。无定价来源注释。
3. `model-catalog.ts:estimateTurnCost` 对 `cost:{}` 返回 0 而非 null（显示 $0.00 而非"未知"）。
4. `model-catalog.test.ts` 缺大小写、`cost:{}`→null、silent-default-fallback 风险测试，且把危险行为 assert 为正确。

**方案**

1. 建 `(provider, id.toLowerCase())` 归一化索引；`defaultModelForProvider` 无 `isDefault` 时返回 `undefined`，强制调用方显式处理 miss（不静默回退）。
2. 拆 `OPUS_1M_COST`/`SONNET_1M_COST`，注释 Anthropic 定价来源 URL/日期；加测试断言 1M≠200K。
3. `estimateTurnCost`：`cost` 无任何数值字段时返回 `null`。
4. 补 model-catalog 边缘单测：大小写 mismatch、`cost:{}`→null、无 `isDefault` 时 `defaultModelForProvider`→`undefined`。

**验收**

- 新单测绿；既有 happy-path 测试不破。
- 调用 `findCatalogModel` 的地方审计：所有 `?? default...` 改成显式处理 undefined（typecheck 强制）。

**回归风险**：中。`defaultModelForProvider` 返回 undefined 会让以前静默回退的调用点编译失败——这正是想要的，逼调用方决策。

---

## P3 — 收尾与未落地

### Slice S9 — 门禁接入 CI：guard + i18n glossary 对齐

**问题**

1. `scripts/guard.test.ts` 是真断言（非 tautology），但**从未接入 CI/release/lefthook**。根 `test` 脚本是 `npm run test --workspaces --if-present`（只跑各 workspace 自己的 test），`ci.yml` 也不调 `test:guard`。守卫永远绿因为从不跑。
2. `scripts/check-i18n-glossary.mjs` 同样未接入任何执行路径，且**对 HEAD 红 81 处**：`智能体`×65、`提供商`×11、`对话`×5。glossary 要求 `Agent`/`供应商`/`会话`，与已 shipped 的 zh-CN 字符串冲突。
3. i18n checker 用 `value.includes(banned)` 子串匹配，`对话` 被 forbidden（要求 `会话`），但 `新对话`/`对话框` 是合法"conversation/dialog"翻译 → 误报。
4. glossary 加载无 schema 校验（`ajv` 在依赖里却没用）；`glossary.schema.json` 无 `additionalProperties:false`，`forbidden` 数组无 `minLength`/`uniqueItems`（空字符串项会让所有 zh 值命中）。
5. `guard.test.ts:113-129` 的 `KNOWN_VIOLATIONS` 可静默扩容，无 `expect(size).toBe(N)` 锁定；`extractImports` 漏 bare `import "x"`、模板字面量动态 import、带注释动态 import → 层级违规可绕过。
6. `.claude/skills/release-{beta,stable}/SKILL.md` 是 `.agents/skills/` 同名文件的逐字节副本，无同步机制，必然漂移 + precedence 混乱。

**方案**

1. **先对齐 i18n**（否则接入即红）：决定每条 term 是改字符串还是改 forbidden。建议：`对话` 从 `session` 的 forbidden 移除（它是合法 conversation 词），或把 session 检查限定在 key path 含 `session` 的字符串。`智能体`/`提供商` 按 glossary 改齐 81 处，或把 glossary 改成与现有翻译一致。这是产品决策，需 owner 拍板。
2. 接入 CI：`ci.yml` 加 `npm run test:guard` 和 `npm run check:i18n-glossary` 两个 step；`release:check` 也加。
3. checker 加载 glossary 用 `ajv` 校验 schema；schema 加 `additionalProperties:false`、`forbidden` items `minLength:1` + `uniqueItems:true`。
4. `guard.test.ts` 加 `expect(KNOWN_VIOLATIONS.size).toBe(<当前数>)` 锁定，扩容即 fail；`extractImports` 补 bare `import "x"` 和模板字面量动态 import 的 regex（或改用 `oxc-parser` 已在依赖树里）。
5. 删除 `.claude/skills/release-{beta,stable}/SKILL.md`，保留 `.agents/skills/` 单一真源。

**验收**

- `npm run check:i18n-glossary` 对 HEAD 退出码 0。
- `npm run test:guard` 在 CI 里跑且绿。
- `ajv` 校验失败时 checker 退出码 2。
- `git ls-tree` 确认 `.claude/skills/release-*` 已删。

**回归风险**：低-中。改 81 处 i18n 字符串需 QA 回归中文 UI；guard 接入可能暴露既有层级违规（先跑一次 report 摸底）。

**未决项**：i18n term 对齐方向需产品 owner 决策（见方案 1）。建议先用 `check:i18n-glossary:report`（退出 0）产出全量违规清单，再逐条决策。

---

### Slice S10 — 消息渲染补全：KaTeX / mermaid / 流式节流（清单高优 #5 未竟）

**背景**：`cindy-borrow-checklist.md` #5 高优项，目标"Cindy 的 react-markdown + 7 remark + 4 rehype 插件（KaTeX/mermaid/diff/CJK URL/路径 chip）+ 流式节流 100ms"。当前只落地了 diff 块 + CJK URL 截断 + inline math **检测**（`packages/app/src/utils/markdown-utils.ts` 接入 `renderer.tsx`/`highlighted-code-block.tsx`）。**未落地**：KaTeX 公式渲染、mermaid、remark/rehype 插件体系、流式节流。清单说"移动端优先补公式和代码块"——只到代码块，公式没到。

**现状评估**：RN 端受限大（清单原话），Web 端迁移 react-markdown 体系是中复杂度，RN 是高复杂度。这是 6 个高优里唯一"部分落地"的，剩余工程量大。

**方案（分两步）**

1. **Web 端**（中）：引入 `react-markdown` + `remark-math` + `rehype-katex` + `remark-mermaid`（或 `mermaid` 直接渲染），在 `.web.tsx` 变体实现，替换现有 web markdown renderer。流式节流 100ms 用 `useDeferredValue` 或自定义 throttle。
2. **Native 端**（高）：优先补公式渲染——用 `react-native-math-view` 或 WebView 渲染 KaTeX；mermaid 暂缓（RN 无良好原生支持）。代码块已在。

**验收**

- Web：含 `$E=mc^2$` 和 ` ```mermaid ` 的消息正确渲染。
- Native：公式渲染在真机/模拟器验证（不用 Web 代替）。
- 性能：流式输出下主线程不卡（100ms 节流生效）。

**回归风险**：高。替换 web renderer 是大改，需全量 markdown 回归。建议单独 PR，不和 P0-P2 同批。

**注**：本 Slice 工程量 L，不阻断 Cindy 合并，但应在合并后尽快排期，否则清单高优项长期"半落地"。

---

### Slice S11 — 同会话 agent 切换 + 其余中低优收尾（清单 #8 + 观察 #14/#17）

**问题/未落地**

1. **同会话 agent 切换**（清单 #8）：配置迁移已做（`config-migration.ts`），但"session 加个 providerId 可变字段"的同会话切换未见对应改动。清单评"低复杂度"。
2. **IM/Webhook 触发**（观察 #14）：清单说"与 Goal 配合价值极高"，daemon 架构天然适合（webhook → daemon HTTP → 创建 session → 派活）。本轮未动。
3. **敏感路径检测的其余接入点**（观察 #17）：`sensitive-path.ts` 已落地并用于 git-snapshot 过滤，但清单建议的另两个用途——agent 文件下载拦截、worktree 归档警告——未见接入。
4. **`cindy-borrow-checklist.md` 自身**：是评估散文而非可执行 checklist；引用 Cindy 仓库路径无 commit 锁定；#6 自动 commit 未强制先做 #17 敏感路径过滤。

**方案**

1. 同会话 agent 切换：session 记录加可变 `providerId`，加 `session/switch-agent` RPC（加性），切换时优雅终止当前 turn、保留 history、用新 provider 重启。
2. IM/Webhook：作为 Goal 系统的触发源，加 daemon HTTP endpoint（`POST /webhook/trigger`）→ 创建/复用 session → `goal/set`。需鉴权（HMAC 签名）。本项可单独立项，本文只登记。
3. 敏感路径接入：在 agent 文件下载路径和 worktree 归档路径调 `detectSensitivePath`，命中则拦截 + 警告。
4. 修 `cindy-borrow-checklist.md`：#6 加前置依赖"必须先实现 #17 并在 snapshot 前过滤"；引用 Cindy 文件加 commit hash；重命名为 `cindy-borrow-evaluation.md` 或补真 checklist 节。

**验收**

- 同会话切换：切换后 history 保留、新 provider turn 正常（packaged Electron 验证）。
- 敏感路径：下载 `.env` 被拦截、归档含 `.ssh/id_rsa` 的 worktree 有警告。
- checklist 文档修订生效。

**回归风险**：中。同会话切换触及 session 生命周期核心，需配套测试。

---

## 2. 优先级与排期建议

```
合并前阻断（P0）：S1 → S2            （建议 1-2 个 PR，合入前完成）
安全加固   （P1）：S3, S4, S5 并行    （合入后立即跟进，3 个独立 PR）
正确性     （P2）：S6 → S7 → S8      （S6 改 agent-manager 风险最高，单独 PR；S7/S8 可并行）
收尾       （P3）：S9 尽早（门禁不接 CI 等于没修）；S10/S11 按产品节奏排期
```

**最少必修**（即使时间紧也要做的）：S1、S2、S4、S9。这四条覆盖"外部消费者能用 + 默认 daemon 不被注入 + 用户暂存区不丢 + 门禁真正运行"。其余按优先级推进。

---

## 3. 测试策略（统一）

- **单测**：每个 Slice 的验收项写成 Vitest 单测，用真实 tmp 仓库/临时目录/fake agent-manager，禁 `vi.mock` 内部、禁 fixed `setTimeout`（用 `vi.waitFor` 或事件驱动）。
- **集成测试**：goal 自续、team 取消、learn distill cancel 这类编排行为用 fake foregroundExecution/agent spawner，验证状态机终止和资源回收。
- **handler 级测试**：S7 补齐四个 handler 的测试文件，覆盖被吞错误和竞争路径。
- **client 单测**：S1/S2 改了 protocol/dispatch，补 `daemon-client-cindy-commands.test.ts`（error/cancel 契约）；其余 25 个新公开方法的 error/reject 路径分批补。
- **不上 Web 代替桌面/移动**：S10/S11 的 UI 验证用 packaged Electron / 真机或模拟器。
- **真实 SSH/i18n 全量回归**属 `*.real.e2e.test.ts` 或手动，不在本计划自动测试范围。
- **CI 接入**：S9 完成后，`test:guard` 和 `check:i18n-glossary` 成为常驻 CI step。

---

## 4. 协议与兼容性清单

本计划对协议的所有改动遵循 AGENTS.md：

- `GoalStatus` 加 `failed`/`cancelled` —— **加性枚举**，安全。
- `LearnProposalSchema.filename` 加 regex —— 收窄 accepted 值，但 `filename` 是新字段（未 shipped），无兼容性负担。若有已发出的 proposal 带非法字符，需在 schema 层加 transform 而非 reject（评估后定）。
- `commitHash` 加 hex regex —— 收窄 string，但该字段当前无合法非 hex 用途，且修的是注入漏洞。如担心旧 client 发非 hex，可在 schema 层先 transform 拒绝，handler 层防御纵深。
- 不新增 required 字段、不删字段、不改 optional→required。
- 新 RPC（如 `session/switch-agent`）用 `domain/feature.operation` + `/response`，加 `server_info.features.*` gate + `COMPAT` 注释带具体版本。
- S1 完成后，所有新 feature 都经 `cindyModules`（或新 gate）协商，主动推送只发给已协商客户端。

---

## 5. 路线图登记

完成各 Slice 后更新 `comprehensive-improvement-roadmap.md`：

- 新增条目"Cindy 集成硬化与收尾"（链接本文）。
- 各 Slice 完成时在本文对应小节加"状态：完成"注释 + PR 链接。
- S9 完成后，i18n/guard 门禁进入路线图的"常驻 CI 门禁"小节。
- S10/S11 若延后，登记为"已规划未启动"。

---

## 6. 风险登记

| 风险                                            | 缓解                                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| S2/S3 收紧让现有 provider 配置失效              | release notes 给迁移路径；`sshOptions` 白名单内的选项不受影响 |
| S6 改 continuation 走 runControl 改变 turn 时序 | 集成测试对比单 agent goal 的 turn 数与旧行为                  |
| S9 改 81 处 i18n 字符串影响中文 UI              | QA 回归中文界面；先用 `:report` 产全量清单逐条决策            |
| S10 替换 web renderer                           | 单独 PR，全量 markdown 回归，不和 P0-P2 同批                  |
| 合并时机：修在合入前 vs 合入后                  | P0 必须合入前完成；P1/P2 可合入后立即跟进但同一发布周期内     |
| `KNOWN_VIOLATIONS` 扩容失去意义                 | S9 加 `expect(size).toBe(N)` 锁定                             |

---

## 7. 未在本计划范围

- Cindy 的插件/扩展系统（清单 #12，已降为观察）、浏览器控制（#13）、SkillHub（#15）、全文搜索（#16）—— 清单已判定不借鉴或观察，本计划不涉及。如未来启动，另立项。
- Cindy 的 SQLite/Drizzle 持久化、DCO 签名、协议翻译桥 —— 清单"明确不借鉴"，不涉及。
- `agent-manager.goals` 在 `deleteAgent` 时未清理导致的 goal 内存泄漏（审查 high）——并入 S6 一起修（`deleteAgent` 回调加 `this.goals.delete(agentId)`）。

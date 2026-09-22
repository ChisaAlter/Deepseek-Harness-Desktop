# Production Hardening Current State

更新时间：2026-08-10

适用对象：负责升级、发布、故障处理和安全审计的 ChisaCode 工程师

这份文档描述当前代码和当前工作区的真实边界。它不是“计划已完成”的声明，也不把历史证据快照当作当前实现。安全背景见 [SECURITY.md](../../SECURITY.md)，Relay 威胁模型见 [Relay Auth Handshake v2 Threat Model](relay-auth-handshake-v2-threat-model.md)。

## 1. 状态摘要

- 加固分支为 `codex/production-hardening-2026-08-10`，对应 PR #32；审查、CI 和发布判断必须以 PR 当前 head 的精确 SHA 为准。
- 本批 follow-up 同时包含归档写入 quiescing、Relay 认证通道绑定、三端设备 secret 存储及配套文档，不能拆开引用旧 PR SHA 作为验证依据。
- `cn-main` 工作区的 Model Gateway 在途改动与本工作区隔离，不能混入本批提交。
- 本地静态门禁已通过：Relay producer build、client/server/app/desktop typecheck、改动文件 targeted lint、format 和 diff 检查。
- 按用户要求，本阶段停止过度测试：没有继续扩展测试矩阵，也没有重复运行已通过用例。新增 Relay/storage 行为尚未做真实设备或运行时兼容矩阵验证。

因此当前结论是：**代码与安全文档已在加固分支对齐，但不能标记为生产发布批准，也不能把旧 PR SHA 的 CI 状态当作本批 follow-up 的验证。**

## 2. 已落地能力

| 领域                 | 当前行为                                                                                                                           | 安全结果                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Worktree 归档        | 所有破坏性入口共享 canonical-root mutation coordinator；先 quiesce、停止并等待受管写入、重算 Git 状态，再 teardown 和非 force 删除 | 外部写入、未知残留、Git 不确定状态都 fail closed，现场保留可恢复 |
| Setup 失败清理       | 已知生成物可安全清理；未知输出进入 `setup_failed_recovery`                                                                         | 不会把安装失败产生的用户输出当作普通归档数据删除                 |
| Git snapshot         | 未跟踪内容按 leaf 检查敏感路径；临时 index 从 HEAD 建立完整基线；unborn 仓库有明确分支                                             | 敏感 leaf 不进入 snapshot，既有 index 不被污染                   |
| Relay E2EE           | daemon 为每个 E2EE channel 生成随机 challenge；认证证明绑定真实 client ephemeral public key                                        | Relay 不能替换 client key 后复用 token/proof                     |
| Relay 默认策略       | 新 daemon 默认要求设备认证；匿名 legacy 只由本机显式 recovery 环境变量开启                                                         | 兼容性不会默默降级为匿名授权                                     |
| Relay session resume | Relay 已认证连接记录 `authenticatedDeviceId`；已认证 session 不能由另一个设备身份恢复；direct/local 保持原有网络可达信任           | client 自选 `clientId` 不再单独构成 Relay 恢复凭据               |
| WebSocket            | 语义 lane 使用有界 keyed FIFO；ping、取消、权限响应等 preempt/concurrent 消息不被长 RPC 阻塞                                       | 顺序敏感链路确定性排序，队列不会无限增长                         |
| 文件传输             | server 按 1 MiB chunk 流式发送；client binary 请求使用 15 分钟上限与 60 秒 idle timeout                                            | 慢速合法传输不再受 10 秒普通 RPC 上限限制                        |
| Terminal 重连        | 保存 stream subscription intent，连接恢复后重放；退出或取消会清理 intent                                                           | 重连后终端流不会静默停流或重复复活                               |
| 凭据存储             | registry 只保留 device id；secret 进入平台存储                                                                                     | 普通 host JSON/export/日志不再承载 Relay secret                  |

## 3. Relay 认证契约

### 3.1 连接顺序

1. Client 发送明文 `e2ee_hello`，只包含本次连接的 ephemeral public key。
2. Daemon 完成 ECDH，并在明文 `e2ee_ready` 中返回本连接随机 challenge。
3. 后续 hello 在加密 channel 内携带 pairing token，或携带 device id、challenge、真实 client public key 和 HMAC proof。
4. Daemon 将 hello 中的 key/challenge 与 channel handshake metadata 精确比较，然后才消费 pairing token 或验证 HMAC。
5. 认证失败在 session handler 之前关闭连接；不会创建或恢复已授权 session。

Relay 能看到握手帧、server id、连接 id、时间、大小和频率，但看不到加密 hello 中的 token/proof，也不能从 challenge 得到 device secret。

带未过期 pairing token 的新 offer 是一次性设备注册凭据：拿到该链接的人可以抢先注册一个设备。必须像密码一样保护配对链接；channel binding 防止不可信 Relay 从转发流量中窃取/换绑 token，但不修复用户主动泄露 offer 的问题。

### 3.2 兼容矩阵

| Client            | Daemon                 | 结果                                                                       |
| ----------------- | ---------------------- | -------------------------------------------------------------------------- |
| 新                | 旧                     | 旧 daemon 不发送 challenge；新 client 省略设备认证字段，保持旧 legacy 行为 |
| 旧                | 新                     | 默认拒绝，返回设备认证需要升级/重配的 close reason                         |
| 新、首次配对      | 新                     | 使用一次性 pairing token，daemon 签发 per-device secret                    |
| 新、已配对        | 新                     | 使用 daemon challenge + channel-bound HMAC proof                           |
| Legacy offer-only | 新 + recovery override | 仅允许缺少认证的 legacy hello；不把不完整或错误 device claim 标记为已认证  |
| direct/local      | 任意                   | 不经过 Relay 设备认证门，保持原有网络可达信任                              |

Recovery override：

```text
CHISACODE_RELAY_ALLOW_UNAUTHENTICATED_RECOVERY=1
```

启动时必须输出高等级安全告警。该开关是临时迁移逃生舱，计划删除日期为 2026-11-10；开启期间不能声称 Relay P0 风险已关闭。

## 4. 设备 secret 生命周期

- Android/iOS：Expo SecureStore，使用系统 Keystore/Keychain，并使用首次解锁后可访问的设备级可用性策略。
- Electron：renderer 只保存 `safeStorage` 密文；加解密在受 sender 校验保护的 privileged IPC 中完成。Linux `basic_text` 或尚未就绪的 backend 直接拒绝，不回退到明文。
- Web：仅 session memory。页面刷新后 registry 仍保留 device id，但没有 secret，用户需要重新配对。
- 迁移：读取旧 registry 时，若发现历史明文 secret，当前会话先迁移到平台 store，随后写回剥离 secret 的 registry。平台 store 失败时保留当前内存连接，但不再把 secret 写回普通存储，并记录无 secret 内容的错误。
- 清理：清除 Relay 凭据、删除 host 或删除 Relay connection 时，先删除平台 secret，成功后才删除普通 host 元数据；删除失败会阻止元数据删除，避免留下孤立凭据。

## 5. 归档状态机

普通归档的安全主路径为：

```text
active -> quiescing -> deleting -> archived
```

- `quiescing`：拒绝新的 agent/terminal/workspace write，等待已经取得 write lease 的操作退出。
- `deleting`：重新检查 tracked、untracked、ignored leaf、HEAD、branch、upstream 和归属；只清理明确 allowlist 生成物。
- 删除只使用非 force `git worktree remove`。非 force 失败、未知残留、teardown 失败或路径归属变化都保留 worktree。
- 文件系统删除已成功但 finalize 元数据失败时进入 `delete_complete_pending_finalize`，继续阻止写入，不能伪装成 active。
- setup 失败的未知输出进入 `setup_failed_recovery`；只有 setup-failure cleanup 重试可以处理该状态。
- 已不存在的 worktree 只执行 prune 并返回幂等成功，不递归删除未知路径。

该 coordinator 覆盖普通 archive、auto-archive、MCP/CLI archive、agent setup-failure cleanup、agent 生命周期和 worker terminal 的受管写入。外部编辑器、shell 或其他进程不受 coordinator 控制，所以最终 Git 检查和非 force 删除不可省略。

## 6. 验证与边界

### 已验证

- Relay producer build 通过，随后 client/server typecheck 通过。
- app 与 desktop typecheck 通过。
- 本次改动文件 targeted lint 为 0 errors；format 和 `git diff --check` 通过。
- 先前已通过的 archive、snapshot、lane、file-transfer、terminal-reconnect 定向证据继续有效；它们对应的历史输出保存在仓库 evidence 目录中。
- PR #32 对应 CI run `31380923830` 的 format、lint、typecheck、test-audit、sdk-tests、relay-tests、CLI shards、knip、secret-scan 已成功。

### 明确未验证

- 本批 follow-up 对应的 Relay 新旧 client/daemon 运行时矩阵，包括 key substitution、challenge replay 和旧客户端拒绝。
- Electron safeStorage 实机、Android/iOS SecureStore 实机、Web 刷新后重配流程。
- 人工 Soft Home merge -> archive 破坏性演练、完整 device-list revoke UI、配对 prototype 的逐像素 QA。
- PR #32 的 server-tests、desktop-tests、app-tests、desktop-chain、packaged Electron、coverage、knowledge-graph-drift 和 Playwright 等失败 job 不能被忽略；该 run 已完成且整体 failure。
- 正式 draft release dry-run、精确 SHA 发布门禁在本批 follow-up 上的验证。

未验证项不是“已通过”的同义词。它们是当前生产发布阻断条件，除非用户明确接受相应残余风险。

## 7. 操作清单

### 升级 Relay

1. 先升级 client，使其理解 daemon challenge 和 channel-bound proof。
2. 再升级 daemon，使默认设备认证生效。
3. 旧 client 连接新 daemon 时提示升级/重新配对，不要打开永久 legacy fallback。
4. 只有临时事故恢复才设置 recovery override；记录操作者、开始/结束时间和后续删除动作。

### 设备存储异常

- 不要把 secret 手工复制回 host registry、日志、诊断报告或导出文件。
- Electron 若 safeStorage backend 不可用，先修复系统凭据服务；不要用 `basic_text` 或明文替代。
- Web 刷新后重新扫描配对 offer 是预期行为。

### 归档失败

- 先查看 worktree 当前状态和 `setup_failed_recovery`/`delete_complete_pending_finalize` 状态。
- 保留现场并处理未知文件或外部进程；不要手工执行 `git worktree remove --force` 或递归删除。
- 确认现场只剩允许清理内容后再重试对应 cleanup/archive 操作。

## 8. 发布判定

当前只能判定为“加固分支的代码和静态文档已对齐，等待精确 SHA 的直接运行时验证”。在精确 SHA CI、目标 Electron/native/Relay 运行时验证和残余项复核完成前，不得发布为生产稳定版本。

生产发布前的最小剩余清单：

1. 确认 PR head 指向包含代码与文档的同一 follow-up 提交，并让后续 CI 锁定该精确 SHA。
2. 只运行改动路径直接需要的 Relay/archive/storage 定向测试，不扩展或重复无关矩阵。
3. 验证新 client -> 旧 daemon、旧 client -> 新 daemon、新 client 首次配对/重连、recovery override、direct/local 不回归。
4. 在真实目标表面验证 packaged Electron safeStorage、Android/iOS SecureStore 和 Web reload/re-pair。
5. 在一次性 worktree 上人工执行 merge -> archive，并确认未知文件、外部写入和 teardown 失败均保留现场。
6. 要求 follow-up 精确 SHA 的必需 CI/release gate 通过；失败、取消、超时或错误 SHA 均阻断。
7. 执行 draft release dry-run，核对 artifact SHA、digest、打包后的 renderer/main 版本和回滚路径。

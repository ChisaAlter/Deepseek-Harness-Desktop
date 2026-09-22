# dsh-im 商业级交付审计

Date: 2026-09-10  
Scope: `vendor/dsh-im` 3.0.1 及其桌面分叉；桌面壳本身已按 `docs/features/dshbot.md` 从内置 bot 业务中移除。

## 结论

当前**不应作为商业版发布**。这不是粗糙 demo：代码已经具备九个 IM 渠道、AI Office、凭据隔离、连接生命周期、Harness 会话绑定、审批/问题恢复、命令、流式回复和媒体处理等生产化结构。但发布门禁本身不可信，且真实渠道业务、重启恢复、损坏持久化和文件安全缺少可重复的验收证据。

结论是“实现成熟度较高，但 release readiness 不通过”，不是对所有渠道功能都判定为已损坏。

## 能力矩阵

| 能力 | 当前证据 | 判定 | 发布前动作 |
| --- | --- | --- | --- |
| 渠道覆盖 | `src/channels`、`plugin-src/host/channels`、`plugin-src/client/channels` 均包含 dingtalk、discord、feishu、qq、slack、telegram、wecom、weixin、whatsapp，以及 office | 实现存在；仅静态确认 | 为每个渠道补真实凭据或可控 provider 的收发、断线、重连、停止和删除验收 |
| 凭据与管理 RPC | `plugin-src/host/channels/shared/rpc.mjs:23-25,77-85` 禁止公开 token/secret 字段；`rpc-authority.mjs:5-10` 默认 loopback；各 controller 使用 DSH credential provider | 基础安全设计通过 | 加入日志扫描、凭据移除后重启、权限/授权失败的集成测试 |
| 连接生命周期 | `token-bot-controller.mjs:66-100,152-174,311-365` 有初始化、重连、停止、关闭和按 bot 串行 transition | 代码结构接近生产 | 验证重复启动、失败重连、进程重启、半连接清理；覆盖各渠道差异 |
| Harness 会话绑定 | `harness-session-binding.mjs:13-110` 校验 session/workspace 唯一归属，拒绝 subagent；共享层有 per-key lock 和 ownership | 代码结构通过；运行证据不足 | 测试并发消息、`/new`、session 被外部删除、workspace 消失、approval/question 恢复 |
| 消息与群聊 | `text-harness-bridge.mjs` 提供去重、串行化、失败安全回复、命令和交互；README 声明各平台群聊规则 | 设计完整；未做全渠道验收 | 每个渠道验证私聊、群聊 @/reply、消息顺序、重复事件和平台限流 |
| 图片输入 | `image-prompt.mjs:3-5,188-272` 有 5 MB 单图、20 张、20 MB 总量、格式探测和超时错误 | 共享图片路径有边界 | 将各渠道适配器的下载上限和错误映射纳入测试矩阵 |
| 任意文件输入 | `inbound-file.mjs:117-161` 直接把 `message.files` 写入 workspace；shared ingress 只传 `signal`（`harness-session-coordinator.mjs:116-130`），没有统一大小、MIME、总量或磁盘配额 | **P1 风险** | 在 ingress 层增加字节/数量/总量/超时限制、拒绝策略和清理测试，不能只依赖平台 API |
| 结果文件回传 | `semantic/artifact.mjs:126-208` 会复制、哈希和缓存文件，但明确写着无项目级大小/时间限制，且先 `copyFile` 再检查大小 | **P1 风险** | 在快照前做大小/磁盘/超时限制，并覆盖超大文件、取消和清理 |
| 持久化与升级 | token/workspace/state store 使用原子临时文件写入和 700/600 权限；但 `token-config-store.mjs:60-68`、`conversation-state-store.mjs:35-42` 对损坏 JSON 直接抛错，schema 仅接受 version 1 | **P1 风险** | 增加备份/隔离损坏文件、可恢复启动、schema migration 和回滚测试 |
| 发布校验 | `DESKTOP-FORK.md:7-20` 已把注册点改为 `settings.remote.tab`；`scripts/verify-package.mjs:114-129` 仍强制旧的 `settings.section`/order 21/`IM机器人` | **P0 阻塞** | 让校验器与桌面分叉契约一致，并把该校验加入 CI |
| 测试门禁 | `package.json:83-87` 的 `npm test` 指向不存在的 `test/` 目录；当前命令退出 0 但报告 0 tests | **P0 阻塞** | 测试目录/模式必须真实匹配；无测试时失败，禁止静默 false-green |
| CLI 打包 | Git 记录 `bin/dsh-im.mjs` 为 mode `100644`，Windows `stat` 为 `100666`；校验器 `verify-package.mjs` 约在后段要求执行位 | **P0/P1 阻塞** | 明确 Windows/npm tarball 的可执行交付策略，并在干净包上验证 |

## 已执行验证

命令均在 `vendor/dsh-im` 工作区执行：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 退出 0，但 Node 报告 `tests 0 / pass 0 / fail 0`；原因是脚本 glob 没有匹配到任何测试文件，且仓库不存在 `vendor/dsh-im/test` |
| `npm run test:desktop` | 19 个测试：18 pass、1 skipped、0 fail；覆盖 transport/auth/ownership/approval/question/handshake，默认跳过真实构建 Harness 的 live test |
| `npm run check` | build 成功；随后再次得到 0 tests；最终在 `scripts/verify-package.mjs:126` 失败：`client bundle does not register the localized top-level IM settings section` |
| `node scripts/verify-package.mjs` | 同样在旧 settings-section 断言失败 |
| `npm pack --dry-run --json` | 包 `@xmanrui/dsh-im@3.0.1`，tar 约 8.4 MB、解包约 17.4 MB、240 个条目；未发现 bundled dependencies |
| `node -p ...bin/dsh-im.mjs` | mode `100666`，执行位为 0；按当前校验器逻辑会失败 |

## 主要缺口分级

### P0：必须先关闭

1. **测试门禁 false-green**：商业发布可以在没有执行任何业务测试的情况下显示成功。
2. **桌面分叉与包校验契约冲突**：构建产物按文档使用 `settings.remote.tab`，但校验器要求上游旧入口，因此 `npm run check` 不能通过。
3. **CLI 执行位交付策略未闭环**：当前仓库/Windows 文件模式与校验器要求不一致，需在干净 npm 包和目标平台重新验收。

### P1：商业稳定性与安全性

1. 没有九个 IM 渠道的业务级测试；现有 19 项测试不能证明二维码/凭据、平台 API、收发、媒体、群聊、重连和限流行为。
2. 真实 Harness live test 默认跳过，不能作为普通 CI 的必过项。
3. 任意文件 ingress 和 outbound artifact 没有统一的本地资源配额，存在磁盘/内存/长时间任务风险。
4. 多个持久化 store 遇到损坏 JSON 会直接让加载失败，没有 quarantine、恢复或迁移证据。
5. 需要真实验证部分失败时的运维可见性：host 会继续启动剩余渠道，仅在全部渠道失败时抛错（`plugin-src/host/index.mjs:67-78`）；必须确认 UI、日志和健康状态不会把“部分失效”显示成整体正常。

### P2：交付质量

1. README 仍描述上游「设置 → IM机器人」和 order 21（`README.md:94-102`），与桌面分叉的「设置 → Remote → 消息渠道」和 order 10 不一致。
2. 包体包含完整源码和大型生成 bundle；当前不是阻塞项，但应记录体积预算、升级策略和依赖审计结果。

## 发布验收顺序

1. 修复测试发现机制和 verifier 契约，确保 `npm run check` 在干净 checkout 上通过且不能出现 0 tests 绿灯。
2. 建立按渠道的 contract/integration matrix：配置/凭据、初连、断线、重连、停止、删除、私聊、群聊、重复事件、流式回复、平台拒绝。
3. 增加 Harness 端到端场景：并发 session、`/new`、approval/question、重启中断、外部删除 session/workspace。
4. 封闭文件安全边界：ingress 和 artifact 都有明确大小、数量、超时、MIME、磁盘和清理规则。
5. 验证损坏配置恢复、schema migration、凭据删除及正常重启；最后做 Windows 安装包和真实账号的人工 P0 smoke。

在上述 P0 和关键 P1 项关闭、并取得真实渠道证据前，不建议将 bot 宣称为“商业级可交付”。

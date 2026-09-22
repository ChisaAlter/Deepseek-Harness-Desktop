# 模块：dshbot 内置 Bots

dshbot 是随桌面安装包交付的内置 Bots 插件，源码为 `vendor/dshbot`（同步自 standalone 仓 `C:\Ai\dshbot` 工作树的快照），每次启动挂载，无需用户安装。业务测试在 standalone 仓维护（`npm test`，vendor 快照不含 tests/）。

## 挂载路径

`src/main/dshbot-desktop.js` 的 `ensureDesktopDshbot` 在每次启动（全量 + skip 恢复）执行：strip 用户层 `cordis.patch.yml` 中的旧受管块 → junction `profiles/web/node_modules/dshbot` → `vendor/dshbot` → 写桌面 overlay `desktop-plugins/dshbot/desktop-dshbot.patch.yml`（insert id `dsh-bot`，按包名装载）。`HarnessController` 把 overlay 追加到 `patchFiles`（install → usage → session-search → dsh-im → market → dshbot），经 `--patch` 传给 CLI；skip 启动同样携带。

## 升级迁移

`src/main/legacy-dshbot-preset.js` 只清除旧桌面写入的受管 patch 块和明确指向旧预置副本的链接，随后由内置 ensure 重建 junction 与 overlay。机器人设置、记忆、房间 preset、会话、manifest 依赖与 bundles 均保留。

## 内置语义

disable 名单对 `dshbot` 别名无效（config 归一化剔除，IPC 返回 `desktop-builtin`）；forensics 把它计入 `PRESET_PLUGINS`/`IN_BOX_PACKAGE_NAMES`，缺席 profile 清单的 suspect 即 `desktopRuntimeDamage`，Recovery Board 显示「内置组件损坏」。vendor 源或声明入口缺失时 ensure 失败并阻断启动——skip 修不了桌面损坏。

## 架构总览

一个 bot = catalog 条目（settings 命名空间 `dshbot`，schemastery 校验 + CAS revision）↔ 一个持久受管 Session（`session-hygiene.js` 拒绝用空白会话顶替）。所有输入通道——用户聊天、A2A 邮件唤醒、任务委派、routine、goal round——汇入同一 transcript；`/new`、`/reset` 被劫持成 `/compact`。bot 在唤醒间不持有状态；持久化全靠 catalog + `$DSH_HOME` 文件 + session 事件日志。

| 子系统 | 文件 | 机制 |
|---|---|---|
| catalog / RPC | `lib/catalog.js`、`lib/profile-ops.js`、`lib/control-plane.js` | settings ns `dshbot`；`/dshbot` 前缀 `connection.rpc.handle`；`checkRevision` CAS |
| 收件箱 | `lib/inbox-drain.js`、`lib/agent-messaging.js` | durable mail peek/ack；`agent/pre-step` 认领；`turn/end` completed 后 ack + 一次性自排空（60s 冷却、drain 轮不链式、goal armed 互斥）；重启 `restorePendingInbox` 每运行时至多一次冷唤醒 |
| 任务结算 | `lib/work-settlement.js`、`lib/task-tools.js` | `sessionId+turn` 精确绑定；无 `update_task` 的 bound turn 自动判负；幂等键 + audit |
| 记忆 | `lib/memory.js`、`lib/memory-review.js` | 双轨条目文件 `<id>.md`/`<id>.user.md`（`- ` 行、sha256 CAS、tmp+rename、逐条威胁扫描、8k/4k 上限）；`memory`/`remember` 工具；每 10 完成 turn 或 `compaction/start` 触发 `ctx.llm` 一次性提取 → `[auto] ` ops（3 连败熔断）；persona 段冻结快照保前缀缓存 |
| 目标续转 | `lib/objective.js` | catalog `objective`/`objectiveMaxRounds`（默认 16）为权威；宿主 `ctx.goals` 只在 agent 已 live 时惰性物化（`pendingSync`→首个 idle）；`active`+`disarmed` 每运行时每 bot re-arm 一次；续转由宿主 goal-round-driver 负责（模型自报完成）；UI 侧活目标交给 GoalBar，冷态才显示 ObjectiveDock |
| 例程 | `lib/schedule.js`、`lib/routine-runs.js`、`lib/routine-notepad.js`、`lib/routine-watch.js` | cron/interval、错过合并、占用保护；`settleRuns`（agent idle）捕获 ≤8k 输出 + `[SILENT]` 三判；`contextFrom` 注入上次输出/兄弟 routine 输出；notepad 工具读写 `$DSH_HOME/dshbot-routine/`；watch（url/command 哈希门，只能经 RPC 写入）未变则跳过模型调用；`/dshbot-hook/routine/{id}` loopback 触发（`X-Dshbot-Token` + timingSafeEqual） |
| 群聊 | `lib/group-*.js` | talking-circle：房父不跑模型、`ask_participant` 轮次、水印/epoch/晚到恢复 |
| 触达 | `lib/profile-ops.js` `activityFor` + `client/client.js` | unread/working/attention/goal/workSummary 1.5s 轮询；`notify` 开关 + renderer `Notification`；错过 routine 横幅 |

关键宿主接缝：`session/event`（turn/end、compaction/start）、`agent/pre-step`、`agent/status` idle、`agent/inbox/*`、`ctx.goals`、`ctx.llm`、`ctx.webServer.register`（`kind:'prefix'`）、`session.snapshotEvents()`。`/dshbot` RPC 必须经 `ctx.inject(['connection'])` 子 ctx 调 `connection.rpc.handle`（桌面 scope 布局约束，见 feature 卡不变量）。

## 宿主契约

Harness 提供通用的插件会话展示契约：`session/presentation` 日志事件记录 `owner` 和 `title`，普通会话列表、搜索和空会话复用排除已归属会话；插件仍通过原 Session ID 打开正常聊天界面。清除展示元数据恢复普通导航，但这是 release 后的展示导航，不会让曾有插件展示、历史消息、turn 身份或 `session/title` pin 的 Session 重新满足 New Session reuse；旧 pin 保持不变，用户可显式打开该 Session，最终资格由只读 Host `session.blankReuse({ sessionId })` 判定。用户显式分叉不继承插件归属。此契约不授予工具权限，也不是访问控制或数据隐藏机制。dshbot 用它对齐固定联系人/群聊会话（`origin: 'dshbot'`、`agentPreset: 'dshbot-room'`），侧栏 `sidebar.nav.tab`/`sidebar.page` 槽位由插件填充出 Bots tab；卸载语义已被内置取代，槽位恒有内容。

会话展示可显式声明 `composer: 'managed'`，继续使用同一个编辑器，但由插件通过 `conversation.input.managed` 提供资料配置入口，隐藏独立模型和开发配置快捷控制。受管会话保留真实标题和根级面板/窗口控制，同时隐藏普通开发会话的预设、轨迹、Session 日志、Git 分支与 Commit；历史视图状态不会让会话滞留在已隐藏的轨迹页。该字段不改变工具授权。插件应用模型使用 `saveAsDefault: false`，不修改普通会话默认模型。

- 本体测试覆盖 overlay 写入/幂等、junction、旧受块迁移、缺源/缺依赖 fail-closed、disable 免疫；机器人业务测试随 standalone 仓 `C:\Ai\dshbot` 维护并同步进 vendor。
- 独立仓 `ChisaAlter/dshbot` 继续存在，仅作历史参照，不是桌面运行时依赖。
- 契约：[dshbot](../../features/dshbot.md)；宿主扩展点：[plugin-session-navigation](../../features/plugin-session-navigation.md)；设计与取舍：`C:\Ai\dshbot\docs\continuity-memory.md`；调研：`docs/research/{grokbot-research,openbot-review}.md`。

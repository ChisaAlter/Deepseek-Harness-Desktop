# 生产者 manifest（P0，上游接入计划 §5/§6.2/§6.3）

每个生产者的完整合同字段：**可执行项、owner/service/id、检查面、接纳面、代际语义、可取消性**。

## P-A 客户端/API 请求

- 可执行项：`POST /api` 触发的 session/agent/job 工作（含主代理指令投递）。
- owner：`packages/client/connection`（cordis 服务 `connection`）。
- 检查面：`ctx.agents.list()`（status `active`/`failed`/`processing`？以运行时枚举为准）、`ctx.jobs.list()`（running/stopping）。上游 `hasDesktopActiveTasks`（`apps/desktop-host/src/update-tasks.ts` L81-107）同构。
- 接纳面：`connection/request` waterfall（connection/src/index.ts L155-160）；另由 `webServer.register` 包裹统一兜底（见 P-G）。
- 代际：锁 `generation` 内进入的请求计入 pending；并发 acquire 由协调器拒绝非当前代际 owner。
- 可取消：不能单点取消时按「仍在进行 → 拒绝/提示」。

## P-B 插件 HTTP 路由（非 /api 前缀）

- 成员：dshbot `/dshbot-hook/routine/*`（external-hook 触发 routine）、dshbot RPC、及其他自注册 `webServer.register` 路由的插件。
- 检查面：路由注册表/各插件自身 catalog。
- 接纳面：`internal/service` 监听 `webServer` 提供（迟注册兼容）→ 包裹 `register`/`registerUpgrade`：锁中 503 / 销毁 socket，控制路由白名单除外。
- 代际/可取消：route-level 拒绝即接纳控制；已投递任务退归 P-A 检查面。

## P-C Schedule runtime

- 可执行项：到期任务投递（`sessionController.resolveAgent` → `agent.followup`）+ recurring 重排。
- owner：`@dsh/schedule`（服务名 `schedule`）。默认 `disabled: true`（web-app patch L131-137）。
- 检查面：`schedule.catalog()`（含 ended 任务与 `sessionId`，`packages/schedule/schedule/src/index.ts` L303-313）→ 拆 due/recurring/cold-session；Session 调度与 `session-activity` 协查 loaded 会话。
- 接纳面：包 `agents.resolveAgent`（锁中拒投 due，armed 保留下次 window 重试）。`internal/service` 观察 `agents` 服务。
- 代际：任务 `id` 全局唯一 + 锁 `generation`；锁中投递失败后下次窗口只交给同代际 lock owner 判定。
- 可取消：`catalog` delete/clear 语义属数据语义（取消意图需同类 task id），锁中不清表。
- 默认关闭：coverage 标 `intentional-disabled`，不视为能力已交付；启用须经配置变更。

## P-D Bots（dshbot，内置默认关）

- 可执行项：routine 触发、定时 tick（`setInterval` 10s，`lib/index.js` L112-120）、hook 投递 → `resolveAgent` → `followup`。
- owner：`dshbot`（vendor/dshbot；经 `desktop-dshbot.patch.yml` 挂载，dshbotEnabled 为真）。
- 检查面：持久 catalog `dshbot-catalog.json`（dsh-home，桌面自有面）：enabled routine、pendingRun/running、未消费 inbox、recurring due/cold session。
- 接纳面：(1) `agents.resolveAgent` 包裹（经由 sessionController 也会走 agents）；(2) `webServer.register` 包裹覆盖 `/dshbot-hook/*`（计划 §6.3.1 点名）。
- 代际/可取消：routine `id` + pendingRun；锁中拒投不重排、armed 保留。
- 默认关闭：同 P-C 规则。

## P-E IM 渠道（dsh-im，内置每启挂载）

- 可执行项：渠道 inbound → session 投递。
- owner：`dsh-im`（vendor/dsh-im；`desktop-dsh-im.patch.yml`）。
- 检查面/接纳面：同 P-D（resolveAgent 包裹 + catalog 面以运行时暴露为准）。
- 注：external-hook 等效入口统一以 `external-hook` owner 报告。

## P-F jobs

- 可执行项：`jobs.start(spec)`。
- owner：`ctx.jobs`（抽象 registry，实现 `jobs-local`）。
- 检查面：`jobs.list()` running/stopping。
- 接纳面：包 `jobs.start`（锁中拒收）。
- 代际：job id + generation；锁中拒绝不回退代际。

## P-G WebSocket upgrade / gateway remote-stream

- 可执行项：`/api` 前缀外 `webServer.registerUpgrade`（如 gateway `REMOTE_STREAM_MUX_PATH`）。
- 检查面：upgrade 命中即「请求在途」待 drain；已建立连接按活动会话计。
- 接纳面：`registerUpgrade` 包裹：锁中 destroy socket。
- 附注：gateway 自己的 `connection.admit` 只做授权，不含更新锁。

## P-H 壳侧受管资源（非 Host 生产者，供关闭影响面确认）

- PTY：`desktopResources.pty` sessions（需只读 count/id 面）；preview 会话；components svc。
- 壳侧 owner：task-protection 协调器；关闭/重启/reload 前计入「受影响工作」呈现，commit 后才执行 killAll/closeAll/shutdown。

## 组合契约

- `hostGeneration` = Host 子进程启动随机 id + startedAt；每代独立计数器。重启产生的旧响应/旧锁一律拒绝。
- 可执行项 id：`type + owner + 全局唯一 id`（agent/job/schedule-task/routine/pty 等）。
- 观察时间：respond `observedAt` 为检查完成时刻；壳侧比对锁 owner 与 observedAt 关系判定竞态。
- unknown 语义：任何 `coverage` 非 `ok|intentional-disabled` → 壳侧不得自动提交更新，提示保留。

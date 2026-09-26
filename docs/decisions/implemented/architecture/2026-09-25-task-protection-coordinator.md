# Decision: 任务保护协调器与 Host 接纳锁

Status: implemented

中文 | [English](2026-09-25-task-protection-coordinator.en.md)

## Problem

上游 0.1.7-rc.2 的桌面任务保护（`apps/desktop-host` 的 update-tasks/quit-inspection）依赖官方 Desktop Host 装配；鲸屿跑的是独立 Node 的 Web profile，没有这套接线。退出、重启、停止、更新、增量安装各有入口，任一绕过检查都会中断正在运行的 agent、后台 job、到期调度或机器人例程。Launcher 直接对外部桌面 `taskkill /F` 则完全跳过确认。

## Decision

保护拆成三层，全部决策集中在壳侧协调器 `src/main/task-protection.js`：

1. **Host 插件** `vendor/dsh-task-control/`：单例锁 + 在途请求集合 + 检查面。webServer 的 register/registerUpgrade/registerFallback 被原位包裹（含插件加载前已登记的路由），锁定期内新请求统一 503；`sessionController.resolveAgent` 与 `jobs.start` 被包裹，Schedule 投递、dshbot 例程、IM 渠道都不能在锁中开工。`/dshd-task-control/<inspect|acquire|renew|release|cancel|status>` 走每启动一次的 Bearer token（`DSHD_TASK_CONTROL_TOKEN` 由壳注入）。锁按 owner + lockId + generation 校验，acquire 内 drain 在途请求后复查代次，TTL 惰性过期；解锁回调驱动 `schedule.runtime.requestDrive()` 恢复到期提醒投递。

2. **壳协调器**：`inspect → 脏则确认 → acquire → drain → 复查 → commit`。confirm 由主进程弹原生对话框（操作动词 + 工作清单 + 未知覆盖告警）；Host 不在或检查失败按阻断处理。`terminal: true`（quit/install/update）在 commit 成功后闩住，后续 before-quit 重复协调直接放行；非终态 commit 后主动 release，commit 抛错先 release 再传播。`hostLock: false`（reload）跳过 Host 锁只保留确认面。组件关停注册为 onCommitCleanup，只在终态 commit 运行——取消的退出不再误杀 launcher 监管的服务。

3. **跨进程握手**：桌面进程在 userData 写 `task-control-peer.json`（url/token/pid/generation，每代随机 token，文件随 quit 清掉）。slim launcher 的 `stopExternalDesktop`/`installRuntime`/`installDelta` 先 `resolvePeer`：有握手走 `stop-desktop`/`prepare-install`（桌面自己协调并在许可后退出进程）；无握手（旧版桌面）回退 WM_CLOSE 优雅关闭并确认进程真的退出——**不再 taskkill /F**。进程仍在则报 `desktop-still-running` 阻断安装。

delta 车道据此改为：桌面拒绝退出/仍在运行直接报错，不回退 full 安装器（会走同一握手二次弹窗）。electron-updater 通道在 `quitAndInstall` 前补同一协调，取消不再落回整包下载。

## Alternatives considered

- **只在 Electron 侧 before-quit 检查 Host 状态**：省一层，但 before-quit 只是钩子点——Schedule/Bots 等定时生产者在等待确认期间照常开工，安装器也可能已被拉起；接纳控制必须在 Host 内，因此不采用。
- **复用 desktop-install-control 通道跑协调**：路由语义不同（安装控制 vs 生命周期决策），混用会把既有端点变成双职责；另开 `/dshd-task-control` + peer 文件通道，互不侵入。
- **旧桌面继续 taskkill /F**：能退出但绕过一切确认——违反「保护发生在第一个副作用之前」，因此优雅关闭 + 仍在运行即阻断。
- **协调器在 launcher-service 内复制一份**：两处状态机会漂移；进程级单例 + 注入收口。

## Consequences

- 所有退出/重启/停止/更新/安装/增量路径过同一协调器；无活动时零弹窗直过，有活动或覆盖未知时弹确认。
- Host 插件缺失或控制路由不可达时 acquire 报 `dshd/unreachable`，无人值守的 update/install 被阻断——fail closed。
- 锁 TTL（默认 10 分钟）兜底协调器崩溃不释放的场景；release 幂等。
- slim 包安装期间桌面自己跑完整确认链，launcher 只等进程消失；旧版桌面要求用户正常退出。
- 测试面：协调器经 `fetchImpl`/`confirm` 注入可全量单测；插件 state/inspection/wrap 为纯 ESM 模块由 `src/main/task-control-plugin.test.js` 覆盖。
- 打包面：`vendor/dsh-task-control` 进 extraResources + after-pack 闭包断言；overlay 在 skip/全量双轮 compose 契约中按 exactly-once 断言。

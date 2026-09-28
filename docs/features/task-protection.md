# Feature: Task protection（退出/更新任务保护）

| Field | Value |
| --- | --- |
| **id** | `task-protection` |
| **status** | `active` |
| **last verified** | 2026-09-27(续2) — `preConfirmed` 扩到全部 install/update 链（`update.js` 整包、`update-updater.js` electron-updater、peer `prepare-install` 的 `install`）：安装/更新入口本身即显式同意，链内任务保护不再二次确认；quit/restart/reload 三入口保留确认门。新增 `launcher-confirm` 桥把主进程确认渲染进启动器 app-confirm 卡。launcher-confirm/update/task-protection/ipc/runtime-install/launcher-gate/window-marketplace 定向 175 例绿。决策见 [update-install-preconfirmed](../decisions/implemented/product/2026-09-27-update-install-preconfirmed.md)。前次：2026-09-27(续) — launcher 发起停止（peer `stop-desktop` + 自带启动器 `stopOp`）改 `preConfirmed`：用户点击即同意，两道确认门跳过，消除桌面窗口全隐藏时的原生 messagebox 回退；`confirmTaskStop` 锚点改首个可见窗。task-protection/ipc/runtime-install 定向 102 例绿。决策见 [launcher-stop-preconfirmed](../decisions/implemented/product/2026-09-27-launcher-stop-preconfirmed.md)。前次：2026-09-27 — 修复停止链三层缺陷（token 查询吞控制路径 405 / 升级 socket 终身占 pending 致 drain 超时 / schedule 未按 flag 报 unavailable）+ 启动器控件互斥；实机停止全链路通过（acquire 即刻、commit 执行、Host 子进程退出、启动器回落仅「启动桌面端」），drain-timeout 响应新增 `pendingLabels` 观测面。`src/main/task-protection*` + `task-control-plugin` 23 例、全量 2537 绿。决策见 [launcher-stop-controls](../decisions/implemented/bug-fix/2026-09-27-launcher-stop-controls.md)。前次：2026-09-25 — `node --test` 协调器/插件/契约相关 352 例全过；打包态与实机验收待 C 阶段复跑。 |

## User paths

1. 退出 / 关闭桌面（托盘、菜单、IPC、最后 Launcher 关闭）前，Host 侧协调器检查活动任务（agent/job/调度/机器人/在途请求）；存在时弹出确认，可取消或选择停止；取消后不产生任何副作用。
2. 更新 / 重装前锁定任务接纳，排空已接纳请求，复查无活动后放行安装器 / 差量写入；锁中 Schedule、Bots、外部 hook 的到期/触发保留状态不丢。安装/更新入口（更新询问、版本卡、「在线安装」、增量更新、runtime 安装、peer prepare-install）本身即用户显式同意，`preConfirmed` 下不再弹第二道确认。
3. Launcher 侧的「停止桌面」与运行时装对**外部桌面**先走同义握手；旧桌面无握手时要求正常退出并确认进程结束，不回退直接 taskkill /F。launcher 发起的停止带 `preConfirmed`——点击即同意，inspect→acquire→commit 照跑但两道确认门整体跳过，永远零弹窗。

## Invariants

- 保护发生在第一个副作用之前：`quitting` 标志、`cleanupDesktopResources`、`harness.shutdown()`、`app.quit()`、`quitAndInstall`、拉起安装器、`taskkill` 都排在决策之后。
- 接纳锁按 `hostGeneration` + `owner` 计数；inspect→acquire→drain→inspect 完成前不得放行，drain 中不得把 pending 当空。drain 集合只含会结束的准入（HTTP/fallback 写/resolveAgent/jobs.start/connection 瀑布）——升级 socket 只做连接期准入（锁内新升级 503、存量不进 drain，socket 上交付的工作由服务 chokepoint 拦截）。
- `before-quit` 的 preventDefault 不拦截其他监听者（`ipc-components.js` 的 svc.shutdown、main-launcher tray.destroy）——附属清理由协调器 commit 钩子统一触发。
- Schedule 与 Bots 同按声明开关取覆盖：flag 未设报 `intentional-disabled`，已设而服务缺失即 `unavailable`（fail closed）；加载失败/未知/超时一律阻止自动提交。
- 壳侧 PTY/preview/components 关停视为「受影响工作」计入确认面，但不算 Host 任务。
- `preConfirmed` 只用于携带用户显式同意的入口（peer `stop-desktop`、launcher `stopOp`、全部 install/update 链、peer `prepare-install`）：跳过确认不等于跳过保护——inspect、Host 接纳锁与 drain 照常；不得扩散到窗口关闭/托盘/菜单的 quit、restart、reload 路径。

## Allowed touch

- `src/main/task-protection*.js`（新，协调器 + 与入口接线）
- `src/main/index.js` / `launcher-service.js` / `update.js` / `update-updater.js` / `runtime-install.js` / `ipc-delta.js` / `delta/install.js` / `ipc-components.js` / `main-launcher/index.js`（只加协调器调用 + 挪副作用时机）
- `vendor/dsh-task-control/`（新，Host 侧插件）+ `src/main/task-control-overlay.js`（ensure overlay/junction）
- `src/main/dsh.js` / `harness-controller.js`（spawn env 注入 token、overlay 挂载顺序）

## Do not touch

- 不放开 `cordis.patch.yml` 用户面；不引入第二条插件装载通道。
- 不改 `desktop-install-control` 既有路由语义；协调器用同环回 + Bearer 模式新增端点。
- 不静默启用 schedule / dshbot / 任何上游能力。
- 不把 `taskkill /F` 作为「无握手」回退——旧桌面走正常退出确认。

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/task-protection*.test.js`、`src/launcher/launcher-confirm.test.js`、`vendor/dsh-task-control` 单测、相关定向回归 |
| Manual / QA | 活动任务存在时退出/重启/重载确认（安装/更新/启动器停止不再二次确认）；取消后无副作用 |

## Sources

- Decision: [任务保护协调器与 Host 接纳锁](../decisions/implemented/architecture/2026-09-25-task-protection-coordinator.md)
- Decision: [启动器停止失效与控件互斥修复](../decisions/implemented/bug-fix/2026-09-27-launcher-stop-controls.md)
- Plan: `docs/superpowers/plans/2026-09-25-upstream-adoption-plan.md` §5–§6.4
- Upstream seam: `vendor/deepseek-harness/apps/desktop-host/src/update-tasks.ts`、`quit-inspection.ts`、`packages/client/connection/src/index.ts`
- Evidence: `docs/superpowers/evidence/2026-09-25-upstream-adoption/`（p0-baseline.md / producer-manifest.md / ledger.md）

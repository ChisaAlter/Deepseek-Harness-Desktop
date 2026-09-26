# Feature: Task protection（退出/更新任务保护）

| Field | Value |
| --- | --- |
| **id** | `task-protection` |
| **status** | `active` |
| **last verified** | 2026-09-25 — `node --test` 协调器/插件/契约相关 352 例全过；打包态与实机验收待 C 阶段复跑。 |

## User paths

1. 退出 / 关闭桌面（托盘、菜单、IPC、最后 Launcher 关闭）前，Host 侧协调器检查活动任务（agent/job/调度/机器人/在途请求）；存在时弹出确认，可取消或选择停止；取消后不产生任何副作用。
2. 更新 / 重装前锁定任务接纳，排空已接纳请求，复查无活动后放行安装器 / 差量写入；锁中 Schedule、Bots、外部 hook 的到期/触发保留状态不丢。
3. Launcher 侧的「停止桌面」与运行时装对**外部桌面**先走同义握手；旧桌面无握手时要求正常退出并确认进程结束，不回退直接 taskkill /F。

## Invariants

- 保护发生在第一个副作用之前：`quitting` 标志、`cleanupDesktopResources`、`harness.shutdown()`、`app.quit()`、`quitAndInstall`、拉起安装器、`taskkill` 都排在决策之后。
- 接纳锁按 `hostGeneration` + `owner` 计数；inspect→acquire→drain→inspect 完成前不得放行，drain 中不得把 pending 当空。
- `before-quit` 的 preventDefault 不拦截其他监听者（`ipc-components.js` 的 svc.shutdown、main-launcher tray.destroy）——附属清理由协调器 commit 钩子统一触发。
- Schedule 是 Web bundle 内置组件，服务缺失即 `unavailable`（fail closed）；Bots 仅在 `dshbotEnabled` 开启时纳入覆盖，关闭报 `intentional-disabled`；加载失败/未知/超时一律阻止自动提交。
- 壳侧 PTY/preview/components 关停视为「受影响工作」计入确认面，但不算 Host 任务。

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
| Automated | `src/main/task-protection*.test.js`、`vendor/dsh-task-control` 单测、相关定向回归 |
| Manual / QA | 活动任务存在时退出/更新/停止三路径确认；取消后无副作用 |

## Sources

- Decision: [任务保护协调器与 Host 接纳锁](../decisions/implemented/architecture/2026-09-25-task-protection-coordinator.md)
- Plan: `docs/superpowers/plans/2026-09-25-upstream-adoption-plan.md` §5–§6.4
- Upstream seam: `vendor/deepseek-harness/apps/desktop-host/src/update-tasks.ts`、`quit-inspection.ts`、`packages/client/connection/src/index.ts`
- Evidence: `docs/superpowers/evidence/2026-09-25-upstream-adoption/`（p0-baseline.md / producer-manifest.md / ledger.md）

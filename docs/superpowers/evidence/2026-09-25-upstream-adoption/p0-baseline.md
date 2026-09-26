# P0 基线记录（2026-09-25 上游接入计划）

采集时间：2026-09-25，Asia/Shanghai。本文件是 [计划](../plans/2026-09-25-upstream-adoption-plan.md) §5 的实存证据，后续阶段的新增回归以此区分。

## 1. 版本复查（开工重查）

| 对象 | 本次结果 | 与计划 §1.1 基线 |
| --- | --- | --- |
| GitHub 最新发布 | `dsh-v0.1.7-rc.2`，published 2026-09-24T14:10:21Z，`prerelease=true`（`/releases/latest` 对候选版返回 404，列表首个即该 tag） | 一致 |
| `git ls-remote` master / HEAD | `477b4f420553e8a52c2fbccc464d7561b239c443` | 一致，无更新 |
| npm dist-tags | `latest=0.1.5-rc.3`、`next=0.1.7-rc.2`、`alpha=0.1.7-alpha.2` | 一致 |
| 本地 pin | `vendor/harness-upstream.json` ref/npm=rc.2，SHA 同上 | 一致 |
| 桌面树 | `HEAD=5eed678db9c`（`docs(harness-upstream-sync): record rc.2 baseline and merge verification`），工作树大量已存修改与未跟踪文件 | 一致，工作树为事实基线 |

## 2. 运行环境

| 项 | 值 |
| --- | --- |
| OS | Windows 11 专业版 10.0.26200（64-bit） |
| RAM | 34,159,669,248 B（≈31.8 GiB） |
| Node（壳构建/测试） | v26.7.0 |
| npm | 11.19.0 |
| pnpm（根 devDependency 钉） | 11.0.9（本地可执行）/ package.json devDep `pnpm@11.22.0` |
| Electron | devDep `^43.4.0` |
| 首发目标 | Windows x64（其他平台未运行不称已验证） |

## 3. 改动前测试基线（`npm test`，node --test 全量）

- 命令：`npm test`（`node --test "src/**/*.test.js" "mobile/web/**/*.test.js" "scripts/**/*.test.mjs"`）
- 结果：**tests 2437 / pass 2429 / fail 6 / skipped 2**，耗时约 79 s。
- 既有失败（先于本计划改动，属既有回归而非本次新增）：

| 用例 | 失败形态 | 初判 |
| --- | --- | --- |
| `src/main/dshbot-client.test.js` ×4 | `vendor/dshbot/client/client.js:6794` `Cannot read properties of undefined (reading 'get')` | rc.2 合并后 dshbot client 对新宿主 region seat 结构失配；非本计划引入 |
| `src/shared/harness-desktop-forks.test.js` `assertDesktopForks` | `packages/client/ui-agents-panel version is 0.1.7-alpha.2, expected 0.1.7-rc.2` | vendor pin 复核：该包版本号未随 rc.2 对齐；**P0/P4 相关既有失败** |
| `src/shared/post-merge-ui.test.js` fixed overlays | ENOENT `ui-attachment/src/ImageLightbox.module.css`（`FORK_FILE_MARKERS` 期望该文件存在） | rc.2 合并后该 fork 文件缺失；既有失败 |

> 处置约定：上表属既有失败，实施中不借「本计划」名义关闭；若相关阶段修复则以该阶段证据单独记录。

## 4. 中断入口追踪（计划 §6.1 实测调用方）

| 入口 | 实测位置 | 首个副作用 | 重入/备注 |
| --- | --- | --- | --- |
| 真退出（托盘/菜单/IPC、closeToTray=false、最后 Launcher 关闭） | `index.js:445 quitApp()` → `quitting=true` → `app.quit()` → `before-quit`（L793） | `before-quit` 中 `stoppingForQuit=true` → `stopDesktopInstallControl()` → `cleanupDesktopResources()`（杀 PTY/关 preview）→ `hideHarnessView` → `showClosingOverlay` → `harness.shutdown()` → `app.quit()` | `qaEnv('DSH_QA_SHELL')` 可拦截（测试面）；当前无任何任务检查/确认 |
| 菜单/托盘/工作区/配置/插件对齐重启 | `restartWithCleanup()`（L432）← `pickWorkspace`、`applyRendererConfigPatch.startHarness`、`profile-ops` disable/enable、boot `shell:restart`（→ `retryFullPlugins`）、launcher `shell:start-desktop`（sticky） | 立即 `cleanupDesktopResources()` 杀 PTY/preview，再 `recordLastDesktopStart(()=>harness.restart())` | 无确认；PTY 在确认语义前已被杀 |
| 页面 reload | `reloadWithCleanup()`（L440）← menu onReload | `cleanupDesktopResources()` → `harness.reload()` | 同上，无确认 |
| Launcher 停止桌面 | `launcher-service.js stopOp`（L278） | 先 `stopDesktopCleanup()`，再 `harness.stopDesktop()` / `dsh.stop()`，`dismissMainWindow()` | 无任务检查 |
| blockmap 更新 | `update-updater.js installLatestViaUpdater` → `autoUpdater.quitAndInstall(true,true)`（L200） | 直接 quitAndInstall，无 before-quit 以外的检查 | `installFromAsset(options.preferUpdater)` 进入 |
| 完整包/指定版本 | `update.js installFromAsset`（L457）→ 下载+sha512 → `launchInstaller`（L530）→ `quitAfterInstall` 默认 `app.isPackaged` → `setTimeout(()=>app.quit(),800)` | 安装器启动后 800ms 退出 | 下载/校验可在保护前完成；拉起安装器才是首个破坏性副作用 |
| slim 安装/切换/停止外部桌面 | `runtime-install.js installRuntime`（L182）、`startExternalDesktop`（L308）、`stopExternalDesktop`（L387） | `installRuntime` 下载→`launchInstaller`（quitAfterInstall:false）→`waitForInstall`；`stopExternalDesktop` 先 `taskkill`（WM_CLOSE）5s 宽限再 `/F /T` | **当前 slim 安装不先停桌面、无握手**；旧桌面无握手时须改「正常退出确认」语义 |
| 独立 delta → full fallback | `ipc-delta.js` → `delta/install.js installDelta`（L77）→ `delta/apply.js applyDeltaFile` | **当前顺序错误**：`installDelta` 在 L121-132 先 `probeDesktopRunning`+`stopExternalDesktop()`，再 fetch/下载/校验/apply；apply 有 staging+base-hash 预检+rename 回滚，失败走 `fullInstall` | 需改为「解析/下载/校验 → 协调确认 → 停目标并确认 → 排他事务 → 再验基线 → 写入」；保护终态不得 fallback |
| 附属 before-quit 监听 | `ipc-components.js` L50-60：`app.on('before-quit')` → `svc.shutdown()`；`main-launcher/index.js` L155：tray.destroy | **preventDefault 不阻止其他监听者**：index.js 拦退出时 components svc.shutdown 已先跑（F14 证实） | 全部附属清理须挪到协调器 commit 后调用 |

## 5. 生产者清单（P0 manifest 草案，详见 producer-manifest.md）

| 生产者 | 接纳点 | 检查面 | 状态 |
| --- | --- | --- | --- |
| 客户端/API 写请求 | `connection/request` waterfall（`packages/client/connection` L155，`/api` 前缀内） | `ctx.agents.list()` + `ctx.jobs.list()`（`hasDesktopActiveTasks` 同构） | 可接：webServer prefix 路由也可被 `webServer.register` 包裹统一收口 |
| 非 /api 插件 HTTP 路由（dshbot `/dshbot-hook/routine/*`、dshbot RPC、gateway `REMOTE_STREAM_MUX_PATH` WS upgrade） | 各自 `webServer.register`/`registerUpgrade` | 路由自身注册表 | 可接：`internal/service` 观察 webServer 提供后包裹 register/registerUpgrade，迟注册路由一并收口 |
| Schedule（默认 `disabled: true`，web-app patch L131-137、ui-schedule L411-414） | `sessionController.resolveAgent` → `agents.resolveAgent`（runtime.ts L101）；投递失败保留 armed | `ctx.get('schedule').catalog()` 全量 active/inactive+sessionId（index.ts L303，F5 证实不激活 Session） | 可接：包 `agents.resolveAgent`；默认关闭时 coverage=intentional-disabled（需 Loader/配置证据） |
| Bots（dshbot 桌面内置，默认关） | `control-plane` `ctx.get('sessionController').resolveAgent`（agent-resolution.js L37-54）+ 10s tick + `/dshbot-hook` 触发 | 持久 catalog `dshbot-catalog.json`（dsh-home）只读：enabled routine、pendingRun/running、未消费 inbox | 可接：resolveAgent 包裹覆盖投递；catalog 读文件；非 /api 路由经 webServer.register 包裹 |
| IM 渠道（dsh-im，内置，每启挂载） | lib/index.js 经 sessionController/resolveAgent 投递 | 渠道 inbound → session followup | 同上 |
| jobs | `ctx.jobs.start(spec)`（jobs/jobs/src/index.ts，抽象 JobRegistry，jobs-local 实现） | `jobs.list(caller?)` running/stopping | 可接：包 `jobs.start` |
| 桌面 PTY/preview/受管组件 | 壳侧 `desktopResources.pty`（killAll）/ `preview.closeAll` / `svc.shutdown`（components） | pty sessions Map 计数（需加只读面）、preview 会话 | 壳侧协调器自带 |

**覆盖规则**（计划 §5/§6.2）：服务不存在时仅当「有效配置 + Loader 共同确认 intentional-disabled」才排除；加载失败/未知/超时一律 unknown 并阻止自动提交更新。

## 6. Office importer 解析复核（F7 补证）

从 `packages/document/office-to-pdf/package.json` 为 importer：

- `@deepseek-ai/libreoffice-kit` → `node_modules/.pnpm/@deepseek-ai+libreoffice-kit@0.1.1/...`，version `0.1.1`，顶层含 `lib/{cli,index,worker,font-snapshot-worker}.js`，**无顶层 prebuilds.json/bin**。
- kit `optionalDependencies` 声明 `@deepseek-ai/libreoffice-kit-win32-x64@0.1.1` → `scripts/libreoffice-packages.mjs::selectOfficeEngine` 对本目标返回 `win32-x64`（**native 必须交付，不许静默落 WASM**）。
- 引擎实体 `node_modules/.pnpm/@deepseek-ai+libreoffice-kit-win32-x64@0.1.1/...` 存在：`bin/libreoffice-kit.exe`、`program/`、`prebuilds.json`（schemaVersion 1、status built、逐文件 sha256 清单）、`licenses/`、`sources/`。pnpm store 同时有 `libreoffice-kit-wasm@0.1.1`（备选，本目标不采用）。
- 结论：源码树 native 引擎在位，符合计划 F7 修订结论；**实际转换运行与打包闭包验证属 P3，未执行不声称**。

## 7. P0 出口核对

- [x] 官方版本复查（本节 §1）
- [x] 环境基线（§2）与改动前测试基线（§3，6 项既有失败已列名）
- [x] 全入口调用方/首副作用/重入追踪（§4，对照计划 §6.1 全表）
- [x] 生产者 manifest（§5 + producer-manifest.md）
- [x] converter/skill/kit importer 解析与 engine manifest（§6）
- [x] Q/K/O/D/C 账本（`ledger.md`，全部 not-run 起步）
- [x] 新卡建槽：`task-protection`、`keyboard-shortcuts`、`office-runtime`（status=proposed，写拟交付契约不标已验证）
- 默认关闭调度、Bots 分工、desktop shortcuts adapter、Node Office 闭包、共享 Diff owner：见各卡 Do-not-touch 与计划 §2.3

**不声明**：P0 完成不代表任何产品能力已交付；Q/K/O/D/C 未逐条实机验收前计划未完成。

# 2026-08-25 代码审查修复计划（H-1 / M-1…M-5 / L-1 / L-3 / L-5）

`Touching: desktop-launcher, mobile-remote, dsh-home`。其余条目（H-1、M-1、M-2、M-5、L-1、L-3）为不改产品契约的本地安全 / 结构修复，无对应 feature 卡片，在此显式声明。

## 目标与验收（按严重度）

### H-1 全局 DevTools 快捷键（必须修）

- **现状**：`src/main/index.js` `globalShortcut.register('CommandOrControl+Shift+I')` 是 OS 级全局快捷键：桌面端在后台时也会劫持其他应用的 Ctrl+Shift+I；且打包版无条件开 DevTools。
- **改法**：删除 `globalShortcut`；改为 `app.on('web-contents-created')` 上挂 `before-input-event`（仅本应用 webContents 收到输入时才触发，天然窗口作用域），目标仍是 `getHarnessWebContents(win) || win.webContents`（与原行为一致）。门禁：`!app.isPackaged || config.openDevTools === true`。判定逻辑抽为纯函数模块 `src/main/devtools-shortcut.js` 并配单测。
- **触碰**：`src/main/index.js`、新增 `src/main/devtools-shortcut.js(+test)`。
- **验收**：单测覆盖（输入匹配、packaged 门禁）；index.js 不再引用 `globalShortcut`。
- **产品契约**：本地修复，不改卡片（菜单里的 `role: 'toggleDevTools'` 保持不动）。

### M-1 端口清理误杀（dsh.js）

- **现状**：`killOwnedListeners` 按进程名 `node|dsh` 兜底击杀占用端口的进程——会误杀用户本机其他 Node 服务；`ensureOwnedPort` 在 httpReady 时触发该兜底；`DshManager._doStop` 停止时也做同样清扫。
- **改法**：删除 `killOwnedListeners` / `listeningPids` 及其依赖注入；`ensureOwnedPort` 只杀 **pid 文件确认** 的残留（保持 `isSafeToKill` 名称防护作为护栏），否则 `findFreePort` 跳端口；`stop()` 只 killTree 自己 child / pid 文件 pid。
- **触碰**：`src/main/dsh.js`、`dsh.test.js`。
- **验收**：新增/更新单测：非 pid 文件确认的占用不被击杀、改为跳端口；stop 不再做端口清扫。
- **产品契约**：本地修复。风险：真残留但 pid 文件丢失时不再抢回原端口，改跳端口——行为更保守，属可接受折衷。

### M-2 credentials.json 明文（config.js）

- **现状**：`apiKey / githubToken / remoteToken / remoteRelayToken / remoteDevices` 明文 JSON。
- **改法**：写入时若 `safeStorage.isEncryptionAvailable()`，写 `{"version":"safeStorage-v1","payload":"<base64(encryptString(JSON))>"}` 信封；读取兼容两种格式；读到明文旧文件且可加密时**一次性迁移**改写为密文。加密不可用（无钥匙串的 Linux、单测无 electron safeStorage）时保持明文回退，行为不回退失败。
- **触碰**：`src/main/config.js`、新增 `src/main/config-credentials.test.js`（注入 fake safeStorage）。
- **验收**：密文读写往返、明文→密文迁移、无 safeStorage 时回退，全部单测覆盖；现有 config.test.js 不回归。
- **产品契约**：本地修复（磁盘格式变化，向后兼容读明文）。

### M-3 更新安装与卸载（update.js）

- **现状**：Release 缺 `SHA512SUMS.txt` 时静默直接下载并拉起安装器；`launchUninstaller` / `openWindowsAppsSettings` 用 `shell:true` spawn 注册表来的命令串。
- **改法**：
  1. `installFromAsset` 增加 `options.confirmUnverified`：无 `checksumUrl` 时先经确认回调（默认**拒绝**，fail-closed）；`ipc.js` 的 `shell:install-update` / `shell:install-release` 与 `index.js` 冷启动闸门都接 `dialog.showMessageBox` 确认框；拒绝则不下载、返回 `launched:false`。
  2. `launchUninstaller` 去 `shell:true`：优先已存在的 exe 路径，否则 `extractUninstallExe` 提取 exe，不存在则落 settings 路径；`openWindowsAppsSettings` 同步去 `shell:true`。允许 `deps.spawn` 注入以便单测。
- **触碰**：`src/main/update.js(+test)`、`src/main/ipc.js`、`src/main/index.js`、`docs/features/desktop-launcher.md`（invariant「无清单跳过校验」→「无清单需用户确认，拒绝即不装」+ last verified）。
- **验收**：单测：无清单+拒绝→不下载不拉起；无清单+确认→继续；卸载 spawn 无 shell 且只 spawn 已验证存在的 exe。
- **产品契约**：**改 desktop-launcher 卡 invariant**（审查明确要求）。

### M-4 LAN 明文 HTTP 警示（remote）

- **现状**：LAN 模式 `0.0.0.0` + 明文 HTTP，UI 无风险提示。
- **改法**：本轮做「醒目标注」：`ui-settings-remote` 弹窗在开启 + LAN 模式时渲染警示行（zh/en 词典 `lanWarning`）；`docs/features/mobile-remote.md` 与 handbook 模块补明文限可信局域网说明。**绑定地址可配置与自签 TLS 明确推迟**（涉及配对 URL / Android 客户端 / 中继共同演进，超出本轮）。
- **触碰**：`vendor/deepseek-harness/packages/client/ui-settings-remote/src/client/{locales.ts,RemoteSection.tsx}`（mobile-remote 卡 Allowed touch 内）、`docs/features/mobile-remote.md`、`docs/handbook/modules/mobile-remote.md`。
- **验收**：词典 zh/en 同步（`satisfies` 编译约束）；卡片 last verified 更新。局限：本环境不构建 vendor 前端，UI 变更为静态修改。
- **产品契约**：mobile-remote 卡加一条警示性 invariant。

### M-5 index.js 混入 ~700 行 QA/冒烟

- **现状**：`runSmoke` / `probeTitlebarHits` / `probeThemeBackgrounds` / `keepRemotePhoneHost` 等 QA 编排全部住在 `src/main/index.js`（1282 行）。
- **改法**：抽到 `src/main/smoke/index.js`（`createSmokeRunner(deps)` 依赖注入），index.js 只留 `qaEnv('DSH_SMOKE')` 门禁 + 惰性 `require('./smoke')`。QA 驱动模块（release-ui-walk 等）位置不动。更新对 index.js 源码做静态断言的测试（qa-gate / shell-p0-qa / remote-gate-qa / packaged-p0 / composer-official-qa / appendix-a-qa）指向新模块。
- **打包 files 不排除 QA 驱动**：`qa:packaged` / `smoke:packaged` rehearsal 要在**安装包内**经 `DSHD_ALLOW_PACKAGED_QA=1` 运行这些驱动（qa-gate.js 门禁），排除会破坏打包 QA；驱动已被 packaged 门禁与惰性加载双重约束。此为审查「尽量排除（不要破坏 CI/QA）」的落地判断。
- **触碰**：`src/main/index.js`、新增 `src/main/smoke/index.js`、上述 6 个测试文件。
- **验收**：`npm test`（src/main 全部）通过；index.js 体积显著下降；生产路径无 QA 驱动常驻（静态断言保留）。
- **产品契约**：纯结构重构。

### L-1 REMOTE_FEATURE_ENABLED 双份

- **改法**：preload 删除手抄常量；`src/main/window.js` 给 harness BrowserView 的 `additionalArguments` 追加 `--dshd-remote-feature=0|1`（来源 `config.js` 唯一真值）；preload 解析 argv，缺失时 fail-closed（不暴露远程四方法）。更新 `shell-api.test.js`（删同步断言，加 argv 解析断言）与 `window-harness-cover.test.js` 期望。
- **产品契约**：本地重构（mobile-remote 卡「preload 暴露四方法」不变）。

### L-3 死 IPC `shell:pick-workspace`

- **确认**：`ipc.js` 注册 + preload 暴露 `pickWorkspace`，但仓内（含 vendor）无任何调用方；菜单「打开工作区」走 index.js 内部 `pickWorkspace()`（dialog 直调），不经该 IPC。
- **改法**：删 ipc.js handler 与 preload 方法；更新 `docs/handbook/appendix/shell-api.md`。
- **产品契约**：删除无调用方的通道，缩小攻击面。

### L-5 spawnEnv / pluginEnv 双实现

- **改法**：新增 `src/shared/child-spawn-env.js`：`childSpawnEnv(config, { extras, baseEnv })` 承担 dsh-home 覆盖、`ELECTRON_RUN_AS_NODE`/`ELECTRON_NO_ASAR` 清理、官方 DeepSeek env 门禁、`npm_config_update_notifier` 与 PATH extras 前置；`dsh.js.spawnEnv` 与 `marketplace-install.pluginEnv` 改为在其上叠各自 extras（PATH 顺序由调用方给定，保持原有优先级）。配单测。
- **触碰**：均在 dsh-home 卡 Allowed touch 内（`src/shared/*`、`dsh.js`、`marketplace-install.js`）。
- **产品契约**：dsh-home invariant 不变，实现收敛为单份；卡 last verified 更新。

## 明确不做（与审查一致）

- 不深改 `vendor/deepseek-harness`（M-4 仅动 desktop fork 包 `ui-settings-remote` 的词典与一行渲染，在 mobile-remote 卡 Allowed touch 内）。
- 不重写 HarnessController / DshManager 并发编排（M-1 只删清扫路径，不动 generation/stop 语义）。
- 不重设计中继协议；不迁移 BrowserView → WebContentsView。
- L-2 / L-4（审查未列入本轮清单）不做。

## 修订记录（步骤 2：对照审查核对）

逐条核对 H-1、M-1…M-5、L-1、L-3、L-5 后的修订：

1. **M-3 无清单默认值改为 fail-closed**：初稿倾向「无回调时保持旧行为直装」；核对审查「勿静默直装（至少确认/拒绝）」后改为**默认拒绝**，所有调用点显式接确认框，防止未来新增调用点绕过。
2. **M-5 打包排除项收回**：核对 `qa:packaged` / `smoke:packaged`（packaged-p0.test.js 断言其为本地 rehearsal 且在安装包内跑）后确认排除 QA 驱动会破坏打包 QA——按审查括号内提醒保留打包，改以 qa-gate 门禁 + 惰性加载作为约束，并在 PR 里说明。
3. **M-1 范围扩大到 `stop()`**：审查点名 `killOwnedListeners`/`ensureOwnedPort`，核对后发现 `_doStop` 也调用同一清扫，一并移除，否则误杀路径仍在。
4. **M-4 绑定地址可配置推迟**：`pairingUrl` / Android 配对 / relay 快照都假定全地址监听，改绑定地址牵动 mobile-remote 多端，超出「低风险」界定，本轮只做警示标注（UI+文档），TLS/绑定配置列为后续。
5. **H-1 保留菜单 `toggleDevTools` role**：审查给了「before-input-event 或菜单 accelerator」两条路，取 before-input-event（可达 harness BrowserView，菜单 role 只达焦点窗口），菜单项不动。
6. **L-1 缺失参数语义定为 fail-closed**（不暴露远程方法），与 ipc 层 `REMOTE_FEATURE_ENABLED` 双保险方向一致。

## 测试策略

- 每个改动模块跑对应 `node --test src/main/<module>.test.js`；收尾跑全量 `npm test`（node:test：src + mobile/web）。
- 无显示器 / 非 Windows 环境局限：H-1 快捷键、M-3 确认框、M-4 UI 警示、卸载 spawn 均静态 + 单测验证，无法动态点按验证；在 PR 与报告中声明。

## 执行结果（步骤 3 收尾）

全部 9 项（H-1、M-1…M-5、L-1、L-3、L-5）已按上述修订后的计划落地，无推迟的 H/M 项；M-4 的绑定地址可配置与自签 TLS 按修订记录 4 明确列为后续。

- 全量 `npm test`：**1029 tests，1026 pass，0 fail，3 skipped**（skip 为仓内既有的平台条件跳过）。
- vendor `ui-settings-remote` 客户端 spec（M-4 警示行）：`vitest run` **18 passed**。
- `src/main/index.js` 由 1308 行降至 492 行（M-5）；`shell:pick-workspace` 通道删除（L-3）；preload 不再手抄远程开关（L-1）。
- 新增回归护栏：`src/main/smoke/smoke-extraction.test.js`（生产入口不得回灌 QA 编排）、`src/shared/child-spawn-env.test.js`（dsh-home 不变量单实现）、`src/main/devtools-shortcut.test.js`、`src/main/config-credentials.test.js`。

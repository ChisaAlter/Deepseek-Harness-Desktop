# Feature: Desktop launcher

| Field | Value |
| --- | --- |
| **id** | `desktop-launcher` |
| **status** | `active` |
| **last verified** | 2026-09-05 — 历史会话恢复与插件归因定向检查：Harness 工作区/API/旧缓存 121 项、桌面导入/恢复/打包单测 171 项通过；重新登记已有目录接纳导入历史，缓存格式错误不归咎用户插件。未执行候选安装包升级实测。此前：2026-08-31 — after-pack 拍平后若顶层 `commander` 是 CJS（`<12`），从 `.pnpm` store 覆写成 ESM `commander@12+`，否则打包 CLI `import { Command }` 在 skip compose 门禁失败。此前同日 — session-search overlay 仅全量 `--patch`。此前 2026-08-27（合并后收口复核，`main@6874270c` + 收口分支）— desktop `npm test` 1224 用例 / 1219 绿 / 0 红 / 5 skip；`check-skip-compose-contract.js` 对真实构建 CLI（Linux，Node 22.22.2）通过；`smoke:source`（X :1）titlebar 六键 + surfaces/branch/git 命中全过（并发负载下 2 次 branch-menu flake，空载连续 3 次 PASS，非回归）；云 VM Node 钉版落地 `.cursor/environment.json` + `install.sh`（`.nvmrc` 单源）。此前同日 — **dsh-im 内置化并入 overlay 层**：`ensureDesktopDshIm` 不再向 profile `cordis.patch.yml` 写受管块（每次启动 strip 迁移），改写 `desktop-plugins/dsh-im/desktop-dsh-im.patch.yml`；该 overlay 与 install overlay 一样**每次**启动（全量 + skip）经 `--patch` 传，disable 名单对 dsh-im 别名不再生效（config 归一化剔除 + `shell:disable-plugin(s)` 返回 `desktop-builtin`），vendor 运行时缺损仍 fail start（桌面运行时损坏，skip 修不了）。forensics `IN_BOX_PACKAGE_NAMES` 并入 dsh-im 别名与 install overlay 路径记号（`desktop-plugins/install-dsh-plugin`）：孤儿 suspect 命中即 `inBox` + `desktopRuntimeDamage`。skip compose 契约升级为双 overlay：skip/full 双轮都断言 install 行与 dsh-im 行各**恰好一次**，迁移回放同时预埋 install + dsh-im 两代受管块；已对真实源码树 CLI 跑通。此前 2026-08-26（晚，D 系列）— **单一 overlay 收敛（D1）**：`ensureDesktopInstallPlugin` 不再向 profile `cordis.patch.yml` 写受管块——每次启动 strip 新旧两代受管记号、把注释-only 文件归一化回 `[]`（CLI `parsePatchList` 拒绝非数组 YAML）、写 `desktop-plugins/install-dsh-plugin/desktop-install.patch.yml` 并删除旧名 `skip-user-plugins.patch.yml`；**所有**启动（全量 + skip）都经 `--patch` 传该 overlay。usage-panel 同规则（自有 `desktop-usage-panel.patch.yml`，仅全量启动传；禁用/ensure 失败/市场 bundle 接管时删 overlay 不传）。`cordis.patch.yml` 回归纯用户所有（唯一例外：dev opt-in `dshbotPreset` 仍写受管块）。skip 语义精确化：用户层 = profile patch + home patch，桌面自有行全部在 overlay 层。`harnessSpawnPlan` 在 Windows `.cmd` shell 模式给含空白参数加引号（overlay 路径在 `AppData\Roaming\<用户名>` 下）。契约脚本双轮都传 overlay、回放受管块迁移（canary 保留 + 块消失）并断言 install 行恰好一次（CLI insert 不按 id 去重，残块+overlay=双挂载）。**双恢复面收敛（D3）**：`shell:open-launcher` 放开 BOOT 角色，boot 发起时落启动器 home tab（Recovery Board）；插件级恢复只在 Board 一处。此前同日：「跳过用户插件」救生启动修复 + 契约门禁收口：skip 启动只随 `--patch` 传桌面自有 overlay（仅 install 插件 insert），不再把整份 profile `cordis.patch.yml` 当 overlay 复活用户层（CLI 在 `--skip-user-plugins` 下仍应用 `--patch`，旧行为使 skip 完全失效）；`isPluginTreeFailure` 识别 Node ESM `ERR_MODULE_NOT_FOUND / Cannot find package … imported from …profiles/web/`（Loader 以 profile 目录为 parent 导入每个插件行）；`buildLaunch` 启动前探测 `DESKTOP_PACKAGES` 内置组件包缺失（两锚点：CLI + bundle manifest；覆盖包不可解析与声明入口未构建，判定与打包门禁共用 `missingDeclaredEntries`），缺失时给出可操作错误（setup:harness / 重装）而不是无限重试。同日收口：after-pack 对**真实打包 CLI** 跑 skip/full 双轮 `dump-config` 契约（`scripts/check-skip-compose-contract.js`，canary 用户层 skip 轮必须消失、full 轮必须存在，install 插件两轮都在）；`dsh.test.js` argv 语法契约测试从 vendored `args.ts` 提取 web 子命令旗标集，钉死 `--skip-user-plugins`/`--patch` 落在 CLI 语法前缀内不被 app args 吞掉；Recovery Board 诚实化——suspect 命中 `DESKTOP_PACKAGES` 且不在 profile 清单 → `inBox` 行 + `desktopRuntimeDamage`，verdict 直说「内置组件损坏，禁用/跳过均无效」并压过 sticky skip 文案。此前 2026-08-25 — H-1/M-3 回归护栏落地：静态断言钉死「index.js 无 `globalShortcut`、DevTools 走 `web-contents-created` 窗口级门禁」与「两条安装通道 + 冷启动闸门都接 `confirmUnverified`，确认框 `defaultId/cancelId=1` fail-safe」；非 Windows 分支单测（`launchUninstaller` linux/darwin 源码运行 → `source-run-no-install`、packaged → `uninstaller-not-found`，绝不 spawn、不查注册表）。同日早些：无 `SHA512SUMS.txt` 的 Release 不再静默直装：必须经用户确认（拒绝即不下载），冷启动闸门与 `shell:install-update`/`shell:install-release` 均接确认框；`launchUninstaller`/`openWindowsAppsSettings` 去 `shell:true`，只 spawn 已验证存在的 exe 路径。此前：导入闸门 `probeImportHold` 浅探针；更新请求注入 `config.githubToken`；`runColdStartGate` 编排；`downloadFile` 断流/截断防护；v0.2.7 正式发布 |；本次 alpha.4：setup:harness 与 packaged P0 通过。

## User paths

1. 冷启动只开启动器窗，不立刻 `dsh web`。先查 GitHub 正式版：有新版本则**先打开启动器窗再询问**（弹框与下载进度都落在可见启动器上）；没有或跳过则启动桌面端。用户选「更新」后下载/校验失败、只打开发布页、或源码运行拉起安装器时，回启动器首页并提示，「启动桌面端」仍可手动进桌面；仅 packaged 且安装器已拉起时等待应用退出。
2. 空桌面 `sessions/` 且官方 home / 用户技能根有可导入会话、附件、技能、可重装插件、MCP、白名单设置节、预设或 home `AGENTS.md` 时停在导入，不自动启桌面。导入页分类勾选，可另选来源或技能目录；只拷勾选项到桌面 home。闸门判定用 `probeImportHold` 浅探针（首个命中即返回），不做全量 `scanImport` 元数据扫描。
3. 桌面就绪且「启动后退出启动器」为开 → 关启动器窗，**仅**在完整健康启动（`lastStart.ok===true`、非 sticky skip、非 recovery 启动）时生效。启动失败或 sticky skip 时留在启动器并展开首页 **Recovery Board**（全插件名单、归因、逐项开关、批量禁用可疑）。跳过用户插件后点「启动桌面端」会清 sticky 并强制重启。插件排查与首页共用同一插件名单渲染；禁用/启用在内核 `ready|starting|error` 时经 `startHarness` 对齐名单，**不**走会关启动器的 `startDesktop`。
4. 托盘 / 文件菜单「打开启动器」随时再打开。版本页展示本机已安装版本与路径（源码运行时标注 package.json 版本；若注册表有 Setup 则显示其版本与路径），可刷新 GitHub 正式版列表、更新/切换 Setup，或启动 Windows 卸载程序 / 打开「设置 → 应用」移除本机应用（NSIS 单实例，不能并列多版本）。
5. 导入 / 移除在曾停止内核时提示需在首页再启；boot 页 `shell:restart` 仍走 `retryFullPlugins`（清 skip）；启动器 `shell:retry-full-plugins` 走 `startDesktopFromLauncher({ recoveryLaunch, forceRestart })`。
6. 桌面端运行中（`ready|starting`）时首页主按钮为「关闭桌面端」，经 `shell:stop-desktop` 仅停内核并隐藏主窗，启动器保持打开。导入页「重新扫描」显示进度并保留勾选与会话分组折叠状态。
7. 桌面端「通用设置 → 启动时」与启动器「打开后自动启动桌面端」共用 `autoStartDesktop`：是则冷启动跳过启动器直进桌面（启动器经托盘右键）；否则先开启动器。待导入 / 更新确认 / 上次启动失败时仍先开启动器。

## Invariants

- 会话缓存 `session_projcache` 的 schema 错误单独归因，不标记用户插件可疑；Recovery Board 的缓存诊断优先于 sticky skip，不建议清空原始会话。Loader 的 `failed to apply loader entry … (包名)` 纳入插件证据，排除 `cordis:include` 包装层。

- 同一 Electron 进程、同一安装包；不是第二套 exe。
- 启动器走官方 `--dsw-alias-*`；`--boot-*` 不得用在启动器页。
- 启动器浅色/深色跟官方 dsh web 表（`data-ds-dark-theme`），不把 Appearance 壁纸种子写进 token。
- 市场 / 壁纸图库仍禁止另开产品窗。
- `/releases/latest` 忽略 draft；正式版 0.2.7 起启动器随 Setup 提供。
- 换版本只下载该 tag 的 Setup 并拉起安装器，不单独切 `vendor/dsh` pin。
- 更新检查请求 10s 超时、单次下载整体 15 分钟超时；正文中断（error/aborted）或落盘字节与 content-length 不符视为失败并删除半成品；失败不阻塞手动「启动桌面端」。
- 壳层 `config.githubToken` 存在时，`checkUpdate` / `listReleases` / 安装请求与下载**首跳**（仅 `api.github.com` / `github.com`）带 `Authorization: Bearer`；重定向跳（签名 CDN）不带；token 不进日志与错误信息。
- 冷启动更新流程绝不留下无窗进程：更新询问前必须 `openLauncher()`；接受更新后除「packaged 且安装器已拉起（随后 app.quit）」外一律落回启动器首页（错误/结果写入 `shell:launcher-hint`），auto start 在该轮被 hold（`shouldAutoStartDesktop.updateFlowHold`）。编排在 `launcher-gate.runColdStartGate`（依赖注入、单测覆盖）。
- `last-desktop-start.json` 写入方唯一集合：启动器 `startDesktopFromLauncher`、boot 页 `shell:restart` / boot `shell:retry-full-plugins`、菜单/托盘/插件对齐 `restartWithCleanup`（经 `recordLastDesktopStart`）。成功写 `{ok:true}`，失败写 `{ok:false, error}`；launcher 角色 `shell:retry-full-plugins`/`shell:start-desktop` 由 `startDesktopFromLauncher` 代写，不双写。
- sticky skip 判定唯一实现 `launcher-gate.stickySkipActive({pluginRecovery, appVersion})`；ipc 与 `HarnessController.shouldSkipUserPlugins` 共用（后者负责清掉跨版本的陈旧标记）。
- OS 浅深色切换经 `chrome.watchSystemTheme`（`nativeTheme updated` → `applyAppTheme`）即时重绘窗口背景。
- Release 若带 `SHA512SUMS.txt`，下载后强制 sha512 校验（失败即删除并报错）；无清单的 Release **不静默直装**——必须经用户确认（`confirmUnverified`，默认 fail-closed 拒绝即不开始下载），确认后安装但不做校验。
- 卸载与「设置 → 应用」回退绝不经 shell 执行注册表命令串：只 spawn 已验证存在的卸载 exe 路径（`extractUninstallExe`），提取失败落「设置 → 应用」。
- 关启动器：桌面主窗还在则只关启动器；主窗不在则退出应用。
- `readLastDesktopStart` 三态：缺文件 `{ ok:null }`（不挡 auto start）；失败 `{ ok:false }`；成功 `{ ok:true }`。
- 「启动桌面端」清除「跳过用户插件」sticky 时必须 `forceRestart`；`HarnessController.restart()` 不得把旧 in-flight Promise 交给新调用方（先 await 再开新 `replaceOperation`）。
- 插件排查禁用/启用写盘后若内核在跑，只经 `startHarness`/`restartWithCleanup` 对齐，不得经 `startDesktopFromLauncher`（避免 `quitAfterStart` 关掉排查窗）。批量禁用可疑走 `shell:disable-plugins`（一次写盘 + 一次 align）。
- 「跳过用户插件」救生启动不 ensure market/usage/session-search/dshbot；dshbot 是独立插件，任何启动都只 `removeDshbotPreset` 清残留（config `dshbotPreset: true` 且非 skip 时才跑开发预置，log-only）。desktop-install 仍 required。可选桌面预置不得拖垮恢复通道。
- 桌面自有行只经 `--patch` overlay 挂载：install insert 在 `desktop-install.patch.yml`（**每次**启动传，全量 + skip），dsh-im insert 在 `desktop-plugins/dsh-im/desktop-dsh-im.patch.yml`（**每次**启动传，全量 + skip；产品语义归 remote-settings 卡），usage insert 在 `desktop-usage-panel.patch.yml`（仅全量启动传），session-search 覆写在 `desktop-plugins/session-search/desktop-session-search.patch.yml`（仅全量启动传；`session-query-sqlite` `openAt: first-search` + 耐久 `dsh-home/session-query.sqlite`，产品语义归 mobile-remote 搜索）。profile 的 `cordis.patch.yml` 纯用户所有——ensure 只 strip 遗留受管块（strip 后无内容须归一化回 `[]`，否则 CLI `parsePatchList` fail-loud），绝不写回；strip 与 overlay 写入在同一 ensure 调用内、每次 spawn 前成对发生（CLI insert 不按 id 去重，受管块残留 + overlay 同时组合 = 双挂载）。**绝不**把 `cordis.patch.yml` 传给 `--patch`——CLI 在 `--skip-user-plugins` 下仍应用 overlay，传整份用户层等于没跳过。唯一例外：dev opt-in `dshbotPreset: true` 仍走受管块（默认关闭、log-only、默认路径只删不写）。
- Windows `.cmd` 外部 dsh（`shell: true` spawn）时 `harnessSpawnPlan` 必须给命令与所有含空白参数加引号——overlay 路径在 `AppData\Roaming\<用户名>` 下，用户名带空格是常态，不加引号参数会被 shell 拆开。
- 插件级恢复（归因、逐项/批量禁用、skip、恢复完整插件）**只**存在于启动器 Recovery Board 一处；boot 页只保留瞬时动作（重试 / 取消自动重启 / 下载日志）加「回启动器排查」跳板（`shell:open-launcher`，BOOT 角色发起时附带 show-tab home）。boot 页不得再长出自己的恢复操作副本。
- skip 只能救用户层（profile patch / manifest bundles）；模板 bundle 挂载的内置组件包（`DESKTOP_PACKAGES`）缺失属运行时损坏，`buildLaunch` 启动前探测并报可操作错误（源码运行 → `npm run setup:harness`；安装包 → 重装），不进入无效 skip 循环。探测覆盖「包不可解析」与「manifest 在但声明入口未构建」两种（与打包门禁共用 `missingDeclaredEntries` 判定）。
- skip compose 语义由打包门禁背书：after-pack 对打进 dist 的真实 CLI 跑 `dump-config` skip/full 双轮（`scripts/check-skip-compose-contract.js`，临时 DSH_HOME + 用户层 canary + 预埋受管块回放迁移）——skip 轮 canary 必须消失且 install / dsh-im 两个桌面行仍挂载，full 轮 canary 必须回来；两轮都传全部桌面 overlay（对齐生产 argv），install 行与 dsh-im 行必须各**恰好一次**（>1 = 受管块残留与 overlay 双挂载），迁移后 `cordis.patch.yml` 不得再含受管记号（install + dsh-im 两代块都回放）且 canary 用户行必须保留；任一违反即打包失败。单测层不能替代此门禁（单测 mock 了 dsh.start）。
- 启动器自有旗标（`--skip-user-plugins`、`--patch`）必须位于 CLI 语法前缀（首个未知 token 之前），否则被 CLI 当 app args 吞掉——桌面以为跳过、实际满载。`dsh.test.js` 从 vendored `args.ts` 的 web 子命令提取旗标集做语法行走断言，vendor 同步改语法会即刻红。
- Recovery Board 在 sticky skip、`lastStart.ok===false`、desktop error、genericCause、pluginTreeFailure 或存在 suspects 时于首页展开。
- Recovery Board 诚实化：suspect 命中 `DESKTOP_PACKAGES`、dsh-im 别名（`@xmanrui/dsh-im` / `dsh-im` / `xmanrui-dsh-im`）或 install overlay 路径记号（`desktop-plugins/install-dsh-plugin`）（精确名或子路径 specifier）**且不在 profile 插件清单** → 行标 `inBox`（badge「内置组件」）、payload `desktopRuntimeDamage: true`；verdict 换成「内置组件损坏：禁用/跳过均无效，重装安装包或 `npm run setup:harness`」，并压过 sticky skip 文案（skip 修不了运行时损坏）。inBox 行不进批量禁用集合。同名用户插件**在** profile 清单时仍是普通可禁用 suspect。
- `shell:stop-desktop`（启动器专用）取消 harness 自动恢复与在途 restart/start、停止 dsh 内核、清理 PTY/预览并销毁主窗；托盘在内核未运行时打开启动器；不退出 Electron 进程、不关启动器。
- 版本页 `listReleases` 附带 `installed`（运行模式、注册表 Setup 版本/路径、是否可卸载）；卸载优先 NSIS `Uninstall*.exe`，否则打开「设置 → 应用」；源码运行且无注册表安装时隐藏卸载按钮并给出明确说明。
- 导入重新扫描保留 session-rel / skill-id / plugin-name / mcp-id 勾选与会话分组折叠；扫描完成展示计数与时间戳。

## Allowed touch

- `src/main/window.js` 启动器窗、`src/renderer/launcher.*`
- `src/renderer/theme.js`、`src/main/chrome.js`、`src/shared/themes.js`
- `src/main/launcher-gate.js`、`src/main/update.js`、`src/main/plugin-forensics.js`
- `src/main/index.js` 冷启动闸门、`src/main/ipc.js`、`src/preload/index.js`、托盘/菜单
- `src/main/harness-controller.js` 仅限 sticky skip 判定委托与启动 `patchFiles` 组装（install + dsh-im overlay 所有启动、usage 与 session-search overlay 仅全量；不动其余生命周期语义）
- skip 救生链路（2026-08-26 扩入，理由：skip 语义由这些文件共同实现）：`src/main/dsh.js`（`buildLaunch` argv/预检、`harnessSpawnPlan` 引号）、`src/main/plugins.js`（`ensureDesktopInstallPlugin` overlay + 受管块迁移）、`src/main/usage-panel-preset.js`（overlay 化，行为语义归 usage-stats 卡）、`src/main/session-search-overlay.js`（overlay 化，行为语义归 mobile-remote 搜索）、`src/main/plugin-tree-failure.js`、`src/main/plugin-runtime-files.js`、`src/shared/launcher-recovery.js`
- 契约门禁：`scripts/check-skip-compose-contract.js`、`scripts/after-pack.js`（仅 skip compose 契约调用与 `assertDesktopForkRuntime`；打包其余部分归 marketplace-settings / 打包卡）
- 本卡与 QA `TC-LAUNCH-*`

## Do not touch

- vendor harness
- 把 `--boot-*` 扩到启动器
- 在启动器里做市场、壁纸、完整官方设置

## Gates

| Kind | What |
| --- | --- |
| Automated | `launcher-gate`（含 `runColdStartGate` 编排 / `stickySkipActive` / `recordLastDesktopStart`）/ `update`（listReleases、downloadFile 断流/截断）/ `plugin-forensics`（含 inBox/`desktopRuntimeDamage`）/ `launcher-recovery`（verdict 优先级 + 排序）/ IPC LAUNCHER 单测；`dsh.test.js` argv 语法契约（args.ts 提取）；`skip-compose-contract` 单测 + after-pack 真实 CLI `dump-config` skip/full 双轮门禁；`launcher-theme` / `officialShellBackground` / `windowBackgroundForShell`；`chrome-theme` watchSystemTheme；`session-search-overlay` 与 harness-controller 全量/skip `patchFiles` |
| Manual / QA | `TC-LAUNCH-001`…`008` |

## Sources

- Implementation：`src/main/launcher-gate.js`、`src/renderer/launcher.html`、`src/renderer/theme.js`、`src/shared/themes.js`

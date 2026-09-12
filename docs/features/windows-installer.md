# Feature: Windows 安装器（品牌化外壳 + NSIS 引擎）

| Field | Value |
| --- | --- |
| **id** | `windows-installer` |
| **status** | `active` |
| **last verified** | 2026-09-12 — 品牌外壳（`installer/` + `wrap-setup.mjs` + `build-installer-stub.mjs`）首次提交入库；此前所有已发布版本（含 v0.2.9）均为裸 electron-builder NSIS 向导。本次修复：`isExistingInstall` 只信合法绝对路径并先读 `InstallLocation`，损坏的卸载记录不再劫持升级目标；「启动」前校验已装 exe 存在。本机验证：re-wrap 后 `/S /D=` 实装出完整树（app.asar / 内嵌 node.exe / vendor extraResources / 快捷方式 / 正确注册表）。旧记录：2026-09-06 v0.2.9 发布验证（Setup SHA256 `1eb5bd7c…`，仅覆盖品牌化 NSIS 向导）见 [发布记录](../qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)。 |

## User paths

1. 双击 Setup（GUI）：外壳 `installer/stub.c` + WebView2 页面 `installer/ui/app.html`——单窗口 560×400 原生标题栏，白底（`--dsw-alias-bg-base`）+ 鲸标 + 产品名 + 细蓝强调线，中文优先英文兜底。就绪页可选安装目录（默认 `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop`，已装则显示升级态）→ 安装中进度条（轮询目标目录字节数 / manifest `installBytes` 估算）→ 完成页「运行 Deepseek-Harness-Desktop」。错误页提供重试与「使用经典向导」逃生口。
2. 静默安装 `Setup.exe /S`：外壳不解 UI，提取内嵌 NSIS 载荷后 `/S` 透传，退出码原样回传；`/D=<dir>` 同步转发（整 token 匹配，路径含 `/S` 不误判）。
3. WebView2 不可用/被杀软拦截/页面超时未就绪（10s watchdog，TIMER_READY）或用户点「使用经典向导」→ 自动回退内嵌 NSIS 经典向导（同一份载荷，GUI 重跑），装错/升级语义完全一致。
4. 卸载（设置 → 应用 / 开始菜单）：品牌化卸载向导（NSIS 模板 + 灰阶侧栏）不删 `userData`。

## Invariants

- `oneClick: false`、`allowToChangeInstallationDirectory: true`、桌面 + 开始菜单快捷方式、artifact 名 `Deepseek-Harness-Desktop-Setup-${version}.exe` 不得变——release.yml globs、SHA512SUMS、桌面更新器都按这个名字找包。
- 实际安装语义由**内嵌的 electron-builder NSIS Setup** 完成（解压/注册表/快捷方式/卸载注册/升级），外壳只负责呈现与进度估算；换皮不得替换安装引擎。
- 包装格式：`[stub][payload][manifest JSON][u32 len]["DSHSTUB\x01"]`，`scripts/wrap-setup.mjs` 与 `installer/stub.c` 两端同构；wrap 后用 app-builder-lib `buildBlockMap` 重算 `.blockmap`，SHA512SUMS/更新器校验流不变。
- `/S` 静默安装必须保持可用；`/D=` 覆盖目录语义不变。`build/installer.nsh` 只允许 `customWelcomePage` / `customUnWelcomePage` / `customHeader` 三个 GUI 宏；禁止 MessageBox、Section、RequestExecutionLevel、customInstall/customInit 等会影响静默/升级路径的内容。`customUnWelcomePage` 是纯页面声明（替换 electron-builder 模板里的裸 `MUI_UNPAGE_WELCOME` 插入点），必须自己重插 `MUI_UNPAGE_WELCOME` 并重定义 `MUI_WELCOMEPAGE_TITLE_3LINES`——MUI2 每插一页就 UNSET 欢迎页设置，安装侧的 define 到不了卸载器，否则卸载欢迎页标题第三行（「…Uninstall」）被裁。
- 外壳健壮性：WebView2 加载失败、控制器创建失败、页面 ready 超时（`TIMER_READY` 10s）、`ProcessFailed` 任一发生都回退经典向导；回退路径不依赖 WebView2。
- 已有安装识别（`isExistingInstall`）只信**合法绝对路径**（`X:\` / UNC）且目录里真有 `Deepseek-Harness-Desktop.exe` 的记录：先读 `HKCU\Software\<uninstall 子键>` 的 `InstallLocation`（与内层 NSIS 升级路径同一来源），再从 `UninstallString` 解析目录兜底。盘符相对路径（`C:foo`）等损坏记录一律当未安装处理，不得把升级劫持到幻影目录；下一次成功安装会用正确值覆盖记录自愈。验证脚本里 `/D=` 必须带引号或经 Node spawn 传参——bash 无引号实参会吃掉反斜杠，写出损坏的卸载记录（2026-09-12 事故）。
- 完成页「启动」前外壳先确认目标 exe 存在；缺失时显示错误态而不是静默无响应。
- 默认 per-user 安装（`%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop`，TC-INST-013 依赖）；不设 `perMachine`，不设 `deleteAppDataOnUninstall`。
- 外壳 UI（`installer/ui/app.html`）与回退向导位图共用同一浅色表：官方浅色表（`src/shared/dsh-webui-tokens.css`）的构建期镜像，与启动器同源——画布 `--dsw-alias-bg-base` 白、文字 `--dsw-alias-label-primary/secondary/tertiary`、强调仅细线/进度条用 `--dsw-alias-state-business-primary`（= `--dsw-static-deepseek-500` `rgb(65,118,230)`）、发丝线 `rgba(0,0,0,.10)`、错误 `--dsw-alias-state-error-primary`。禁止近黑营销面板（icon-tile `#0b0d12` 第二皮肤）、禁止 `--boot-*` 仪器画布扩散进安装器；卸载侧栏是同一浅色构图的灰阶弱化版。
- 回退向导位图是经典 24 位无压缩 BMP，几何固定：sidebar 164×314、header 150×57。改品牌图先改 `scripts/render-installer-assets.js` 再 `npm run installer:assets` 重新生成，禁止手改二进制或另起配色。
- 外壳构建：`scripts/build-installer-stub.mjs`（MinGW gcc + windres，资源内嵌 `app.html` / `WebView2Loader.dll` / 图标 / asInvoker manifest），产物 `build/dsh-setup-stub.exe`；`scripts/wrap-setup.mjs` 由 `npm run dist` 末尾自动调用（stub 缺失时先编译）。
- 安装器语言 zh_CN（首位 = 兜底）+ en_US；产品中文文案走 MUI 本地化串，不烙进位图。
- 许可页读根 `LICENSE`（MIT）原文。
- 安装器/卸载器图标 = `assets/icon.ico`（与应用同一鲸标）。
- 发布链产物验收：windows job 的 packaged smoke 门禁（`smoke:packaged` on `dist/win-unpacked`）位于 `npm run dist` 之后、artifact 上传之前，**阻断**发版；步骤内置两次尝试（连续两次失败=真问题），不设 `continue-on-error`。`workflow_dispatch` 默认只构建 Windows；macOS 仅在显式 `include_macos=true` 时构建。本版 Windows 发布不上传 DMG。不得把该步骤改造成重复 test.yml 的质量门（`npm test` / `test:gui` 仍禁止进 release.yml）。
- 发布晋级必须使用 `.github/workflows/publish.yml`：仅接受 `release.yml` 在 `main` 分支的成功候选运行，核对同一 SHA 的 Desktop tests、Setup SHA256 与版本化文件名，从该运行下载原始资产并生成 `SHA512SUMS.txt` / provenance；晋级步骤不得重新执行 `setup-harness` 或 `npm run dist`。

## Allowed touch

- `package.json` 的 `build.nsis` / `build.win` 与 `scripts.dist` 末尾的 wrap 接线 — 安装器配置与包装
- `installer/` — `stub.c`、`stub.manifest`、`ui/app.html`、`vendor/webview2/`（WebView2.h / WebView2Loader.dll / LICENSE）
- `scripts/build-installer-stub.mjs`、`scripts/wrap-setup.mjs` — 外壳编译与包装/blockmap 重算
- `build/` — `installer.nsh` 与生成的 BMP
- `scripts/render-installer-assets.js`、`scripts/run-render-installer-assets.js` — 位图生成
- `src/main/installer-branding.test.js` — 自动门禁
- `.github/workflows/release.yml` windows job 的 packaged smoke、`.github/workflows/publish.yml` 的同一候选资产晋级、手动候选的 Windows-only 默认值与 `src/main/ci-isolation.test.js` 对应钉子（2026-09-06 用户明确要求本版不要 macOS；上传 globs / SHA512SUMS 流仍在 Do not touch）
- 本卡与 [build-release handbook](../handbook/modules/build-release.md)

## Do not touch

- `scripts/after-pack.js` 装配逻辑、SHA512SUMS / 更新器校验流
- artifact 命名与 `release.yml` 上传 globs
- mac DMG 打包配置与上传命名；本卡只控制手动工作流是否调度既有 macOS job

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/installer-branding.test.js src/main/ci-isolation.test.js`（随 `npm test`）：nsis 契约、BMP 几何/位深、nsh 宏白名单、release.yml glob 对齐、tail 格式 buildTail/parseTail round-trip、stub `/S` 透传与回退钉子、app.html 官方 token 白名单；手动候选默认 Windows-only；packaged smoke 位于 dist 后、上传前，两次尝试且无 `continue-on-error`；publish.yml 只晋级 main 同 SHA 候选、校验 Setup 版本名 / SHA256 并禁止重建；release CI 实跑 `smoke:packaged`（win-unpacked 实启 + 内嵌 DSH_SMOKE 断言，阻断发版） |
| Manual / QA | `TC-INST-001`（GUI 安装走查）、`TC-INST-009`（`/S` 覆盖升级）、`TC-INST-010`（卸载）、`TC-INST-012/013` in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md)；每次改品牌位图后对 CI windows artifact 目检欢迎/许可/目录/完成/卸载五页——实机执行清单（artifact 下载/SHA256/逐页 checklist/zh_CN）固化在 [TC-INST-RUNBOOK.md](../qa/results/2026-08-25/installer-branding/TC-INST-RUNBOOK.md) |

## Sources

- Design: [design-language.md](../design-language.md)（官方浅色表 / 品牌蓝仅强调 / 鲸标；安装器 chrome 对齐「桌面启动器」一节，不是启动页仪器画布），[dsh-webui-tokens.css](../../src/shared/dsh-webui-tokens.css)，`assets/whale.svg`
- Spec: electron-builder NSIS 选项（assisted installer 默认无欢迎页、默认 `nsis3-metro.bmp` 侧栏——本卡替换为品牌资产）
- Implementation entry: `package.json` `build.nsis` + `scripts.dist`、`installer/stub.c`、`installer/ui/app.html`、`scripts/build-installer-stub.mjs`、`scripts/wrap-setup.mjs`、`build/installer.nsh`、`scripts/render-installer-assets.js`

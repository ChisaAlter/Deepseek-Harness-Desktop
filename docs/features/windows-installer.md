# Feature: Windows 安装器（NSIS 品牌化）

| Field | Value |
| --- | --- |
| **id** | `windows-installer` |
| **status** | `active` |
| **last verified** | 2026-09-12 — 新增 `customInit` 注册表净化（死 InstallLocation/UninstallString 记录删除 + `$INSTDIR` 按 `/D`>活记录>卸载器目录>默认 重算 + 绝对性兜底），修复损坏/陈旧安装记录劫持升级目标的问题（事故：mangled 记录把 0.3.0 装进 `tmp\inst-verify`）。真实 Setup 七场景 29 项实机验证全过（fresh `/D`、drive-relative 记录、wiped-tmp 记录、原地升级、UninstallString 兜底、mangled `/D`、带空格 `/D`、静默卸载自清）；makensis 编译通过。旧记录：2026-09-06 — Windows `v0.2.9` 已按维护者明确授权公开为 Latest。固定源码 `583b6fa92d93df2ee56363e96e2891b356af75b9` 的 Desktop tests `34015974835` attempt 2 与 Windows build/packaged smoke `34015983516` 均成功；Setup SHA256 `1eb5bd7c3769e1d09a6e863f8948706359f255a91608f0989e7982d19c380117`，版本资源 `0.2.9`，未做 Authenticode 签名。三个发布资产与本机已校验 CI 文件逐项匹配；自动触发的重复构建 `34018917540` 已取消。新包完整实机 P0 未完成，不继承 [旧 e11fb52 安装验证](../qa/results/2026-09-06/candidate-e11fb52/WINDOWS-CANDIDATE.md)。授权与发布证明见 [发布记录](../qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)。 |

## User paths

1. 双击 Setup（GUI）：欢迎页（品牌侧栏：官方浅色侧栏底 `rgb(249,250,251)` + 近黑鲸标 + 产品名 `Deepseek-Harness-Desktop` + 细蓝强调线 + 右缘发丝线，MUI 本地化中文/英文文案）→ MIT 许可页 → 安装模式/目录选择（可改目录）→ 安装进度（右上白底近黑鲸标 header）→ 完成页（默认勾选「运行 Deepseek-Harness-Desktop」+ 产品仓库链接）。
2. 静默安装 `dsh-setup.exe /S`：跳过全部页面直接装完；同版本 overlay 与覆盖升级保留用户数据（QA TC-INST-009/012、dshbot smoke 依赖）。
3. 卸载（设置 → 应用 / 开始菜单）：品牌化卸载向导，灰阶侧栏区分移除语境；不删 `userData`（桌面 dsh-home、会话都在那里）。

## Invariants

- `oneClick: false`、`allowToChangeInstallationDirectory: true`、桌面 + 开始菜单快捷方式、artifact 名 `Deepseek-Harness-Desktop-Setup-${version}.exe` 不得变——release.yml globs、SHA512SUMS、桌面更新器都按这个名字找包。
- `/S` 静默安装必须保持可用。`build/installer.nsh` 只允许 `customWelcomePage` / `customUnWelcomePage` / `customHeader` 三个 GUI 宏 + 一个窄范围的 `customInit` 注册表净化块（见下条）；禁止 MessageBox、Section、RequestExecutionLevel、ExecWait、customInstall 等影响安装语义的内容。`customUnWelcomePage` 是纯页面声明（替换 electron-builder 模板里的裸 `MUI_UNPAGE_WELCOME` 插入点），必须自己重插 `MUI_UNPAGE_WELCOME` 并重定义 `MUI_WELCOMEPAGE_TITLE_3LINES`——MUI2 每插一页就 UNSET 欢迎页设置，安装侧的 define 到不了卸载器，否则卸载欢迎页标题第三行（「…Uninstall」）被裁。
- `customInit` 注册表净化（2026-09-12 事故修复）：在 `.onInit` 内 `initMultiUser` 之后、页面/区段之前运行——**含静默路径，这是有意为之**（坏记录恰恰在 `/S` 升级时造成破坏）。记录存活的条件 = 绝对路径（`X:\`/`\\`，含引号包裹形态）**且** 文件还在盘上：`InstallLocation` 要求 `<dir>\${APP_EXECUTABLE_FILENAME}` 存在，`UninstallString` 要求引号内卸载器存在（`Call GetInQuotes`/`GetFileParent`——它们是 installUtil.nsh 的 Function，`Call` 目标编译期可解析，但其 `!macro` 包装在 .onInit 后才定义，不能直接 `!insertmacro`）。死记录删除：`InstallLocation` 删值、`UninstallString` 死 → 删整个卸载子键。`$INSTDIR` 按序重算：显式 `/D` > 活 `InstallLocation` > 活卸载器父目录（升级回原目录）> `$LocalAppData\Programs\${APP_FILENAME}`；末尾绝对性兜底同时挡掉 mangled `/D`（drive-relative 复位到默认，不落幻影目录）。不得在此宏里加 UI、exec、网络或其它逻辑。
- 默认 per-user 安装（`%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop`，TC-INST-013 依赖）；不设 `perMachine`，不设 `deleteAppDataOnUninstall`。
- 位图是经典 24 位无压缩 BMP，几何固定：sidebar 164×314、header 150×57。改品牌图先改 `scripts/render-installer-assets.js` 再 `npm run installer:assets` 重新生成，禁止手改二进制或另起配色——色板是官方浅色表（`src/shared/dsh-webui-tokens.css`）的构建期镜像，与启动器同源：侧栏底 `--dsw-specific-sidebar-fill` `rgb(249,250,251)`、画布 `--dsw-alias-bg-base` 白、文字 `--dsw-alias-label-primary/secondary/tertiary`、强调仅细线用 `--dsw-static-deepseek-500` `rgb(65,118,230)`、发丝线 `rgba(0,0,0,.10)`。禁止近黑营销面板（icon-tile `#0b0d12` 第二皮肤）、禁止 `--boot-*` 仪器画布扩散进安装器；卸载侧栏是同一浅色构图的灰阶弱化版。
- 安装器语言 zh_CN（首位 = 兜底）+ en_US；产品中文文案走 MUI 本地化串，不烙进位图。
- 许可页读根 `LICENSE`（MIT）原文。
- 安装器/卸载器图标 = `assets/icon.ico`（与应用同一鲸标）。
- 发布链产物验收：windows job 的 packaged smoke 门禁（`smoke:packaged` on `dist/win-unpacked`）位于 `npm run dist` 之后、artifact 上传之前，**阻断**发版；步骤内置两次尝试（连续两次失败=真问题），不设 `continue-on-error`。`workflow_dispatch` 默认只构建 Windows；macOS 仅在显式 `include_macos=true` 时构建。本版 Windows 发布不上传 DMG。不得把该步骤改造成重复 test.yml 的质量门（`npm test` / `test:gui` 仍禁止进 release.yml）。
- 发布晋级必须使用 `.github/workflows/publish.yml`：仅接受 `release.yml` 在 `main` 分支的成功候选运行，核对同一 SHA 的 Desktop tests、Setup SHA256 与版本化文件名，从该运行下载原始资产并生成 `SHA512SUMS.txt` / provenance；晋级步骤不得重新执行 `setup-harness` 或 `npm run dist`。

## Allowed touch

- `package.json` 的 `build.nsis` / `build.win` — 安装器配置
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
| Automated | `node --test src/main/installer-branding.test.js src/main/ci-isolation.test.js`（随 `npm test`）：nsis 契约、BMP 几何/位深、nsh 宏白名单、release.yml glob 对齐；手动候选默认 Windows-only；packaged smoke 位于 dist 后、上传前，两次尝试且无 `continue-on-error`；publish.yml 只晋级 main 同 SHA 候选、校验 Setup 版本名 / SHA256 并禁止重建；release CI 实跑 `smoke:packaged`（win-unpacked 实启 + 内嵌 DSH_SMOKE 断言，阻断发版） |
| Manual / QA | `TC-INST-001`（GUI 安装走查）、`TC-INST-009`（`/S` 覆盖升级）、`TC-INST-010`（卸载）、`TC-INST-012/013` in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md)；每次改品牌位图后对 CI windows artifact 目检欢迎/许可/目录/完成/卸载五页——实机执行清单（artifact 下载/SHA256/逐页 checklist/zh_CN）固化在 [TC-INST-RUNBOOK.md](../qa/results/2026-08-25/installer-branding/TC-INST-RUNBOOK.md) |

## Sources

- Design: [design-language.md](../design-language.md)（官方浅色表 / 品牌蓝仅强调 / 鲸标；安装器 chrome 对齐「桌面启动器」一节，不是启动页仪器画布），[dsh-webui-tokens.css](../../src/shared/dsh-webui-tokens.css)，`assets/whale.svg`
- Spec: electron-builder NSIS 选项（assisted installer 默认无欢迎页、默认 `nsis3-metro.bmp` 侧栏——本卡替换为品牌资产）
- Implementation entry: `package.json` `build.nsis`、`build/installer.nsh`、`scripts/render-installer-assets.js`

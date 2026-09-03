# Feature: Windows 安装器（NSIS 品牌化）

| Field | Value |
| --- | --- |
| **id** | `windows-installer` |
| **status** | `active` |
| **last verified** | 2026-09-03 — **实机首启「未响应」修复**：alpha.4 安装包装后首启，Windows 弹出「Deepseek-Harness-Desktop 未响应」（WER `AppHangTransient` 08:05:29）。取证：启动链上两处主线程同步 IO——`usage-panel-preset` 每次全量启动 `fs.cpSync` 约 6k 文件的插件包（实机 11.4 s，空载复测 4.5 s），以及 `harness-extract` 覆盖/升级安装时 `fs.rmSync` 上一份约 57k 文件的 `runtime/<version>`（空载复测 16 s，实机窗口 46 s）——都超过 Windows 5 s 挂起阈值。修复：插件包改 `fs.promises.cp` 增量复制（size+mtime 相同即跳过，保留时间戳）；旧运行时改 rename 到 `runtime/<version>.stale-*` 后台异步删除，启动时清扫上次未删完的残留；tar 解压本就是异步子进程。静态断言钉死两处不得回退到 `cpSync`/`rmSync`。`npm test` 1466 通过 / 2 skip。此前本轮 alpha.4：本地 NSIS 安装包已生成并通过 packaged P0；未发布。此前 2026-08-26 — D4 发布链验收：release.yml windows job 在 `npm run dist` 与 artifact 上传之间新增**阻断式** packaged smoke 门禁（`npm run smoke:packaged` 实启 `dist/win-unpacked`，两次尝试吸收单次 flake，策略写进 workflow 注释；macos job 保持 best-effort 无 smoke）；该步骤是**产物验收**而非重复 test.yml 质量门（smoke 需要 dist 产物，只能存在于发布链），推翻 d9481ce7 的「release 不跑 smoke:packaged」钉子，新位置由 `ci-isolation.test.js` 钉死（dist 之后、上传之前、含重试、无 continue-on-error）。**首个 tag 前须经 `workflow_dispatch` 手动跑一轮 windows job 验证该步骤本身（本轮在 Linux VM 上未实跑 Windows smoke，不作已验证声称）。** 此前 2026-08-25 — 第三轮：`customUnWelcomePage` 修复卸载欢迎页 3 行标题裁字（契约决策 A，机制核对到 MUI2 源码；wine+Xvfb 修后截图见 [QA 证据](../qa/results/2026-08-25/installer-branding/EXECUTION-REPORT.md)），门禁 8/8、`npm test` 全绿；完成页/真实 `/S`/zh_CN 仍待 CI windows artifact 实机走查，清单固化在 [TC-INST-RUNBOOK.md](../qa/results/2026-08-25/installer-branding/TC-INST-RUNBOOK.md)（workflow dispatch 云代理 403，须人触发） |

## User paths

1. 双击 Setup（GUI）：欢迎页（品牌侧栏：官方浅色侧栏底 `rgb(249,250,251)` + 近黑鲸标 + 产品名 `Deepseek-Harness-Desktop` + 细蓝强调线 + 右缘发丝线，MUI 本地化中文/英文文案）→ MIT 许可页 → 安装模式/目录选择（可改目录）→ 安装进度（右上白底近黑鲸标 header）→ 完成页（默认勾选「运行 Deepseek-Harness-Desktop」+ 产品仓库链接）。
2. 静默安装 `dsh-setup.exe /S`：跳过全部页面直接装完；同版本 overlay 与覆盖升级保留用户数据（QA TC-INST-009/012、dshbot smoke 依赖）。
3. 卸载（设置 → 应用 / 开始菜单）：品牌化卸载向导，灰阶侧栏区分移除语境；不删 `userData`（桌面 dsh-home、会话都在那里）。

## Invariants

- `oneClick: false`、`allowToChangeInstallationDirectory: true`、桌面 + 开始菜单快捷方式、artifact 名 `Deepseek-Harness-Desktop-Setup-${version}.exe` 不得变——release.yml globs、SHA512SUMS、桌面更新器都按这个名字找包。
- `/S` 静默安装必须保持可用。`build/installer.nsh` 只允许 `customWelcomePage` / `customUnWelcomePage` / `customHeader` 三个 GUI 宏；禁止 MessageBox、Section、RequestExecutionLevel、customInstall/customInit 等会影响静默/升级路径的内容。`customUnWelcomePage` 是纯页面声明（替换 electron-builder 模板里的裸 `MUI_UNPAGE_WELCOME` 插入点），必须自己重插 `MUI_UNPAGE_WELCOME` 并重定义 `MUI_WELCOMEPAGE_TITLE_3LINES`——MUI2 每插一页就 UNSET 欢迎页设置，安装侧的 define 到不了卸载器，否则卸载欢迎页标题第三行（「…Uninstall」）被裁。
- 默认 per-user 安装（`%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop`，TC-INST-013 依赖）；不设 `perMachine`，不设 `deleteAppDataOnUninstall`。
- 位图是经典 24 位无压缩 BMP，几何固定：sidebar 164×314、header 150×57。改品牌图先改 `scripts/render-installer-assets.js` 再 `npm run installer:assets` 重新生成，禁止手改二进制或另起配色——色板是官方浅色表（`src/shared/dsh-webui-tokens.css`）的构建期镜像，与启动器同源：侧栏底 `--dsw-specific-sidebar-fill` `rgb(249,250,251)`、画布 `--dsw-alias-bg-base` 白、文字 `--dsw-alias-label-primary/secondary/tertiary`、强调仅细线用 `--dsw-static-deepseek-500` `rgb(65,118,230)`、发丝线 `rgba(0,0,0,.10)`。禁止近黑营销面板（icon-tile `#0b0d12` 第二皮肤）、禁止 `--boot-*` 仪器画布扩散进安装器；卸载侧栏是同一浅色构图的灰阶弱化版。
- 安装器语言 zh_CN（首位 = 兜底）+ en_US；产品中文文案走 MUI 本地化串，不烙进位图。
- 许可页读根 `LICENSE`（MIT）原文。
- 安装器/卸载器图标 = `assets/icon.ico`（与应用同一鲸标）。
- 发布链产物验收：windows job 的 packaged smoke 门禁（`smoke:packaged` on `dist/win-unpacked`）位于 `npm run dist` 之后、artifact 上传之前，**阻断**发版；步骤内置两次尝试（连续两次失败=真问题），不设 `continue-on-error`；macos job 不加 smoke（best-effort 政策不变）。不得把该步骤改造成重复 test.yml 的质量门（`npm test` / `test:gui` 仍禁止进 release.yml）。

## Allowed touch

- `package.json` 的 `build.nsis` / `build.win` — 安装器配置
- `build/` — `installer.nsh` 与生成的 BMP
- `scripts/render-installer-assets.js`、`scripts/run-render-installer-assets.js` — 位图生成
- `src/main/installer-branding.test.js` — 自动门禁
- `.github/workflows/release.yml` windows job 的 packaged smoke 步骤与 `src/main/ci-isolation.test.js` 对应钉子（2026-08-26 扩入，理由：发布链产物验收属本卡；上传 globs / SHA512SUMS 流仍在 Do not touch）
- 本卡与 [build-release handbook](../handbook/modules/build-release.md)

## Do not touch

- `scripts/after-pack.js` 装配逻辑、SHA512SUMS / 更新器校验流
- artifact 命名与 `release.yml` 上传 globs
- mac DMG 配置（次要产物，独立演进）

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/installer-branding.test.js`（随 `npm test`）：nsis 契约、BMP 几何/位深、nsh 宏白名单、release.yml glob 对齐；`ci-isolation.test.js` 钉 packaged smoke 门禁位置（dist 后、上传前、两次尝试、无 continue-on-error）；release CI 实跑 `smoke:packaged`（win-unpacked 实启 + 内嵌 DSH_SMOKE 断言，阻断发版） |
| Manual / QA | `TC-INST-001`（GUI 安装走查）、`TC-INST-009`（`/S` 覆盖升级）、`TC-INST-010`（卸载）、`TC-INST-012/013` in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md)；每次改品牌位图后对 CI windows artifact 目检欢迎/许可/目录/完成/卸载五页——实机执行清单（artifact 下载/SHA256/逐页 checklist/zh_CN）固化在 [TC-INST-RUNBOOK.md](../qa/results/2026-08-25/installer-branding/TC-INST-RUNBOOK.md) |

## Sources

- Design: [design-language.md](../design-language.md)（官方浅色表 / 品牌蓝仅强调 / 鲸标；安装器 chrome 对齐「桌面启动器」一节，不是启动页仪器画布），[dsh-webui-tokens.css](../../src/shared/dsh-webui-tokens.css)，`assets/whale.svg`
- Spec: electron-builder NSIS 选项（assisted installer 默认无欢迎页、默认 `nsis3-metro.bmp` 侧栏——本卡替换为品牌资产）
- Implementation entry: `package.json` `build.nsis`、`build/installer.nsh`、`scripts/render-installer-assets.js`

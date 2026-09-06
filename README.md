<p align="center">
  <img src="assets/icon.png" width="88" alt="Deepseek-Harness-Desktop" />
</p>

<h1 align="center">Deepseek-Harness-Desktop</h1>

<p align="center">
  把官方 DeepSeek Harness Web UI 装进桌面的社区客户端<br />
  下载安装即可使用，不用自己起 <code>dsh web</code>
</p>

<p align="center">
  中文 · <a href="README.en.md">English</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest">下载</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>
</p>

<p align="center">
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest"><img src="https://img.shields.io/github/v/release/ChisaAlter/Deepseek-Harness-Desktop" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChisaAlter/Deepseek-Harness-Desktop" alt="License" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0A66C2" alt="Windows x64" />
</p>

<p align="center">
  <img src="assets/screenshot-home.jpg" alt="主界面" width="920" />
</p>

## 安装

到 [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest) 下载，装完不需要本机 Node。当前正式版是 **[0.2.9](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9)**，发布于 **2026-09-06**，本次仅提供 Windows x64 安装包。`0.2.8` 未对外发布。

| | |
| --- | --- |
| Windows x64 | [Deepseek-Harness-Desktop-Setup-0.2.9.exe](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/download/v0.2.9/Deepseek-Harness-Desktop-Setup-0.2.9.exe) |
| macOS、Linux、Android | 本版不提供安装包；桌面源码运行条件见[下文](#从源码运行) |

Windows 安装器未做 Authenticode 签名。请从本仓库下载，并按同页的 [SHA512SUMS.txt](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/download/v0.2.9/SHA512SUMS.txt) 核对文件。旧 macOS 包仍在历史 Release 中，不包含 0.2.9 的修复。

装完打开即是启动器，一般会自动进桌面；若桌面还没有会话、本机已有官方 `~/.dsh` 数据，会先停在导入。进主界面后选工作区，在设置里填 API 密钥即可对话。

## 0.2.9 更新

- **Harness `0.1.2-rc.1`**：源码和安装包使用同一官方基线，恢复归档、消息就地编辑及工作区接口。
- **历史会话与启动恢复**：启动时补回仍登记目录遗漏的普通及已归档历史，保留原成员顺序和归档状态；兼容旧投影缓存自动备份并冷重建。
- **识图和工具调用**：修复识图兜底的请求消费与描述复用，恢复非法工具调用校验、重试和旧历史修复。
- **内置设置模块**：用量统计与插件市场随桌面内置，新增透明主题、会话累计费用和更一致的设置控件。
- **文件与界面**：修复文件搜索截断漏检、旧 Web UI 页面缓存、侧栏折叠动画及输入框边光。
- **远程连接**：未配置时默认服务器模式，局域网可手选；修复配对重试、重连、目录同步及远程 SQLite 运行时兼容问题。
- **dshbot 独立化**：不再随桌面内置或推荐；保留用户安装及数据，由通用插件管理负责禁用和恢复。

完整说明见 [Release Notes](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9)（[中文源文件](.github/release-notes.md) / [English](.github/release-notes.en.md)）。CI 与打包冒烟已通过；本次按维护者明确授权发布，完整新包实机 P0 验收仍未完成，不将未测项记为通过。见[发布记录](docs/qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)。

## 升级注意

**旧版 dshbot 可能不兼容新版 Harness。** 若它阻止启动，请在启动器的插件排查中单独禁用；不要删除插件文件、机器人配置、记忆或会话。

> [!CAUTION]
> **从官方 CLI 或早于 0.2.7 的版本迁移，不会自动带上旧对话。** 请先完全退出应用（托盘也要退），再进入 **启动器 → 导入**。不要拷 `profiles` 或用旧 SQLite 会话库直接覆盖桌面数据。
>
> 已使用 0.2.7 桌面 `dsh-home` 的用户可覆盖安装 0.2.9，保留现有桌面数据。导入后打开原工作区路径；无目录会话在「无工作区」中。

启动器不可用时的 Windows PowerShell 兜底：

```powershell
$old = "$env:USERPROFILE\.dsh"
$new = "$env:APPDATA\Deepseek-Harness-Desktop\dsh-home"
Copy-Item "$old\sessions\*" "$new\sessions\" -Recurse -Force
if (Test-Path "$old\attachments") {
  Copy-Item "$old\attachments\*" "$new\attachments\" -Recurse -Force
}
```

macOS 源码运行时，把 `$HOME/.dsh/sessions` 拷到 `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home/sessions`（附件同理）。拷完后打开**当时聊天用的工作区路径**；本版不提供 macOS 安装包。

Windows 用户若仍见 `Unable to load libghostty-vt (404)`，或装过 0.2.4 / 0.2.5，请改装 0.2.9。

## 功能

- **官方界面** — 对话、工具调用、审批就是 `dsh web`，没有另做一套聊天页。
- **启动器** — 冷启动先开启动器（更新询问、导入、版本、插件问诊）；托盘可随时再打开。
- **Git** — 标题栏切分支、提交、推送、开变更请求。
- **远程** — 手动开启后扫码连接同一会话；未配置时默认服务器模式，局域网可手选。手机 Web 与 Android 未纳入本版实机放行范围，APK 不随本版交付。
- **文件与终端** — `Ctrl+\` 打开右栏（Files / Diff / Browser / Agents）；`` Ctrl+` `` 打开底栏终端，选区可送进对话。
- **模型** — 第三方思考强度、识图兜底；最新一条用户消息可改完再发。
- **外观** — 浅色 / 深色与透明主题。壁纸在外观里选或点「浏览」打开图库（分类、搜索、收藏，确认后按窗口比例裁切）；毛玻璃和像素化也在外观里调。
- **扩展** — 设置里管理 MCP、技能和插件。市场是桌面自有的设置分区（内置精选目录与安装引擎，源自 [dsh-market](https://github.com/dsh-market/dsh-market) 的产品形态但已与上游分离），没有独立窗口。
- **用量统计**：设置内置跨会话 Token 统计、热力图与导出；不需要另装统计插件。
- **桌面壳** — 关闭进托盘、自动更新；Harness 挂了会回到故障页并自动重启。用户插件把启动弄挂时，启动器可以按包禁用或先跳过用户插件。

`Ctrl+,` 打开设置。

<table>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-surfaces.jpg" alt="对话与右栏" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-wallpaper.jpg" alt="背景图" /></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-themes.jpg" alt="外观主题" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-appearance.jpg" alt="外观设置" /></td>
  </tr>
</table>

## 数据目录

桌面 Harness **不读** 官方 CLI 的 `~/.dsh`。会话、设置、市场插件在应用数据目录的 `dsh-home`：

| | |
| --- | --- |
| Windows | `%APPDATA%\Deepseek-Harness-Desktop\dsh-home` |
| macOS | `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home` |
| 插件 | `dsh-home/profiles/web` |

工作区路径和壳层 API key 在上一层目录的 `config.json` / `credentials.json`。底栏终端里自己跑的官方 `dsh` 仍用 `~/.dsh`。

## 从源码运行

需要 Windows 10+ 或 macOS 14+（Apple Silicon），Node 22.19+ / 24+，pnpm 11。

```powershell
git clone https://github.com/ChisaAlter/Deepseek-Harness-Desktop.git
cd Deepseek-Harness-Desktop
npm install
npm run setup:harness
npm start
```

第一次 `setup:harness` 会构建随仓库提供的 `vendor/deepseek-harness`，比较慢。安装版和源码启动会互相抢锁，开发前先退出已安装的应用。

## 开发

改界面请改 `vendor/deepseek-harness`，并遵守 [设计语言](docs/design-language.md) 和 [动效](docs/motion.md)。产品蓝图、流程与模块入口见 [产品手册](docs/handbook/README.md)；改行为契约见 [Feature Spine](docs/features/README.md)。改完客户端源码后，在该目录执行 `pnpm run build:official` 再重启桌面端（与官方 `dsh web` 发版同一条命令；不要只跑 `build:lib:client`，否则侧栏会退回「DSH 本地构建」）。

当前官方基线写在 `vendor/harness-upstream.json`，现为 `0.1.2-rc.1`（`dsh-v0.1.2-rc.1` / `a66e4702047846cdaa10c66c9d3df3951f5ea70d`）。npx 兜底是官方 `@deepseek-ai/dsh@0.1.2-rc.1`，该版本已发布到 npm。不含标题栏、Git、右栏 surfaces 和底栏终端的部分仍只在源码启动和安装包路径里。安装包 0.2.9 起与源码同钉 `0.1.2-rc.1`；已发布的 0.2.7 及更早仍钉 `0.1.1-rc.1`，升级后对齐。

```powershell
npm test              # 桌面壳单测
npm run sync:harness -- --ref dsh-v0.1.2-rc.1 --sha a66e4702047846cdaa10c66c9d3df3951f5ea70d
npm run dist          # Windows 安装包
npm run dist:mac      # macOS 安装包（须在 macOS 上）
```

发布使用 `workflow_dispatch` 先构建候选，默认只构建 Windows；同一源码 SHA 的 Desktop tests、打包冒烟通过后，按仓库规则完成[生产验收及必要的书面豁免](docs/qa/production-acceptance-test-cases.md)，再晋级同一批产物。不要直接推 `v*` 标签代替该流程：现有 tag-push 工作流会重新构建并自动发布，也可能构建 macOS。本机 `npm run dist` 不能当实机验收的 Pass。0.2.9 的单次维护者发布授权、固定源码 SHA、CI 与文件摘要见[发布记录](docs/qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)；该授权不改变通用验收门槛，也不等于未测项通过。

发布草稿自动创建标签时，现有 tag-push 工作流同样会启动；晋级固定产物后须检查并取消重复构建，再核验正式 Release 的资产未变。0.2.9 已完成该核对。

## 交流

<p align="center">
  <img src="assets/wechat-group.png" alt="微信交流群二维码" width="240" />
</p>

微信扫码进群。邀请码大约每周过期一次；扫不进请开 [Issue](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues)。Issue 和 PR 也欢迎。感谢 [Linux.do](https://linux.do)。

## 许可证

[MIT](LICENSE)

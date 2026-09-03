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
  <img src="https://img.shields.io/badge/macOS-arm64-111111" alt="macOS arm64" />
</p>

<p align="center">
  <img src="assets/screenshot-home.jpg" alt="主界面" width="920" />
</p>

## 安装

到 [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest) 下载，装完不需要本机 Node。当前正式版是 **[0.2.7](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.7)**。

| | |
| --- | --- |
| Windows x64 | `Deepseek-Harness-Desktop-Setup-0.2.7.exe` |
| macOS Apple Silicon | `Deepseek-Harness-Desktop-0.2.7-mac-arm64.dmg` |
| Intel Mac、Linux | [从源码运行](#从源码运行) |

macOS 安装包未签名：下载后右键打开，或执行 `xattr -cr /Applications/Deepseek-Harness-Desktop.app`。校验见同页 `SHA512SUMS.txt`。

装完打开即是启动器，一般会自动进桌面；若桌面还没有会话、本机已有官方 `~/.dsh` 数据，会先停在导入。进主界面后选工作区，在设置里填 API 密钥即可对话。

## 0.2.7 更新

- **冷启动启动器** — 先开启动器再启桌面：查正式版、导入官方数据、版本页、插件 Recovery Board；可「关闭桌面端」而不退出应用。
- **独立家目录** — 会话、设置、市场插件只在应用数据下的 `dsh-home`，不读、不迁、不改官方 CLI 的 `~/.dsh`。
- **Harness `0.1.1-rc.1`** — 安装包钉官方 `dsh-v0.1.1-rc.1`。
- **终端资源** — Ghostty wasm / 字体打进安装包；源码启动缺资源则拒绝启动。
- **识图与网关** — 自定义网关不再误写官方 `DEEPSEEK_*`；主模型不识图时走官方兜底。

完整说明见 [Release Notes](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.7)。

> [!CAUTION]
> **升级后不会自动带上旧对话，侧栏可能是空的。** 请先完全退出应用（托盘也要退）。推荐冷启动进入 **启动器 → 导入**。不要拷 `profiles`。旧 rc 的 SQLite 会话库与本版不兼容，不要硬开。

启动器不可用时的 Windows PowerShell 兜底：

```powershell
$old = "$env:USERPROFILE\.dsh"
$new = "$env:APPDATA\Deepseek-Harness-Desktop\dsh-home"
Copy-Item "$old\sessions\*" "$new\sessions\" -Recurse -Force
if (Test-Path "$old\attachments") {
  Copy-Item "$old\attachments\*" "$new\attachments\" -Recurse -Force
}
```

macOS 把 `$HOME/.dsh/sessions` 拷到 `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home/sessions`（附件同理）。拷完后打开**当时聊天用的工作区路径**。

若终端仍见 `Unable to load libghostty-vt (404)`，或装过 0.2.4 / 0.2.5，请改装 0.2.7。

## 功能

- **官方界面** — 对话、工具调用、审批就是 `dsh web`，没有另做一套聊天页。
- **启动器** — 冷启动先开启动器（更新询问、导入、版本、插件问诊）；托盘可随时再打开。
- **Git** — 标题栏切分支、提交、推送、开变更请求。
- **远程** — 侧栏底部打开远程，扫码用手机浏览器接同一会话（默认关）。
- **文件与终端** — `Ctrl+\` 打开右栏（Files / Diff / Browser / Agents）；`` Ctrl+` `` 打开底栏终端，选区可送进对话。
- **模型** — 第三方思考强度、识图兜底；最新一条用户消息可改完再发。
- **外观** — 浅色 / 深色主题。壁纸在外观里选或点「浏览」打开图库（分类、搜索、收藏，确认后按窗口比例裁切）；毛玻璃和像素化也在外观里调。
- **扩展** — 设置里管理 MCP、技能和插件。市场是桌面自有的设置分区（内置精选目录与安装引擎，源自 [dsh-market](https://github.com/dsh-market/dsh-market) 的产品形态但已与上游分离），没有独立窗口。
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

推送与 `package.json` 一致的 `v*` 标签，GitHub Actions 会出 Windows 和 macOS 安装包。对外发布前必须对 **CI windows artifact**（与即将上传的 Setup 同一 SHA）走完 [生产验收表](docs/qa/production-acceptance-test-cases.md)；本机 `npm run dist` 不能当那张表的 Pass。

## 交流

<p align="center">
  <img src="assets/wechat-group.png" alt="微信交流群二维码" width="240" />
</p>

微信扫码进群。邀请码大约每周过期一次；扫不进请开 [Issue](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues)。Issue 和 PR 也欢迎。感谢 [Linux.do](https://linux.do)。

## 许可证

[MIT](LICENSE)

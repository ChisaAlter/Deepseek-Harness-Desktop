<p align="center">
  <img src="assets/icon.png" width="88" alt="Deepseek-Harness-Desktop" />
</p>

<h1 align="center">Deepseek-Harness-Desktop</h1>

<p align="center">
  基于 DeepSeek Harness 的开源桌面客户端<br />
  在同一个窗口里与 AI 对话、浏览项目、运行终端和管理 Git。
</p>

<p align="center">
  中文 · <a href="README.en.md">English</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest">下载</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases">更新日志</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues">反馈问题</a>
</p>

<p align="center">
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest"><img src="https://img.shields.io/github/v/release/ChisaAlter/Deepseek-Harness-Desktop" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChisaAlter/Deepseek-Harness-Desktop" alt="License" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0A66C2" alt="Windows x64" />
</p>

<p align="center">
  <img src="assets/screenshot-home.jpg" alt="Deepseek-Harness-Desktop 主界面" width="920" />
</p>

本项目由社区独立维护，非 DeepSeek 官方客户端。沿用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的对话界面，并提供桌面集成；安装后无需自行配置 Node.js 或启动 `dsh web`。

## 功能

- **AI 对话**：管理工作区与历史会话，查看工具调用、确认操作审批，编辑并重新发送消息。
- **项目工具**：搜索和编辑文件、查看代码差异、预览网页，将文件或终端选区加入对话。
- **集成终端与 Git**：在应用内运行命令，切换分支、提交更改、推送代码及创建 Pull Request。
- **模型与扩展**：配置模型服务，在设置中管理 MCP、技能和插件，通过内置市场安装扩展。
- **用量统计**：查看跨会话 Token 用量、热力图和会话费用，支持导出统计数据。
- **个性化外观**：浅色、深色与透明主题，配合壁纸图库、毛玻璃和像素化效果。
- **远程访问**：按需开启远程连接，通过扫码在手机浏览器访问桌面会话。
- **桌面集成**：托盘驻留、应用更新，以及启动器中的数据导入和插件故障排查。

<table>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-surfaces.jpg" alt="对话、文件与代码差异" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-wallpaper.jpg" alt="自定义壁纸" /></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-themes.jpg" alt="外观主题" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-appearance.jpg" alt="外观设置" /></td>
  </tr>
</table>

## 下载与安装

| 平台 | 下载 |
| --- | --- |
| Windows 10 及以上 · x64 | [下载最新公开版](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest) |

本版仅提供 Windows 安装包。其他版本与更新说明见 [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases)。

> [!NOTE]
> Windows 安装包尚未进行数字签名，系统可能显示安全提示。请仅从本仓库下载；发布页提供 `SHA512SUMS.txt` 供核对文件完整性。

### 开始使用

1. 安装并打开应用，等待启动器进入主界面。
2. 在设置中配置模型服务与 API 密钥。
3. 选择项目目录作为工作区，或新建无工作区会话，开始对话。

如果你使用过官方 CLI，可在启动器的「导入」页面选择需要迁移的数据。

## 常见问题

### 需要自己准备 API 密钥吗？

需要配置所使用模型服务的 API 密钥。本项目不提供模型额度，调用费用由对应服务商收取。

### 如何升级？

应用启动时会检查更新，也可以下载新版安装包覆盖安装。已使用 0.2.7 桌面版的用户可保留现有数据升级；升级前建议备份数据目录。

从官方 CLI 或早于 0.2.7 的版本迁移，请使用启动器的「导入」，不要直接覆盖数据库或复制整个 `profiles` 目录。导入后重新添加原来的工作区路径即可查找对应会话。

### 数据保存在哪里？

桌面端使用独立的数据目录，不会直接读取官方 CLI 的 `~/.dsh`。可在「设置 → 关于 → 打开运行目录」中查看。

| 平台 | 会话与设置目录 |
| --- | --- |
| Windows | `%APPDATA%\Deepseek-Harness-Desktop\dsh-home` |
| macOS（源码运行） | `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home` |

### 安装插件后无法启动怎么办？

在启动器的插件排查中禁用出错插件，再重新启动。旧版 dshbot 可能与新版 Harness 不兼容，也可用此方式单独禁用，无需删除配置或会话。

## 从源码运行

开发环境：Windows 10+ 或 macOS 14+（Apple Silicon），Node.js 22.19+（22.x）或 24+，pnpm 11。

```shell
git clone https://github.com/ChisaAlter/Deepseek-Harness-Desktop.git
cd Deepseek-Harness-Desktop
npm install
npm run setup:harness
npm start
```

首次运行会构建仓库内的 Harness，耗时较长。源码版与安装版共用单实例锁，启动前请先退出已安装的应用，包括托盘进程。

```shell
npm test          # 桌面单元测试
npm run dist      # 构建 Windows 安装包
npm run dist:mac  # 构建 macOS 安装包，需在 macOS 上运行
```

## 参与贡献

欢迎提交 Issue 和 Pull Request，参与功能开发、问题修复或文档改进。报告问题时，请附上应用版本、操作系统、复现步骤和必要截图，并移除日志中的密钥等敏感信息。

- [产品与架构手册](docs/handbook/README.md)
- [界面设计规范](docs/design-language.md) · [动效规范](docs/motion.md)
- [功能契约](docs/features/README.md)
- [构建与发布指南](docs/handbook/modules/build-release.md)

## 社区

<p align="center">
  <img src="assets/wechat-group.png" alt="微信交流群二维码" width="240" />
</p>

欢迎扫码加入微信交流群。二维码失效时，请通过 [Issue](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) 联系维护者。

## 致谢

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供基础能力，以及 [Linux.do](https://linux.do) 社区的支持。

## 许可证

[MIT](LICENSE)

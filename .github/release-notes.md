# Deepseek-Harness-Desktop 0.3.1

把 DeepSeek Harness 带到 Windows 桌面：在一个本地窗口里完成对话、文件处理、网页预览、终端操作和 Git 工作流。

## 这次更新

- **Browser mini-player**：网页预览可以切换为聊天区域内的浮层，支持拖拽和八方向缩放；恢复后保留当前页面和历史记录。
- **工作区工作流**：Files、Browser、Diff、终端和 Git 围绕当前工作区协作，文件和终端选区可以直接加入对话。
- **启动器与恢复**：改进冷启动、插件排查、数据导入和更新流程；内置的用量统计、消息渠道和市场入口保持可用。
- **模型与扩展**：设置中可以管理模型服务、MCP、技能和插件，并从内置市场查看和安装扩展。
- **运行时可靠性**：修复工具调用校验、畸形响应重试、会话投影恢复、终端布局和多个桌面交互边界。
- **安装包可靠性**：修复 Windows 打包时依赖运行时文件被过滤的问题，确保安装版可以加载完整的 Harness 依赖。
- **Harness 基线**：桌面客户端与安装包使用同一套固定的 DeepSeek Harness 基线。

## 技术契约

- 安装版 Browser 交付 `dshd mini-player` P0 路径：复用同一 Browser guest / `previewId`，挂到聊天可视区内的 renderer 浮层，支持标题栏拖拽与八方向缩放；恢复后保留当前 URL 与 history。
- mini-player 只迁移 guest 的呈现边界，不创建第二个 BrowserView、外部窗口或 mini 专用 IPC。

## 安装与升级

当前公开安装包为 Windows 10 及以上 x64。请从 [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) 下载，并用随附的 `SHA512SUMS.txt` 校验文件完整性。安装器未进行 Authenticode 签名，Windows 可能显示安全提示。

已有桌面安装可以直接覆盖升级。若要从官方 CLI 或其他旧环境迁移，请在启动器中使用「导入」，不要直接复制整个 `profiles` 目录。dshbot 已回归桌面内置并随包发布：Bots 页签默认出现，旧预置的受管装载会在首次启动时自动迁移，机器人设置、记忆、房间 preset 与会话全部保留。

## 平台范围

本次公开资产为 Windows x64 安装包。macOS、Android 和 Web 第二客户端不包含在这批 Windows 安装资产中；远程访问需要用户主动开启配对。

## 验证范围

Windows 候选已通过同一提交的桌面测试、安装包构建和 packaged smoke，并在晋级时重新校验了候选 Setup 的 SHA256。完整安装版手工验收尚未全部执行，未执行的路径不在本公告中宣称为已验证能力。

## 反馈

请通过 [Issues](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) 报告问题，并附上操作系统、复现步骤和相关日志。分享日志前请移除 API 密钥等敏感信息。

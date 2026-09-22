# Deepseek-Harness-Desktop 0.3.2

中文 | [English](release-notes.en.md)

把 DeepSeek Harness 带到 Windows 桌面：在一个本地窗口里完成对话、文件处理、网页预览、终端操作和 Git 工作流。

## 这次更新

- **终端透明度**：外观新增独立滑杆（40–100，默认 75），终端井可以按自己的实心度透出壁纸或流动渐变，不跟随玻璃滑杆；低于默认值时设置页提示 TUI 选中行可读性，不做强制钳制。Trajectory 等标签页同样改透明画布，背景可以到达这些区域。
- **按钮悬停光泽开关**：界面设置新增「按钮悬停光泽 / Button sheen」开关（默认关）；默认状态下按钮悬停只剩原本的填充效果，打开后恢复金属扫光。
- **桌宠常驻通知**：whale_notify 推送的重要消息在桌宠气泡上钉住并带关闭按钮，只有手动关闭才退场，期间新气泡排队不顶替；「看看」的成功结果同样常驻显示。
- **长会话周期性卡顿修复**：桌宠成长值的会话日志扫描移出主进程到 worker 线程——此前每 60 秒的重扫在大语料会话上会让所有窗口与 IPC 冻结数秒，现在只占后台线程。
- **增量更新**：启动器升级改走 electron-updater 的 NSIS blockmap 通道——不变的分块直接复用本地副本，只有变化的块经 HTTP Range 下载，更新不再每次拉取约 636 MB 的完整安装包；增量下载时进度条会标注。增量通道失败自动回退到整包校验下载。
- **品牌徽标换新**：应用图标、窗口/任务栏、托盘与安装器标统一换成白色圆角底板上的鲸鱼娘头像，告别黑底白鲸鱼；启动页加载换成鲸鱼娘旋转动画（减少动态效果时显示静态头像）。
- **Harness 基线 dsh-v0.1.6-alpha.2**：桌面客户端与安装包升级到同一套新的钉版基线；官方 DeepSeek 端点归一到 Messages 协议根 `https://api.deepseek.com/anthropic`，第三方网关地址不受影响。
- **新会话不误占旧身份**：新建会话只复用没有任何历史记录的空白草稿——曾被插件管理、有过消息或定过标题的会话保持原状、仍可手动打开，不会再被当成新草稿顶掉。

## 技术契约

- 安装版 Browser 交付 `dshd mini-player` P0 路径：复用同一 Browser guest / `previewId`，挂到聊天可视区内的 renderer 浮层，支持标题栏拖拽与八方向缩放；恢复后保留当前 URL 与 history。
- mini-player 只迁移 guest 的呈现边界，不创建第二个 BrowserView、外部窗口或 mini 专用 IPC。
- LAN 配对着陆页（`:3180` 静态托管）补纵深防御响应头 nosniff / no-referrer / DENY；刻意不加 CSP——同源 `connect-src` 会阻断配对所需的跨源中继 WebSocket。

## 安装与升级

当前公开安装包为 Windows 10 及以上 x64。请从 [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) 下载，并用随附的 `SHA512SUMS.txt` 校验文件完整性。安装器未进行 Authenticode 签名，Windows 可能显示安全提示。

已有桌面安装可以直接覆盖升级。若要从官方 CLI 或其他旧环境迁移，请在启动器中使用「导入」，不要直接复制整个 `profiles` 目录。dshbot 已回归桌面内置并随包发布：Bots 页签默认出现，旧预置的受管装载会在首次启动时自动迁移，机器人设置、记忆、房间 preset 与会话全部保留。

## 平台范围

本次公开资产为 Windows x64 安装包。macOS、Android 和 Web 第二客户端不包含在这批 Windows 安装资产中；远程访问需要用户主动开启配对。

## 验证范围

Windows 候选已通过同一提交的桌面测试、安装包构建和 packaged smoke，并在晋级时重新校验了候选 Setup 的 SHA256。完整安装版手工验收尚未全部执行，未执行的路径不在本公告中宣称为已验证能力。

## 反馈

请通过 [Issues](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) 报告问题，并附上操作系统、复现步骤和相关日志。分享日志前请移除 API 密钥等敏感信息。

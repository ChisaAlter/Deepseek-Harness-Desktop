# Whale Isle 0.3.3

中文 | [English](release-notes.en.md)

## 这次更新

- **远程工作区**：可管理 SSH 机器、选择远程目录，并在桌面会话中使用镜像工作区。
- **会话费用**：消耗统计页按模型显示会话费用，并提供价格段编辑和更紧凑的活动日历。
- **鲸鱼娘统一会话**：主窗、桌面快捷对话与已启用的 IM 渠道复用同一条常驻会话。设置分为聊天与能力、桌面形象与行为；快捷对话的模型与思考档位改为浮层选择。
- **文件与浏览器工作环**：聊天内的文件引用和产物可打开对应工作面；HTML、HTM、XHTML、PDF 产物先进入聊天区悬浮预览，再按需转到右栏 Browser，保留同一页面的地址和历史。
- **账户登录**：桌面账户登录链接就绪时自动打开系统浏览器，仍可从弹窗复制链接。
- **界面修正**：任务列表浮层避免被会话头部裁切，浏览器悬浮预览缩小装饰边框并改善拖拽、缩放和标题显示；鲸鱼娘交互范围更贴近角色本体。
- **Harness 基线**：更新到 `dsh-v0.1.7-alpha.2`，并保留桌面工作环与插件能力。

## 技术契约

- 鲸鱼娘的会话身份由 `data/whale/settings.json` 中的 `sessionId` 持有；未启用或会话不可用时，IM 不会悄悄创建另一条鲸鱼娘会话。显式选择其他预设的机器人仍使用独立会话。
- Browser 右栏与聊天区悬浮预览交接同一 guest；离任表面的延迟隐藏不得覆盖新表面的显示。
- Browser 预览的 `dshd mini-player` 由 renderer 在聊天可视区定位控制层，Browser guest（BrowserView）按 `previewId` 交接；URL 与 history 由同一 guest 保留。安装版 Browser 路径列为 P0 验收。
- 文件打开通过工作区授权路径执行；缺少工作目录或无法处理的路径回退到 Host。

## 安装与升级

Windows 10 及以上 x64 用户可从 [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) 获取安装包，并使用随附的 `SHA512SUMS.txt` 校验。安装器未进行 Authenticode 签名，Windows 可能显示安全提示。已有桌面安装可直接覆盖升级；迁移其他环境请使用启动器中的「导入」。

## 平台范围

本次公开资产默认只有 Windows x64 安装包；macOS 仅在候选构建时显式选择才包含。Android 与 Web 第二客户端不在这批安装资产中。远程访问需要用户主动开启配对。

## 验证范围

发布候选由同一提交的 Desktop tests、安装包构建和 packaged smoke 约束；晋级前还需核对安装包 SHA256 并完成生产安装包手工验收。未执行的手工路径不宣称通过。

## 反馈

请在 [Issues](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) 附上操作系统、复现步骤与日志；分享前移除密钥等敏感信息。

## Deepseek-Harness-Desktop 0.3.0

平台：Windows x64；macOS 仅在同一已验收候选包含该资产时发布。

相对 [0.2.9](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9)，本版本只记录本轮实际变更，并将 Harness 固定到 `dsh-v0.1.5-rc.1`（SHA `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`）。候选构建与发布晋级分离；晋级只接受已验收候选运行产生的原始资产，不由 tag push 触发重建。

### 升级注意（必读）

**dshbot 已从桌面本体剥离。** 不再附带其源码、开发预置或第一方推荐。旧版 dshbot 可能因调用新版 Harness 已移除的接口而启动失败；已安装用户请在启动器的插件排查中单独禁用 dshbot，再启动桌面。插件文件、机器人设置、记忆与会话不会因禁用而删除。待独立插件兼容后可重新启用；不要清空用户数据。

> [!CAUTION]
> **从早于 0.2.7 的版本、或官方 CLI 升级过来，不会自动带上旧对话。**
>
> 0.2.7 起桌面只用自己的 `dsh-home`，不读、不迁官方 `~/.dsh`。请先**完全退出**应用（托盘也要退）。
>
> **推荐做法：** 冷启动进入 **启动器 → 导入**，按勾选项拷进桌面家目录。不要拷 `profiles`。本版会对可兼容的旧投影缓存自动冷重建，但仍不会直接读取官方 `~/.dsh`。
>
> 已经在用 0.2.7 桌面家目录的，直接覆盖安装即可；本版仍钉同一桌面 home，不回读 `~/.dsh`。

启动器不可用时，可用下面的手动拷贝兜底（拷完后打开**当时聊天用的工作区路径**；未绑定工作区的对话在「无工作区」）：

**Windows（PowerShell）**

```powershell
$old = "$env:USERPROFILE\.dsh"
$new = "$env:APPDATA\Deepseek-Harness-Desktop\dsh-home"
Copy-Item "$old\sessions\*" "$new\sessions\" -Recurse -Force
if (Test-Path "$old\attachments") {
  Copy-Item "$old\attachments\*" "$new\attachments\" -Recurse -Force
}
```

### 安装包

本版本 `0.3.0` 提供 Windows x64；macOS 仅在同一已验收候选包含该资产时发布，晋级阶段不会重新构建。

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `Deepseek-Harness-Desktop-Setup-0.3.0.exe` |

- 校验：候选晋级页生成的 `SHA512SUMS.txt`（Windows Setup / blockmap）
- 安装器未做 Authenticode 签名；请从本仓库下载并核对校验文件。

### 本版变化

- Harness 固定为 `dsh-v0.1.5-rc.1`（SHA `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`），源码与安装包共用同一官方基线。
- 安装版 Browser 交付 `dshd mini-player` P0 路径：复用同一 Browser guest / `previewId`，挂到聊天可视区内的 renderer 浮层，支持标题栏拖拽和四边/四角缩放；恢复后保留 URL / history。
- 边界：mini-player 只迁移 guest 的呈现边界，不创建第二个 BrowserView、外部窗口或 mini 专用 IPC；Web / Android 仍不在默认 Windows 候选的验收范围内。
- 启动器与 compose 恢复链、`dsh-im` / `dsh-usage` 内置模块的装配保持可用，避免候选包缺少桌面恢复和用量入口。
- 修复文件交付卡动作后的预览焦点、标题栏浮动面板拖拽误报、模型菜单拖拽隔离、Python lazy grammar 事件同步和 Switch `corner-shape` 契约。
- 终端 settle-fit 只在宿主拥有真实 used box 时调整 PTY，未布局或折叠 pane 不再产生伪 resize。
- 工具调用继续执行严格的 id/name 校验、畸形响应重试和旧投影修复；keyless malformed-call 快照改用 v3 规范，原始会话日志不被改写。
- 构建与晋级分离：`release.yml` 生成并冒烟安装包，`publish.yml` 仅下载同一已验收运行的原始资产，校验同 SHA 测试、Setup SHA256 和版本文件名后才创建 Release，不重新构建。

### 本版不交付

- dshbot 的机器人功能由独立插件维护，不随桌面交付；旧用户安装保留，由通用插件管理负责禁用和恢复。
- Web 第二客户端、Android APK 与 macOS 实机验收不在默认 Windows 候选范围内。

### 发布验证与已知边界

- 发布前必须在发布记录填入构建源码 SHA、运行 ID、Desktop tests 成功运行和 Setup SHA256；本文件不预填运行号或资产摘要。
- 发布晋级使用 `.github/workflows/publish.yml`，要求操作员提供候选运行 ID、`v0.3.0` 标签和 Setup SHA256；晋级阶段不重建二进制，并生成 `SHA512SUMS.txt` 与 provenance。
- 完整安装包 P0 实机验收仍是发布前置条件；未测项不计 Pass，历史候选结果不沿用。
- Web 第二客户端、Android 与 macOS 实机验收仍不在 Windows 默认候选范围；全库文档检查存在既有问题，不宣称所有检查通过。

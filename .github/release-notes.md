## Deepseek-Harness-Desktop 0.2.8

相对 [0.2.7](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.7)：Harness 钉到 `0.1.2-alpha.2`，设置里的值选择统一为官方胶囊 + 菜单，补上会话费用 / 峰谷、透明主题、Skills 分组与标题栏 Git。远程配对本版停放，不随安装包交付。

### 升级注意（必读）

> [!CAUTION]
> **从早于 0.2.7 的版本、或官方 CLI 升级过来，不会自动带上旧对话。**
>
> 0.2.7 起桌面只用自己的 `dsh-home`，不读、不迁官方 `~/.dsh`。请先**完全退出**应用（托盘也要退）。
>
> **推荐做法：** 冷启动进入 **启动器 → 导入**，按勾选项拷进桌面家目录。不要拷 `profiles`。旧 rc 的 SQLite 会话库与本版不兼容，不要硬开。
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

**macOS：** 把 `$HOME/.dsh/sessions` 拷到 `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home/sessions`（`attachments` 同理）。

### 安装包

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `Deepseek-Harness-Desktop-Setup-0.2.8.exe` |
| macOS Apple Silicon（arm64） | `Deepseek-Harness-Desktop-0.2.8-mac-arm64.dmg` |

- macOS 包**未签名**：下载后右键 → 打开；或执行 `xattr -cr /Applications/Deepseek-Harness-Desktop.app`
- Intel Mac 与 Linux 请从源码运行
- 校验：同页的 `SHA512SUMS.txt`（Setup / blockmap / DMG）

### 本版变化

**内核**

- Harness 钉 `dsh-v0.1.2-alpha.2`（与更早 rc 的 SQLite 会话库不兼容）
- 归档 / 就地编辑重新接上官方 workspace / session Remote
- 会话统计与峰谷行停靠在输入卡宽度内；界面设置可开「会话累计费用」
- 标题栏 Git：登记工作区后即可切分支 / 推拉（0.1.2 工作区 unary 口径）

**设置与外观**

- 设置里的值选择改为官方胶囊 + 菜单（模型、MCP、Skills、通用 / 界面、价格面板）
- 外观新增「透明主题」：有壁纸时表层 0% 填充；毛玻璃低于 20% 会一次性提到 20%
- Skills 支持多选分组
- 市场 Discover 分页；退役家族（含改名绕过）整段拒绝安装

**启动与恢复**

- 启动失败仍只在启动器 Recovery Board 做插件级排查
- 对话页多标签遵守「显示会话标签」开关；AppFrame 不再露出 cozy Session 日志标签

**本版不交付**

- 远程配对 / 手机端 / 设置「远程」分区停放（`REMOTE_FEATURE_ENABLED = false`），侧栏无入口
- 机器人插件不再预置；需要时从市场装独立 `dshbot`

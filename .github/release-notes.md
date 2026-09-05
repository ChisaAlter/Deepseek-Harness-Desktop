## Deepseek-Harness-Desktop 0.2.9

相对 [0.2.7](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.7)：Harness 升级到 `0.1.2-rc.1`，修复识图路由、历史工作区关联和非法工具调用保护，并带来内置用量统计、内置市场、透明主题与服务器默认远程连接。`0.2.8` 未对外发布。

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

**macOS：** 把 `$HOME/.dsh/sessions` 拷到 `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home/sessions`（`attachments` 同理）。

### 安装包

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `Deepseek-Harness-Desktop-Setup-0.2.9.exe` |
| macOS Apple Silicon（arm64） | `Deepseek-Harness-Desktop-0.2.9-mac-arm64.dmg` |

- macOS 包**未签名**：下载后右键 → 打开；或执行 `xattr -cr /Applications/Deepseek-Harness-Desktop.app`
- Intel Mac 与 Linux 请从源码运行
- 校验：同页的 `SHA512SUMS.txt`（Setup / blockmap / DMG）

### 本版变化

**关键修复**

- 恢复识图模型设置的请求消费，上传图片和工具读取图片可交由识图模型生成描述；后续请求复用已记录描述，取消和超时不再伪装为成功
- 恢复工具调用标识校验、畸形响应重试和旧历史投影修复，原始会话日志保持不变
- 注册或重新添加工作区时重新关联后来导入的历史会话，保留原有归属和排序
- 修复插件 Git 安装失败被误报为构建授权的问题

- 修复旧版 `session_projcache` 记录可能让 Harness 陷入启动崩溃循环的问题；旧格式记录会备份并冷重建，不再阻塞进入应用
- 修复已重建的 Web UI 组合仍命中旧 `index.html` 缓存的问题
- 恢复侧栏分组折叠动画，并补齐输入卡四角连续边光与静止态边缘层级

**Harness 与会话**

- Harness 钉 `dsh-v0.1.2-rc.1`；安装包与源码从 0.2.9 起使用同一官方基线
- 归档 / 就地编辑重新接上官方 workspace / session Remote
- 会话统计与峰谷行停靠在输入卡宽度内；界面设置可开「会话累计费用」
- 标题栏 Git：登记工作区后即可切分支 / 推拉（0.1.2 工作区 unary 口径）

**设置与外观**

- 设置里的值选择改为官方胶囊 + 菜单（模型、MCP、Skills、通用 / 界面、价格面板）
- 外观新增「透明主题」：有壁纸时表层 0% 填充；毛玻璃低于 20% 会一次性提到 20%
- Skills 支持多选分组
- 用量统计与市场改为桌面内置模块；市场 Discover 分页，退役家族（含改名绕过）整段拒绝安装
- 工作区 / 空态选择器统一为紧凑方形入口

**启动与恢复**

- 启动失败仍只在启动器 Recovery Board 做插件级排查
- 对话页多标签遵守「显示会话标签」开关；AppFrame 不再露出 cozy Session 日志标签

**本版不交付**

- dshbot 的机器人功能由独立插件维护，不随桌面交付；旧用户安装保留，由通用插件管理负责禁用和恢复

**远程连接**

- 设置中的「外出」改为「服务器」，未配置时默认服务器；局域网保留为手动选项
- 默认模式不会自动开启配对；已保存的连接方式和中继地址保持不变

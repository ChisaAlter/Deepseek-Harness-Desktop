# Decision: 文件定位以可见的 Explorer 窗口完成

Status: implemented

中文 | [English](2026-09-23-visible-explorer-reveal.en.md)

## Problem

交付卡片的“显示文件位置”通过 Host 调用 `explorer.exe /select,`。通用 `runNativeCommand` 设置 `windowsHide: true`，因此 Windows 会创建已选中文件的 Explorer 窗口，但窗口不可见。Host 把 Explorer 的委托退出码 1 视为成功，卡片显示完成状态，用户却看不到文件管理器。文件卡片本体的点击已能打开 DSHD 右栏的 Files 与 HTML Browser 页签。

## Decision

仅 Explorer 的 GUI 启动使用 `windowsHide: false` 的命令运行器；`wslpath` 等非 GUI 命令继续隐藏窗口。Windows `/select,` 保留已验证的文件 URL 参数，以编码空格、逗号等特殊字符；WSL 先用 `wslpath -w` 转换。保留 Explorer 委托退出码 1 的处理，并以运行器参数测试锁定可见性。

## Alternatives considered

- **把所有原生命令改为可见**：PowerShell、路径查询和其他后台命令会弹出控制台窗口。
- **由 Electron 主进程统一定位**：独立 Host 和远程 Host 的文件并不总在桌面壳本机，绕过既有的 Session 文件系统校验会改变权限边界。
- **只调整卡片成功提示**：无法让被隐藏的 Explorer 窗口出现。

## Consequences

点击文件定位后，Windows Explorer 可见并选中目标文件；失败继续在交付卡片显示可重试状态。Windows 与 WSL 共用此行为，macOS Finder 和 Linux 默认文件管理器的启动方式不变。卡片本体仍通过 `workspaces.openPath` 在右栏预览文件。

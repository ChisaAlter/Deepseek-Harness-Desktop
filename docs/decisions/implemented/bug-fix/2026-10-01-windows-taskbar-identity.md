# Decision: Windows 任务栏声明窗口身份并隔离源码通知注册

Status: implemented

中文 | [English](2026-10-01-windows-taskbar-identity.en.md)

## Problem

用户多次报告任务栏退回 Electron 原子图标。2026-09-29 清走同 AppUserModelID 的源码 Electron 快捷方式后曾恢复；2026-10-01 复现时，实际窗口三种 WM_GETICON 均为鲸鱼头像。真实工厂的同进程对照确认，未声明时 Shell 的 ID、重启图标、命令与名称属性为空；本机跨进程探针的空值不作为证据。开始菜单再次出现目标为源码 Electron、参数为空、图标取 EXE 的 Electron.lnk，带正式 AppID 和 ToastActivatorCLSID。

Electron 43.4.0 的系统通知 presenter 在初始化时注册 activator，按 EXE 的 PE 产品名生成快捷方式；源码 electron.exe 的产品名是 Electron，`app.setName` 不改变它。`Notification.isSupported` 也会初始化 presenter。浏览器通知授权是另一入口。因此一次移走快捷方式不能阻止再次创建，WM_GETICON 也不声明任务栏的重启图标。

## Decision

- 主窗口与启动器在首次显示前调用 `setAppDetails`，写既有 AppUserModelID、同源图标和成对的产品名 / 重启命令。源码使用磁盘 ICO，命令只包含 Electron EXE 与绝对项目入口；安装包使用已安装 EXE 的内嵌图标（index 0）和该 EXE 命令，不复制会话、认证、调试或 QA 参数。Windows Shell 不能读取 ASAR 虚拟图标路径。
- Windows 原始 Electron 开发运行在任何 `Notification.isSupported` / 构造前短路系统通知，浏览器 notification 权限也拒绝。安装版及其它平台沿用通知能力；源码仍有既有应用内更新确认、注意提示与未读状态。
- 保留 appId、资源设计和用户数据路径。不改用户快捷方式、系统图标缓存、Explorer 或 Electron PE 资源；窗口声明与注册边界解决后续启动的来源。

## Alternatives considered

- 再清理 Electron.lnk 可暂时修复，但下一次通知初始化仍会重建。
- 换开发 AppID 或修改 Electron EXE 可分开分组，但增加安装 / 单实例身份或依赖二进制维护，并没有补齐正确的重启命令。
- 只设置窗口图标不覆盖 Shell 任务栏属性；只屏蔽 Node 通知又遗漏浏览器通知路径。

## Consequences

开发版 Windows 不显示系统 toast，安装版通知保持可用。自动化必须证明源模式未调用 presenter、其它模式仍可通知，并在真实 HWND 读取 Shell 属性和图标；旧的 WM_GETICON 证据不能再单独认证任务栏品牌。此修复不认证旧 pin 的离线图标或完整生产安装验收。

沿用 [统一品牌资源](../product/2026-09-18-whale-brand-assets.md)与[产品名称](../product/2026-09-25-whale-isle-application-name.md)，不取代它们。[Electron 窗口 API](https://www.electronjs.org/docs/latest/api/browser-window#winsetappdetailsoptions-windows)、[固定版本通知注册实现](https://github.com/electron/electron/blob/v43.4.0/shell/browser/notifications/win/windows_toast_activator.cc)、[Microsoft 任务栏重启图标规则](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchiconresource)说明上述系统行为。

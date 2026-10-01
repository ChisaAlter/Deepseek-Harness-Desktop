# Decision: Windows 任务栏声明窗口身份并隔离源码通知注册

Status: implemented

中文 | [English](2026-10-01-windows-taskbar-identity.en.md)

## Problem

用户多次报告任务栏退回 Electron 原子图标。2026-09-29 清走同 AppUserModelID 的源码 Electron 快捷方式后曾恢复；2026-10-01 复现时，实际窗口三种 WM_GETICON 均为鲸鱼头像。真实工厂的同进程对照确认，未声明时 Shell 的 ID、重启图标、命令与名称属性为空；本机跨进程探针的空值不作为证据。开始菜单再次出现目标为源码 Electron、参数为空、图标取 EXE 的 Electron.lnk，带正式 AppID 和 ToastActivatorCLSID。

Electron 43.4.0 的系统通知 presenter 在初始化时注册 activator，按 EXE 的 PE 产品名生成快捷方式；源码 electron.exe 的产品名是 Electron，`app.setName` 不改变它。`Notification.isSupported` 也会初始化 presenter。浏览器通知授权是另一入口。因此一次移走快捷方式不能阻止再次创建，WM_GETICON 也不声明任务栏的重启图标。

同日安装原始 CI 候选 `36804159162` 后，用户再次看到原子图标。已安装 EXE 内嵌图标为鲸鱼，实际可见窗口声明了正式 ID、已安装 EXE 重启图标和 Whale Isle 名称；开始菜单却仍保留旧 Electron.lnk，与新 Whale Isle.lnk 共用正式 ID。前一批修复防止后续注册，但遗漏了已经存在的旧条目。此冲突的修复须同时覆盖存量恢复与未来注册边界。

新 CI 候选 `36820230025` 的自动迁移完整保存了旧条目原字节，但备份仍为 `.lnk`，通知使用 `FLUSHNOWAIT`。首次正常快捷方式启动 PID 23668 的有效任务栏样本为白色文档图标，记 Fail；正常退出后第二次冷启动 PID 18420 的样本为鲸鱼，作为同候选诊断 Pass 单独保留，不抵消首启失败。为收敛此前已成功的人工恢复路径，本次同时采用非快捷方式扩展名备份与有界 `FLUSH` 事件投递等待；未独立证明两项改动各自的因果，新的安装候选仍须验证首次启动。

## Decision

- 主窗口与启动器在首次显示前调用 `setAppDetails`，写既有 AppUserModelID、同源图标和成对的产品名 / 重启命令。源码使用磁盘 ICO，命令只包含 Electron EXE 与绝对项目入口；安装包使用已安装 EXE 的内嵌图标（index 0）和该 EXE 命令，不复制会话、认证、调试或 QA 参数。Windows Shell 不能读取 ASAR 虚拟图标路径。
- Windows 原始 Electron 开发运行在任何 `Notification.isSupported` / 构造前短路系统通知，浏览器 notification 权限也拒绝。安装版及其它平台沿用通知能力；源码仍有既有应用内更新确认、注意提示与未读状态。
- 安装版 Windows 桌面启动在首次创建 / 显示窗口或初始化通知前检查当前用户开始菜单的固定 `Electron.lnk`。仅当普通文件、正式 GUI AppID、绝对 Electron EXE 目标、空参数、默认图标及 index 0 全部匹配时，保留原字节并移到 userData 下唯一的 `Electron.lnk.backup` 恢复备份，不保留 `.lnk` 扩展名；无法读取、身份不符或备份失败时保留原条目。只有实际移动完成后，异步发送该旧路径到备份路径的 Shell `SHCNE_RENAMEITEM` 通知，使用 `SHCNF_PATHW | SHCNF_FLUSH` 等待事件投递；原生回调最多等待 500ms，失败或超时仍保留备份并继续启动。期限只结束启动等待，不取消原生调用；迟到回调不翻转超时结果。只处理旧通知生成的条目，不扫描开始菜单或固定项，不改 Whale Isle 快捷方式。
- 保留 appId、资源设计和用户数据路径。不改用户固定项、其它应用快捷方式、系统图标缓存、Explorer 或 Electron PE 资源；恢复旧通知条目与注册边界共同覆盖已有及后续启动。

## Alternatives considered

- 再清理 Electron.lnk 可暂时修复，但下一次通知初始化仍会重建。
- 换开发 AppID 或修改 Electron EXE 可分开分组，但增加安装 / 单实例身份或依赖二进制维护，并没有补齐正确的重启命令。
- 只设置窗口图标不覆盖 Shell 任务栏属性；只屏蔽 Node 通知又遗漏浏览器通知路径。
- 保留 `.lnk` 备份便于直接恢复，`FLUSHNOWAIT` 可减少启动等待，但新候选首启白色文档图标失败后不沿用此组合；采用非快捷方式扩展名与有界 `FLUSH`，保留原字节可恢复性及启动期限，不把组合修复宣称为已独立证明的根因。

## Consequences

开发版 Windows 不显示系统 toast，安装版通知保持可用。自动化必须证明源模式未调用 presenter、其它模式仍可通知，以及旧条目恢复的严格匹配、字节备份、幂等与失败不修改边界；Shell 通知只覆盖已完成的精确移动，不匹配或失败分支不得加载原生桥。FLUSH 只等待向受影响组件投递事件，不保证索引或任务栏重绘完成；原生投递超过 500ms 时启动仍继续，备份安全与投递结果分别记录。真实 HWND 属性与首次冷启动的可见任务栏另行核对，不能从正确窗口属性、通知返回或后续启动样本推断首启 Pass。原候选经人工备份、精确移动通知与冷启动后取得有效鲸鱼图标样本，但这不证明原候选自动恢复，也不认证旧 pin 的离线图标或完整生产安装验收。

沿用 [统一品牌资源](../product/2026-09-18-whale-brand-assets.md)与[产品名称](../product/2026-09-25-whale-isle-application-name.md)，不取代它们。[Electron 窗口 API](https://www.electronjs.org/docs/latest/api/browser-window#winsetappdetailsoptions-windows)、[固定版本通知注册实现](https://github.com/electron/electron/blob/v43.4.0/shell/browser/notifications/win/windows_toast_activator.cc)、[Microsoft 任务栏重启图标规则](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchiconresource)与[Shell 事件投递规则](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shchangenotify)说明上述系统行为。

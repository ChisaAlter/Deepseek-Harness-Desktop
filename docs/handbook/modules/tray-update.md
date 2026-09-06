# 模块：托盘、关闭与更新

## 职责与非目标

**职责：** 托盘菜单、关闭进托盘、GitHub Releases 自动更新检查/安装；从托盘再打开启动器。  
**非目标：** 不实现旁路更新通道；不绕过单实例。

## 用户路径

1. 点关闭 → 按配置进托盘或退出。  
2. 托盘：显示主窗、**打开启动器**、设置、插件市场、重启 Harness、退出。文件菜单同样有「打开启动器」。  
3. 冷启动由启动器询问正式版更新；关于 / 启动器「版本」页也可下载指定 tag 的 Setup.exe。

## 架构要点

- `tray.js`、`tray-menu.js`、`close-behavior.js`、`update.js`、`menu.js`、`launcher-gate.js`

## 实现入口

- 上列 `src/main` 文件；preload `checkUpdate` / `installUpdate` / `listReleases` / `installRelease` / `onUpdateProgress`

## 不变量

- 关闭行为可配置且重启后保持（验收表有持久化相关条）。  
- 更新来源为项目 Releases；`/releases/latest` 忽略 draft。启动器自 0.2.7 起随 Setup 提供，当前版本与发布状态以 [构建、钉版与发版](build-release.md) 为准。
- 冷启动更新询问/下载挂在可见启动器上；下载失败（含正文断流、字节数与 content-length 不符）删除半成品并回启动器首页，不留无窗进程（`TC-LAUNCH-008`）。  
- 桌面在跑时关启动器 ≠ `app.quit()`；桌面未启动时关启动器 = 退出应用。

## 门槛

- QA：`TC-LAUNCH-006`、`TC-DESK-002`（托盘须含「打开启动器」）

## 延伸阅读

- [README.md](../../../README.md) 桌面能力简述
- [../../features/desktop-launcher.md](../../features/desktop-launcher.md)

# Agent Note: Desktop close-window preference

Status: implemented

[English](2026-08-14-desktop-close-to-tray-setting.md) | 中文

## Problem

桌面壳已经持久化 `closeToTray`，并在关闭时隐藏窗口，但设置里没有对应控件。想让关闭按钮直接退出的用户只能改 `config.json`。退出还必须停掉拉起的 Harness 进程，否则下次启动会和残留监听抢端口。

## Decision

`ui-settings-general` 只在 `window.shell` 同时提供 `getConfig` 和 `saveConfig` 时，向「通用」注册 id 为 `close-behavior` 的一行。该行读写 Electron 的 `closeToTray`（默认 `true`：最小化到托盘）。`false` 表示标题栏关闭即退出。普通浏览器看不到这一行。

主进程关闭处理通过 `hideOnClose` 读取当前配置。托盘隐藏只收起窗口。退出——`closeToTray: false` 时点标题栏关闭、托盘「退出」，或应用菜单退出——会设立退出标志、先铺一层全屏「关闭中」遮罩，再执行 `dsh.stop()`，然后 `app.quit()`。`before-quit` 仍是唯一的服务拆除点。遮罩在拆除开始前画上，因此偏慢的 `dsh.stop()` 不会看起来像卡住。

遮罩 CSS 使用 `currentTheme()` 给出的当前浅色或深色具体颜色，不会回退到深色画布。插入后，若页面上的 `--dsw-alias-*` token 能解析，遮罩脚本会用它们覆盖。

## Alternatives considered

**把该偏好存进 Host `settings.yaml`。** 否决：关闭与退出属于 Electron 窗口生命周期，不是 Web settings namespace，远程浏览器也不得改它们。

**另做一扇桌面设置窗。** 否决：设置已经是官方面板，关于和插件市场已经在那里走 `window.shell`。

**退出后让残留 dsh 继续跑。** 否决：下次启动就要抢端口或换端口，而且用户要求退出时停掉服务。

## Consequences

改选择器会立刻写入 `config.json`；下一次关闭即按新值生效，不用重启。托盘模式保持 Harness 进程。退出总会在 Electron 应用结束前拆掉该进程。Web 快照不包含这一行。

## Testing

`ui-settings-general` 的客户端 spec 钉住：仅当 `window.shell` 同时提供 `getConfig` 和 `saveConfig` 时才注册该行；通用行会持久化 `closeToTray`；配置缺失时保持托盘默认。这些套件走 `test:gui` 和逐文件 100% 覆盖门禁。

桌面壳的 `npm test` 钉住 `hideOnClose`（托盘默认、显式退出、退出开始后不再隐藏）、按给定浅/深 token 生成且无深色画布回退的 `overlayCss`，以及中英遮罩文案。Pull request 和 Windows 安装包工作流在打包前跑 `npm test`。

没有 Playwright 或 Electron e2e 覆盖画出的遮罩，也没有覆盖退出过程中的 `dsh.stop()`。

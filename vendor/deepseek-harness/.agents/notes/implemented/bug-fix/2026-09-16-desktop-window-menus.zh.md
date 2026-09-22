# Agent Note: Desktop standard macOS window menus

Status: implemented

[English](2026-09-16-desktop-window-menus.md) | 中文

## 问题

Desktop shell 用自定义模板替换了 Electron 的默认应用菜单，该模板此前只列出应用菜单和 Edit 菜单。Electron 只构建模板中声明的 role，因此 macOS 失去了默认模板提供的 File、Window 菜单和应用隐藏命令，包括 Close Window（⌘W）、Minimize（⌘M）和 Hide（⌘H）。这些快捷键在 Desktop 应用中都没有任何效果，而同类的 macOS 应用都会响应它们（#4374）。

## 决策

macOS 上的模板在 Edit 菜单之前声明 `{ role: 'fileMenu' }`，在其之后声明 `{ role: 'windowMenu' }`，并在应用子菜单的 Quit 之前声明由分隔符隔开的 `hide`、`hideOthers` 和 `unhide`。这些 role 只提供标准菜单项；不声明 Services 子菜单、窗口列表或其他 macOS 默认项。Windows 和 Linux 保留应用菜单和 Edit 菜单。

这些 role 的标签是 Electron 内部的英文常量（`lib/browser/api/menu-item-roles.ts` 的 `filemenu`、`windowmenu`、`close`、`minimize`、`hide`），没有语言查询，而且 Electron 在菜单显示前会把这些标签重新写到本机菜单项上，因此在非英文的 Desktop 上它们仍是英文；现有的 Edit 菜单同样如此。这里不新增任何自定义的关闭、最小化或隐藏代码：⌘W 通过 Electron 自身的 role 销毁窗口。

## 考虑过的替代方案

**把 ⌘W 绑定为最小化或隐藏窗口。** macOS 把最小化留给 ⌘M、把隐藏留给 ⌘H，同类应用都用 ⌘W 关闭最前窗口。给这个快捷键绑定其他命令会违背本改动所遵循的平台惯例。

**只声明 Window 菜单。** 该菜单提供 Minimize 和 Zoom，但不提供关闭，⌘W 仍然没有绑定。

**在应用子菜单里直接加一个 `{ role: 'close' }` 项。** 这样可以避免只有一个命令的 File 菜单，但会把窗口命令放到 Plugins、Updates、Hide、Quit 这些应用级命令中间，没有 macOS 应用这样排布。

**在所有平台都声明 File 和 Window 菜单。** 同一份模板在那些平台会把 Ctrl+W 声明为关闭；应用只有一个窗口，关闭它会触发 `window-all-closed` 并退出应用，把窗口快捷键变成用户没有要求的退出路径。

**让 Dock 激活时无论其他窗口是否存在都重建主窗口。** 插件窗口可以比主窗口存活更久，因此把 `activate` 的判断从 `BrowserWindow.getAllWindows()` 改为 `mainWindow` 能让点击 Dock 总可以恢复主窗口。但这超出了恢复被压掉的平台命令，属于窗口生命周期的行为变更，因此保留现有的 `activate` 判断。

## 影响

macOS 恢复了自定义菜单压掉的窗口和应用命令，代价是四个菜单 role。在非英文的 Desktop 上这些标签仍是英文。

## 测试

`apps/desktop/tests/main-startup.spec.ts` 中的一个用例固定了各平台声明的菜单 role，包括 macOS 的隐藏命令。基于 role 的菜单项由本机执行，因此程序化的 `click()` 和 vitest 的 Electron mock 都无法触达这些快捷键；用真实 Electron 44 运行同一模板显示，只有在本改动之后才出现标准的 File、Window 和应用菜单项，并且在 `app.getLocale()`、`getSystemLocale()` 和 `getPreferredSystemLanguages()` 都报告 `zh-CN` 时标签保持不变。

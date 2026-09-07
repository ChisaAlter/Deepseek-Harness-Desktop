# @deepseek-ai/dsh-client-ui-titlebar

[English](README.md) | 中文

标题栏尾簇插件：两个 ghost 开关，分别写入 `ctx.layout.toggleTerminalDrawer` 与 `ctx.layout.toggleSurfaces`。条目挂在 `shell.titlebar.trailing`，`id: 'panel-toggles'`，`order: 40`，因此空白首页也能看到，并落在 Session log（`order: 10`）右侧，中间留给 Git（`order: 20`）。界面设置 `ui-titlebar.terminalToggle` 与 `surfacesToggle`（默认 true）隐藏对应按钮；`Ctrl+\`` 与 `Ctrl+\\` 仍可切换面板。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

按下态跟随布局 owner 宽度（`surfaces` / `terminalDrawer`；0 表示关闭）。`useWorkspaces` 报告没有工作区时，终端开关为 disabled。右侧栏开关在空白首页仍可用。Ctrl/Cmd+` 切换终端抽屉，Ctrl/Cmd+\\ 切换右侧栏。右侧栏快捷键在 input、textarea、contenteditable 或 Ghostty 终端窗格（`[data-terminal-pane]`）内不抢键；终端抽屉快捷键只对终端之外的文本输入让位，因此焦点在终端窗格内（含 Ghostty 的隐藏 input textarea）时仍可切换——`ui-user-terminal` 在 `beforeKey` 中拒收该组合键并让其冒泡到这里。

`PanelTogglesProps` 组合标题栏尾簇 owner share、全局 `useWorkspaces` 钩子、注入的切换回调，以及 `titlebar` 文案 seat。这里没有插件 store。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；PanelToggles 仍由 slot 注册封装在包内。

## 模型体验

无。标题栏开关只写入布局面板几何；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **Git 是同级标题栏条目**：本包不渲染 Git 操作；后续 `ui-git` 条目占用 `order: 20`。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。

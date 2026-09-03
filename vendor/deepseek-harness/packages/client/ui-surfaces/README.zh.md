# @deepseek-ai/dsh-client-ui-surfaces

[English](README.md) | 中文

右边栏壳：占用布局 `surfaces` 列（`single`，`session-maybe`）。标签条即使在没有 surface 时也保持挂载，作为标题栏拖拽区（没有 surface 时不显示 +）；每个 Tab 的关闭控件在标题右侧。2×N 空态卡片（浏览器 / 终端 / 文件 / 差异 / 代理）填满主体，直到打开一个 surface。点卡片会调用 `createSurfacesStore()` 的 `open(kind)` 以及 `layout.openSurfaces()`。已有 surface 时，壳保持每个已打开 occupant 挂载，并用 `hidden` 藏起非活动项，因此 Browser 历史与未保存的 Files 草稿在切 Tab 后仍在。未保存的文件草稿与 Tab 列表一起写入 localStorage，刷新或退出后再打开仍能恢复。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

store 用 `sessionId` 做 key（`bySession`）。`open` 会 upsert 单例的 files／diff／agents、一个 preview、以及一个 terminal 占位。`openFile` 保留 files 资源管理器并并列加上 `file:` Tab。`activate`／`close`／`closeOthers`／`closeToRight`／`closeAll` 只改该会话的列表。标题栏 `toggleSurfaces` 只写布局宽度，不清这个 store。桌面在存在 `listDir` 且路径位于会话 cwd 内时，把 `workspaces.openPath` 接到 `openFile`。对 `.html`、`.htm`、`.xhtml`、`.svg`、`.pdf` 会再 await `previewWorkspaceFile`，成功则用 loopback URL 打开 Browser；IPC 缺失或失败时只留 Files，不回落到操作系统打开器。

声明的子座都是 `single` + `session-maybe`：`surfaces.browser`（owner `active` 和 `occluded`）、`surfaces.terminal`、`surfaces.files`、`surfaces.file`、`surfaces.diff`、`surfaces.agents`。`surfaces.terminal` 与 ui-user-terminal 的 inject 一致，现有 Terminal occupant 才能挂上。`surfaces.files` 的 owner 是 `openFile(relativePath)`；`surfaces.file` 的 owner 是 `relativePath`、`active` 以及 dirty／save 缓冲区回调。当前会话没有 cwd，或 `gitStatus(cwd)` 为 null 时禁用差异空态卡。DiffPanel 在 cwd 不是 Git 仓库时显示「差异仅适用于 Git 仓库。」没有桌面 `window.shell.previewOpen` 时禁用浏览器卡，理由是 `Browser previews are only available in the desktop app.` surface 菜单和未保存文件对话框会设置 `occluded`，防止原生 BrowserView 穿透渲染进程 chrome 接收点击。occupant 内容由后续包注入。

`/client` 导出表层只包含插件主体（`apply`／`inject`）、store 工厂及约定类型；SurfacesRoot、EmptyState 与 SurfaceTabs 仍由 slot 注册封装在包内。

## 模型体验

无。右边栏壳只拥有查看状态与布局列几何；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **occupant 不在本包实现**：Files、Diff、Browser、Agents 卡片只调用 `open(kind)` 与 `openSurfaces()`；后续包注入槽位内容。

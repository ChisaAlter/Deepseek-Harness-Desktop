# @deepseek-ai/dsh-client-ui-surfaces

[English](README.md) | 中文

桌面导航适配层：唯一可见右栏是 `@deepseek-ai/dsh-client-ui-sidebar-right`。本包不注册任何 `surfaces` occupant，也不发布空态；apply 时同步调用 `ctx.layout.closeSurfaces()`，让持久化的旧宽度无法制造第二列，然后包装 `workspaces.openPath`。约定见[单右栏决策](../../../docs/decisions/proposed/architecture/2026-09-22-single-visible-right-sidebar.md)。

当 pin 的 Workspace Controller 没有 `openPath` 时，本包会先安装一份由 Host RPC 支撑的基线方法，再包装它。桌面包装器解析发起 Session（Chat 显式传入 `sessionId`，缺失时才用保留的主视图 Session），并交给原生右栏：根目录打开其 Files 页；普通文件经 `sidebarRight.openResourceIn(sessionId, fileAddressFor(...))` 打开，行号以 `{ params: { line } }` 传递；`.html`、`.htm`、`.xhtml`、`.pdf` 保留该文件资源页，再 await `previewWorkspaceFile` 并把成功后的 token URL 交给 Sidebar Browser。Sidebar 服务缺失，或目标 Session 没有 adopted store 且没有 matching live binding 时走原始 Host 打开器。已命中 Sidebar 目标后导航抛错时向上传播，不静默改道。非桌面与工作区外路径使用 Host 基线操作。

休眠的 `surfaces.*` 槽位声明与 owner 类型保留在本包，只为上游布局契约与 fork 包继续通过类型检查；没有任何注册，也不渲染任何 UI。`/client` 只导出插件主体（`apply`／`inject`）与 `desktopListingAvailable`。

## 模型体验

无。本适配层只把打开动作路由到右栏；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **旧壳已退役**：Files、Diff、Browser、Agents 各自在自己的包注册原生 `ui-sidebar-right` 页类型；休眠槽位仅作兼容。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，路由行为由聚焦的包测试覆盖。

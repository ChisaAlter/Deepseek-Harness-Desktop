# @deepseek-ai/dsh-client-ui-surfaces

[English](README.md) | 中文

DSHD 原有右栏壳层。本包把 `SurfacesRoot` 注册到布局的 `surfaces` 列，恢复顶部页签条、无页签入口、持久化页签与文件草稿。Files、Browser、Terminal、Diff、Agents 的内容由 `surfaces.*` 注入。视觉选择见[恢复 DSHD 右栏的决策](../../../../../docs/decisions/implemented/product/2026-09-23-right-sidebar-dshd-guide.md)。

当 pin 的 Workspace Controller 没有 `openPath` 时，本包先安装 Host RPC 基线方法，再包装它。桌面包装器解析发起 Session（Chat 显式传入 `sessionId`，否则使用保留的主视图 Session）。工作区根目录打开 Files，普通文件在 DSHD 文件页签打开并可定位行号；`.html`、`.htm`、`.xhtml`、`.pdf` 还将 token URL 交给 Browser。缺少已知 cwd、非桌面与工作区外路径使用 Host 基线操作。

打开 DSHD 右栏会收起原生 Sidebar。原生栏的专有资源仍可打开它；其呈现会关闭 DSHD 轨道，因此右侧同时只见一条栏。标题栏按钮控制 DSHD 轨道。`/client` 导出插件主体、store、surface 类型与可用性探针。

## 模型体验

无；右栏与文件导航不会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- Session 没有 cwd 时，文件路径暂由 Host 打开，直至 DSHD 文件工作面支持绝对地址。

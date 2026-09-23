# Decision: 聊天文件预览迁移到右侧 Sidebar 资源路由

Status: implemented

中文 | [English](2026-09-21-chat-file-sidebar-resource-route.en.md)

## Problem

当前客户端同时挂载新版 `ui-sidebar-right` 和桌面旧 surfaces 列，但聊天文件、工具路径与产物芯片仍统一调用 `workspaces.openPath`。`ui-surfaces` 接管该调用后只写入旧 surfaces store：新版右侧 Sidebar 已显示在界面上，却从未收到文件打开意图，因此点击文件不会出现右侧文档或浏览器预览。发起点击的 Session 也不能由“当前主视图 Session”推断，因为 token 或异步预览生成期间可能已切换。原生悬浮文件窗是 Files 工具栏的另一条路径，不属于聊天文件点击契约。

## Decision

桌面 `workspaces.openPath` 接管层保持为唯一漏斗，并在旧 surfaces 之前优先调用 `sidebarRight`。Chat 在调用该漏斗时显式携带当前 Session；接管层优先使用它，缺失时才回退到主视图 Session：

- 工作区根目录调用 `sidebarRight.openTabIn(sessionId, 'files')`。
- 其余工作区文件先调用 `sidebarRight.openResourceIn(sessionId, fileAddressFor(sessionId, cwd, relative), { params: { line } })`；行号缺省时不传参数。
- HTML、HTM、XHTML、PDF 在保留上述带行号文件资源页之后，再经 `previewWorkspaceFile` 取得受 token 保护的 loopback URL，并调用 `sidebarRight.openTabIn(sessionId, 'browser', { params: { url } })`；Browser 是第二预览，不替代文件资源页。

只有 Sidebar 服务缺失，或目标 Session 没有 adopted store / matching live binding 时，接管层才继续执行原 surfaces 分支，保持无新版 Sidebar 的宿主可用；已命中 Sidebar 目标但导航抛错时错误向上传播，不静默回退。旧 surfaces occupant 缺失也抛错，不落入 Host 系统打开器。`ui-surfaces` 同时声明 Sidebar、Sidebar Browser 与 Sidebar Document Preview 的类型依赖，以加载参数声明合并。

## Alternatives considered

- **只改 `ui-chat.openFile` 直连 `sidebarRight`** — rejected：产品还有工具行、产物芯片、技能与终端等入口，分散直连会形成多个事实源，并绕过现有桌面接管契约。
- **删除旧 surfaces 接管，完全依赖新版 Sidebar** — rejected：Sidebar 服务缺失，或目标 Session 没有 adopted store / matching live binding 时会把点击退回 Host 打开器；保留旧 surfaces 只作为这一兼容分支。
- **让聊天文件点击打开原生悬浮文件窗** — rejected：悬浮预览由 Files 工具栏显式触发，是单实例只读窗口；聊天点击的现行契约是打开右侧工作区。

## Consequences

新版右侧 Sidebar 能接收聊天文件打开并聚焦文档 tab；HTML、HTM、XHTML、PDF 同时保留文件资源页并进入 Sidebar Browser；工作区根目录进入 Sidebar Files。异步打开始终使用发起点击的 Session，主视图切换不会把文件送进错误的 Sidebar。没有可接管的 Sidebar 目标时行为保持原样；已命中目标的异常不再静默落到旧 surfaces 或 Host 打开器。`ui-surfaces` 新增对 Sidebar Browser 与 Document Preview 的编译期依赖；运行时仍以服务是否存在决定路由。聚焦测试覆盖普通文件、行号、根目录、HTML/PDF、显式 Session、Sidebar 异常与旧 surfaces 缺失，Chat inject 与本地 Markdown `#L24` 链接测试保持通过。

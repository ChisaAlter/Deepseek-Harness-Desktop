# Agent Note: 对话链接进入 Files 与 Browser

Status: implemented

[English](2026-08-19-conversation-surface-links.md) | 中文

## 问题

桌面对话里本来就有 Files 与 Browser 两条工作环，但 pin 的 Workspace Controller 没有暴露 `openPath`，Chat 又直接调用 `session.openWorkspacePath`。文件提及、产物芯片和工具行路径因此绕过 surfaces，到达 Host 系统打开器。Markdown 和行内代码里的 http(s) 使用 `target="_blank"`，Harness BrowserView 的 `setWindowOpenHandler` 把所有 http(s)（含 loopback）交给 `shell.openExternal`。终端已经把 loopback 送到 `dshd-open-surface` 和 `dshd-pending-preview-url`。[从 web UI 打开产出的文件](2026-07-31-web-workspace-file-links.zh.md) 否决了从 harness 源提供工作区文件（同源 `/api` 泄露），并把桌面 WebView 记为剩余的隔离方式。`file:` 会被取消；guest 文档可以是任意 http(s)；Harness 主窗口仍限制在 loopback。

## 决策

**工作区文件点击共用一个打开器。** pin 的 Workspace Controller 缺少 `workspaces.openPath` 时，ui-surfaces 先安装一份由 Host RPC 支撑的基线方法，再由桌面 `wrapOpenPath` await `openInSurfaces`。ui-chat 把文件提及、产物芯片和工具行路径相对 Session cwd 解析后调用该共享方法，不再调用 `session.openWorkspacePath`。工作区根目录打开 Files 资源管理器。其它工作区内路径打开 Files 的 `file:` Tab；`.html`／`.htm`／`.xhtml`／`.pdf` 还会调用 `previewWorkspaceFile({ cwd, relativePath })`。得到 `{ ok, url }` 时，拦截器先写 `dshd-pending-preview-url`，再 dispatch `dshd-open-surface`（`{ kind: 'preview', url }`），因此激活 Tab 是 Browser，源码 Tab 留在条上。SVG 与其它图片、媒体、文本和源码留在 Files。预览 IPC 缺失、抛错或拒绝时只留 Files，不 throw，也不回落到 Host 基线方法。

**用带 token 前缀、只接受 GET 的监听器提供这些文件。** URL 是 `http://127.0.0.1:{port}/{token}/{relative}`，套接字只绑 `127.0.0.1`。token 是每个已解析 cwd 的 16 字节 `base64url`（≥96 bit）。没有 token 的 GET 是 404。POST／PUT／DELETE 是 405。`Host` 必须是 `127.0.0.1`（可带端口）。响应带 `X-Content-Type-Options: nosniff`。路径 decode 一次再 `resolveInside`。不做目录 listing，也不跟随 `index.html`；对目录的 `fileUrl` 失败，对目录的 GET 是 403。预览 origin 能 `fetch` 同一 token 下的其它工作区文件（含 `.env`）；隔离目标是 harness `/api` 源和未认证端口扫描，不是页面沙箱。`preview.closeAll`／Harness 重启会关掉监听器并丢弃 token。

**被拒绝且不是 Harness 同源的 loopback 打开 Browser。** `ensureHarnessView` 传入 `openDeniedLoopback`。`setWindowOpenHandler` 和被拒绝的 `will-navigate` 在 URL 是 loopback 且 `allowUrl` 为假时，由**该** `contents` 发送 `shell:open-preview-url`（`rewriteLoopbackLoadUrl`）。Harness 同源弹窗只 deny，不预览、不 `openExternal`。远程 http(s) 仍 `openExternal`。`will-redirect` 仍只拒绝。boot 窗口不传 `openDeniedLoopback`。`ui-surfaces` 的 `apply` 订阅 `onOpenPreviewUrl`，转成与终端相同的 CustomEvent。两个事件／存储字符串在各包内重复。

**本切片不做的。** Markdown 相对链接仍被 `sanitizeUrl` 剥掉。Preview 仍拒绝 `file:`。Files 树点击打开 Files 查看器；工具栏拥有显式悬浮窗动作。点 HTML 文件走这套静态服务，不猜测已发现的 Vite 端口；点 `http://127.0.0.1:5173` 才进那个服务。预览页里的根路径 `/style.css` 会 404（相对路径可用）。终端 Cmd-click `.html` 也会双开，因为走同一拦截器。

## 考虑过的替代

**在 preview guest 里放行 `file:`。** 否决：`file:` 仍被取消；工作区 HTML 仍走 token 监听器。

**Harness 同源 `/f/` 或任何同源文件 HTTP。** 否决：与 [从 web UI 打开产出的文件](2026-07-31-web-workspace-file-links.zh.md) 记录的 `/api` 泄露相同。

**高位端口上不带前缀的监听器。** 否决：本机任意进程扫端口即可读整个 cwd。

**改 Markdown 渲染器，发出 `file:` 或应用内协议。** 否决：对话已经有 `openPath` 和 `target="_blank"`；拦截器和窗口守卫才是汇合点。

**让 Chat 和每种工具直接调用 Host 打开器。** 否决：每个调用者都会重复路径分类，并绕过 Files、Browser、跳行与显式悬浮预览动作。

**从 Files 树双开。** 推迟：树仍是源码编辑器；对话、芯片、工具行和终端路径走 `openPath`。

## 后果

`dsh web` 与当前工作区外路径仍使用 Host 基线操作。桌面工作区文件留在右边栏；HTML／HTM／XHTML／PDF 激活 Browser，SVG 与其它文件激活 Files。远程 http(s) 仍离开应用。同源 `_blank` 不能把 Harness UI 装进 preview partition。boot 窗口永远收不到 `shell:open-preview-url`。

## 测试

`src/main/preview-workspace.test.js` 钉 token 前缀 200 + nosniff、无 token 404、`../` 与 `%2e%2e%2f` 404、目录拒绝 + GET 403、POST 405、坏 Host、未授权 cwd、close 后 ECONNREFUSED、以及逃出 cwd 的 symlink 不提供。`src/main/preview.test.js` 钉 `shell:preview-workspace-file` 以及 closeAll 关掉该服务。`src/preload/shell-api.test.js` 钉 `previewWorkspaceFile` 和 `onOpenPreviewUrl`。`ui-surfaces` 的 `openpath-intercept.client.spec.ts` 钉基线方法安装／移除与 await 异步 `openInSurfaces`；`paths.client.spec.ts` 钉 cwd 与 `/.` 都识别为工作区根。`apply.client.spec.ts` 钉根目录 → Files、html/pdf 在 Files 之后双开、SVG／文本／无扩展名留在 Files、预览 IPC 缺失或拒绝或抛错只留 Files 且不抛、以及转发 `onOpenPreviewUrl`（含 sessionStorage 配额失败）。`ui-chat` 与 `ui-tool` 组装测试钉文件回调到达 `workspaces.openPath`，且不调用 `session.openWorkspacePath`。`src/main/window-nav.test.js` 钉 boot 风格 loopback 弹窗仍 `openExternal`、跨端口 loopback 弹窗／拒绝导航向该 contents 发送 `shell:open-preview-url`、Harness 同源弹窗两者都不走、远程仍 `openExternal`、`file:` 两者都不走、以及 `will-redirect` 只拒绝。

## 相关

[从 web UI 打开产出的文件](2026-07-31-web-workspace-file-links.zh.md) 拥有 `dsh web` 的 Host `openPath`。[右边栏与终端工作环](2026-08-16-surfaces-terminal-work-loops.zh.md) 拥有本拦截器接入的 Files／Browser／Terminal 工作环。

# @deepseek-ai/dsh-client-ui-preview

[English](README.md) | 中文

右边栏 Browser occupant，挂在 `surfaces.browser`（`single`，`session-maybe`，由 ui-surfaces 声明）。仅桌面预览 http(s) 文档。渲染进程拥有地址栏并上报宿主矩形；Electron 通过 `window.shell.preview*` 把 `BrowserView` 贴在该矩形上。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

访客页文档可以是任意 `http(s)` URL；Harness 主窗口仍限制在 loopback。`file:` 及其他非 http(s) 文档导航会被取消。远程 CDN 的子资源（字体、脚本、图片）允许加载，以便 Vite/Next 应用能渲染。访客页使用按会话 cwd（缺失时为 `shared`）sha256 散列的 persist 分区（`persist:dshd-preview-` 前缀），不携带用户 API key（与 harness web 相同：凭据请求不跟随重定向）。非 Electron 时，空态卡和本面板显示 `Browser previews are only available in the desktop app.` occupant 挂载期间持续列出发现的 loopback 端口；每条发现结果仅为 `{ url, port }`（无进程名；Unix `lsof` 也未接入）。点击芯片会打开或导航访客页。铬是图标后退／前进／刷新（加载中为停止）、回车提交的 `Input`（占位「搜索或输入 URL」）、访客页尚未打开时也可使用地址栏 URL 的系统浏览器图标，以及「更多」菜单：强制刷新、开发者工具、打开／关闭独立预览窗口、显示／隐藏设备工具栏、选取元素、开始／停止录制、截图、外观（系统／浅色／深色）、缩小／`N%`／放大／重置、清除 Cookie、清除缓存。「显示设备工具栏」通过 `previewResize`（`setBounds`）把 guest `BrowserView` 收到设备矩形（工具栏 32px、轨道 10px），并在剩余 `.host` 信箱空位上绘制该铬（`--dsw-alias-bg-base`）；不调用 CDP `Emulation.setDeviceMetricsOverride`。选取元素在存在 `appendComposerText` 和 session 时把 markdown 插入输入框。录制是宿主渲染进程的 `MediaRecorder`；帧经 IPC 到达，成品落在 `userData/preview-recordings/`。占用隐藏条件是 `overlayOpen || pipOpen`（「更多」、设备预设菜单、PiP）。主框架加载失败显示「无法打开此网站。」。guest 的 `did-navigate`／`did-navigate-in-page` 发出 `shell:preview-state-change`，地址栏和前进／后退跟随页内导航。非活动或被渲染进程 chrome 遮挡的 surface Tab 会保留 guest，同时通过 `previewHide` 移除原生视图；关闭浏览器 Tab 卸载面板并调用 `previewClose`。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；PreviewPanel 仍由 slot 注册封装在包内。

## 模型体验

无。Browser 面板只预览 http(s) URL；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **同一时间只有一个访客页**：surfaces store 只持有一个 preview；occupant 内没有标签条。
- **设备工具栏不模拟 CSS 视口**：`previewResize` 把 `BrowserView` 收到缩放后的可见矩形。预设放不进宿主时，页面按该较小视图排版；没有 CDP `Emulation.setDeviceMetricsOverride`。
- **发现芯片没有进程名**：每条结果在所有平台都是 `{ url, port }`；Unix `lsof` 也未接入。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。

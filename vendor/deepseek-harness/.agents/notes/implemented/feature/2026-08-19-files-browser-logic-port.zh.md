# Agent Note: Files/Browser 逻辑移植

Status: implemented

[English](2026-08-19-files-browser-logic-port.md) | 中文

## 问题

桌面 Files 与 Browser occupant 已经拥有搜索、保存和 loopback 访客页，但没有带上本地参考桌面已交付的其余工作环：公网 https 访客页、树拖进输入框、跳行、批注进输入框、用编辑器打开、PiP、设备工具栏、选取、录制，以及在现有 guest 上的 CDP 自动化。运行时导入那棵树会把本产品绑到另一品牌的 Effect/Atom/Schema 栈、Pierre 铬，以及第二份 Chromium。

## 决策

本桌面从本地参考树 `C:\Ai\t3code` 移植这些 Files/Browser 工作环，并把所有存活标识重命名为 `dshd`。Effect/Atom/Schema 剥离为 Promise 与 `webContents`。不交付 Playwright Chromium、`playwright-core` 和 `__t3PlaywrightInjected`；自动化是现有 guest 上的 CDP。铬仍是官方 dsh `ui-primitives` 加 `--dsw-alias-*`（不用 Pierre、lucide、shadcn 或 Tailwind）。

guest BrowserView 为 `contextIsolation: false`、`sandbox: true`、`nodeIntegration: false`，以便选取浮层使用 `ipcRenderer`。Harness 主窗口保持 `contextIsolation: true`。PiP 窗口保持 `contextIsolation: true`。访客页文档可以是任意 `http(s)`；`file:` 文档会被取消。地址栏 `normalizePreviewUrl` 把裸 loopback 主机当成 `http`，把裸公网主机当成 `https`。Harness 主窗口的 loopback 墙不变。

dshd 额外能力保留：未保存 Tab 的继续编辑／放弃／保存、`error.changed`、占用隐藏（`overlayOpen || pipOpen`），以及带 token 前缀的工作区文件服务。到达 guest 的预览 IPC 只经 harness 授权。录制是宿主渲染进程的 `MediaRecorder`；成品落在 `userData/preview-recordings/`。

## 考虑过的替代

**原样导入 Effect。** 否决：本桌面主进程是 Promise 与 `webContents`，不是 Effect；为一个 occupant 保留外来运行时等于拥有第二套异步模型。

**假装「更多」菜单项。** 否决：菜单写出 PiP、选取或录制却没有对应 IPC，等于撒谎。

**再打一份 Chromium。** 否决：Playwright 的浏览器下载会撑破 electron-builder；CDP 打在现有 guest 上才是接线。

**把 Pierre 拷进 slot 树。** 否决：设计语言要求 `ui-primitives` 和 `--dsw-alias-*`；第二套图标／组件库是第二层皮。

**关掉 guest `sandbox`。** 否决：选取需要 guest 里的 `ipcRenderer`，`contextIsolation: false` 已经提供；sandbox 保持开启。

**让 Harness 主窗口打开公网 http(s)。** 否决：主窗口仍加载 harness UI 和用户 API key；只有访客页文档可以是公网 `http(s)`。

## 后果

guest、主窗口与 PiP 的隔离是拆分，不是同一份 preference。选取浮层 IPC 只在 guest 里可用。录制帧经 IPC 进入宿主渲染进程；没有第二份浏览器。`userData/preview-recordings/` 下的成品是桌面本地文件。仅 harness 的预览 IPC 仍经 `window.shell` 授权；boot 窗口永远收不到 guest 控制通道。

## 测试

`src/main/workspace-fs.test.js` 钉 1 MiB 上限与穿越。`src/main/preview.test.js` 钉公网 https 访客页、选取、PiP 隔离，以及对着 fake 的自动化方法接线。`src/main/preview-session.test.js` 钉 guest webPreferences 与残留 UA token 剥离。`src/preload/shell-api.test.js` 钉已授权的预览 IPC。`ui-files` 钉无上限搜索、提及拖放、revealLine、添加到对话。`ui-preview` 钉含 PiP 的 More 占用隐藏、设备工具栏 `setBounds`、选取 markdown，以及用假 recorder 的宿主 MediaRecorder。未证明 live Electron MediaRecorder 和真实 guest 上的 live CDP。

## 相关

[右边栏与终端工作环](2026-08-16-surfaces-terminal-work-loops.zh.md) 拥有本移植补全的 Files/Browser/Terminal 工作环。[对话链接进入 Files 与 Browser](2026-08-19-conversation-surface-links.zh.md) 拥有 html/svg 双开与带 token 的工作区文件服务。

# Agent Note: Surfaces workbench depth

Status: implemented
Archived: 2026-08-25

[English](2026-08-15-surfaces-workbench-depth.md) | 中文

## Problem

官方第四列（`surfaces`）从五张空态卡打开一个 occupant 后，打开文件会丢掉 Files 资源管理器，也无法再开第二种面板，聊天里点路径则交给操作系统。桌面工作台需要树常驻、能再开其他种类的 Tab 条、图片与 Markdown 预览、Diff 上的暂存/取消暂存/还原，以及可点子代理行；同时不能改成 portal 侧栏或第二套宿主 HTTP API。

## Decision

聊天打开文件仍然汇到 `ctx.workspaces.openPath`。`@deepseek-ai/dsh-client-ui-surfaces` 包装该方法，仅在存在 `window.shell.listDir` 且路径位于当前会话 cwd 内时，写入 surfaces store 的 `openFile` 并调用 `layout.openSurfaces()`。网页 lane 没有 `listDir`，一律回落到原来的打开方式。`openFile` 保留 `files` 单例，并并列加上 `file:<relativePath>` Tab。Tab 条提供 `+`（已打开的单例项禁用）、中键关闭、右键关闭菜单，以及非 passive 的滚轮转横向滚动。Tab 按会话持久化在 `dsh-surfaces:v1:<sessionId>`；未知 kind 丢弃。

`ui-files` 通过 `appendToDraft` 插入 markdown 文件链接，复制相对/绝对路径，刷新树，并用 `readFileMedia` 预览图片、用带 `codeLabels` 的 `MarkdownText` 预览 Markdown。`ui-agents-panel` 在 `subagentAddress` 存在时用 `sessions.openSubagent` 打开目录子项，否则 `sessions.open`，并只读列出 `jobsBySession`。`ui-diff` 接收 owner `openFile`，在有 `gitStatusEntries` 时按已暂存/未暂存分组，并通过仍走 `workspace-authority`（启动工作区加上 harness 已注册工作区路径）的新 IPC 暂存/取消暂存/还原。标题栏 `gitCommit` 仍是 `git add -A`。已授权但不是 git 工作树的 cwd 返回 `{ isRepo: false }`；尾簇控件显示「初始化 Git」（`gitInit`），而不是灰色提交按钮。省略 `hasPrimaryRemote` 时按 false。标题栏没有插件市场窗口控件。`PanelToggles` 响应 Ctrl/Cmd+\\ 与 Ctrl/Cmd+`，但在 input、textarea、contenteditable 内不抢键；终端面板（`[data-terminal-pane]`）内抽屉和弦仍生效，右侧栏和弦留给 PTY。用户终端是以 `--dsw-*` 别名取色的 Ghostty Canvas surface；Windows 上按 `pwsh.exe` → `powershell.exe` 候选链以 `-NoLogo -NoProfile` 启动。

surfaces 列仍是官方布局槽。没有 `document.body` portal、`/sidebar/api`、第二套 `node-pty`、`registerTab` 服务、任意 HTTPS iframe、PDF/Office 预览、模型可见的 `terminal_*`，也没有底栏第二工作台。

## Alternatives considered

**预装 `dsh-better-sidebar`。** 否决：它 portal 出官方列、钉在更旧的 harness、拒绝 localhost（与我们的 Browser 相反），也没有 push。要借鉴的是 `openPath` 漏斗和 Tab 壳，不是那套宿主。

**改 `ui-conversation` 的 `openFile` 或抢 `conversation.chat.turnTail`。** 否决：生产里聊天打开已经全部走 `workspaces.openPath`。只包装这一个方法就能覆盖工具行和提及，不必再注入一次。

**用预览页换掉 Files Tab。** 否决：资源管理器必须留下，用户才能再打开另一个文件而不回到空态网格。

**本变更就做可写预览（`writeFile` + Ctrl+S）。** 否决：图片和 Markdown 预览不依赖写入路径；可写仍暂缓。

## Consequences

桌面端在聊天里点路径会打开右侧栏，且 Files 仍在。网页 e2e 不得断言接管。Diff 暂存不改变标题栏 Commit。文件预览仍只读。occupant 包继续通过 `window.shell` 加多根工作区授权做 listing/read/git；不新增宿主 HTTP/WS 服务。

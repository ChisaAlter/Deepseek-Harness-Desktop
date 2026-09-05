# @deepseek-ai/dsh-client-ui-files

[English](README.md) | 中文

右边栏 Files occupant：在 `surfaces.files` 上展示只读工作区树，在 `surfaces.file` 上展示单文件预览。两个槽位都是 `single` + `session-maybe`，由 ui-surfaces 声明。点击文件会调用 owner 的 `openFile(relativePath)`。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

工作区根是当前会话的 `cwd`，只通过一次 `useSessions` 读取。目录与文件字节来自桌面 `window.shell` 的 `listDir`／`readFile`／`readFileMedia`／`writeFile`；渲染进程不加载 Node。目录按需展开，树顶可以按文件名搜索（工作区根下无上限 DFS；完整路径的选择器行打开文件）。在输入框键入 `@` 走官方 ui-reference，不是 Files 的 path 菜单。提及是行内控件写入输入框（markdown 文件链接），没有 session id 时不展示；文件树行可拖进输入框，载荷同样是该 markdown 链接（`application/x-dshd-composer-mention`）。技能走官方 `/`（ui-skill）。根目录列出未完成时显示列出中，不画空目录。刷新会重载根目录；搜索进行中时会重新走搜索，不会丢掉嵌套匹配。右键可在文件夹中显示、用已探测到的编辑器打开，或用系统默认程序打开。右键复制相对或绝对路径。图片以 data URL 渲染；未超出 1 MiB 读取上限的文本可编辑保存（写入上限同样 1 MiB）；保存失败时编辑器和未保存缓冲区仍在，错误显示在上方。Tab 变为活动时 FilePreview 会重读磁盘。脏草稿在重读失败、返回截断或二进制、或当时没有 cwd 时仍留在编辑器（含 Markdown 源码）；只要有 cwd 就可以保存，写入成功后清除截断／二进制标记。保存会先重读；若磁盘相对基线和草稿都已变化，则保留草稿并显示 `error.changed`，再次保存才覆盖。surfaces 壳把未保存草稿写入 localStorage，刷新或退出后再打开仍能恢复。`.md` 可在源码与 `MarkdownText` 之间切换。跳行（`revealLine`／`revealRequestId`）会滚动源码 textarea，并在该次跳行未处理完时强制显示源码。源码里选中若干行后会出现「添加到对话」，把该 `L` 范围和 `text` 围栏追加到输入框；点击外部或 Escape 会收起选区。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；FilesPanel、FilePreview 与 FileTree 仍由 slot 注册封装在包内。

搜索先按文件名或路径子序列过滤本地文件列表，再应用结果数量上限。不匹配的文件不显示；空查询保留文件顺序。

## 模型体验

无。Files 面板只为展示读取工作区；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **树不改工作区结构**：没有新建、重命名、删除。

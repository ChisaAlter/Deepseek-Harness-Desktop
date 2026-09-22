# 文件栏与浏览器：搬逻辑、去标记、变成 dshd

右边栏 Files / Browser 要对齐对照源（本地 `C:\Ai\t3code`）里已经跑通的行为。拷进来的源码去掉对照源产品标记，改成 `dshd` 自己的名字。铬仍走 Harness `ui-primitives` + slot（贴 Pierre/lucide 会让官方 WebUI 铬失效）。函数体按原文落地，只剥 Effect/Atom/Schema 外壳。

## 决定

1. **没有「不能搬」清单。** 对照源 Files / Preview 上出现的方法、字段、菜单项、手势，全部接到 dshd，并且接完后能用。唯一排除：原样 import 会让应用崩掉或让**已经能用的相关功能**失效。那种情况改接法，不删能力。
2. **会崩 / 会让相关功能不能用 → 改接法，不删能力。**

   | 原样动作 | 为什么不行 | 改接法（能力仍要有） |
   |---|---|---|
   | `import` Effect `PreviewManager.ts` / Atom `projectFilesQueryState` | 编不过 | 剥 `webContents.*` / `listDir`+`readFile` 到 Promise |
   | 给客人再开一条无人连接的预览 WS | 没有多客户端，WS 是死功能 | 每个 WS 方法变成已有 `shell:preview-*` IPC |
   | `registerWebview(webContentsId)` | 客人已在 main `BrowserView`，没有渲染进程 webview id | `attach()` 已有 `webContents`；方法直接打在它上面 |
   | 把 `@pierre` / lucide / shadcn / Tailwind 推进 slot 树 | 官方 `dsh web` 铬失效 | 行为接到现有 `FileTree` / `Menu` / textarea |
   | 用对照源 `/model` 解析器替换 Harness 斜杠命令 | 现有 `/` 命令失效 | `detectComposerTrigger` 只接 `@path` / `$skill`；`/` 仍走 `ui-commands` |
   | 给客人 `nodeIntegration: true` 或关掉 `sandbox` | 任意预览页拿到 Node | 点选与对照源相同：`contextIsolation: false` + **`sandbox: true`** + `nodeIntegration: false`（仅客人 BrowserView） |
   | 主窗口也允许非 loopback | 对话 WebUI 导航墙失效 | 只有客人预览分区放开 http(s) |

3. **标记替换。** `t3code`、`T3-`、`T3 Code`、`@t3tools`、`persist:t3code-`、`application/x-t3code-*`、`t3code.` localStorage 键 → `dshd` / `dshd-` / `persist:dshd-` / `application/x-dshd-*` / `dshd.`。注释英文，产品文案中文。生产源里不留对照源品牌。
4. **地址栏跟 `normalizePreviewUrl`。** 裸 loopback → `http`，裸公网主机 → `https`。客人允许 http(s) 文档。主窗口 loopback 墙不动。`file:` 文档拒绝。工作区 html/pdf/svg 仍走 token 前缀的 `127.0.0.1` 静态服务。
5. **不做假按钮。** 菜单项出现则 IPC 必须成功路径可用。
6. **这边多出来的保险保留。** 关脏 tab Keep/Discard/Save、`error.changed`、`previewHide`/`occluded`、token 工作区文件服务器。

## 命名

| 对照源 | dshd |
|---|---|
| `persist:t3code-preview-` + sha256(scope) | `persist:dshd-preview-` + 同样 hash |
| `application/x-t3code-composer-mention` | `application/x-dshd-composer-mention` |
| `t3code.fileExplorerOpen` / `t3code.renderMarkdown` | `dshd.fileExplorerOpen` / `dshd.renderMarkdown` |
| `tab_` 预览 id 前缀 | `dshd-tab_` |
| `PreviewUrlNormalizationError` | 同名普通 Error（不引进 Effect Schema） |
| `FileSaveCoordinator` | 同名；`persist` 返回 `{ ok: boolean }` |
| `--t3-primary` 等客人 overlay 变量 | `--dshd-preview-*`，值来自 `--dsw-alias-*` |

## 文件栏要接上的字段/方法

`serializeComposerFileLink`、`serializeComposerMentionPath`、`detectComposerTrigger`（仅 `@` / `$`）、`FileSaveCoordinator.change/dispose`、`fileBreadcrumbs`、`isMarkdownPreviewFile`、`setMarkdownTaskChecked`、`fileContentRevision`、`projectFileCacheKey`、`resolveCenteredFileLineScrollTop`、`clampFileLine`、`createFileTreeDragMentionController`、`isWorkspaceBrowserPreviewPath`（htm/html/pdf）、`isWorkspaceImagePreviewPath`、`installFileEditorDismissal`（textarea 等价）、`nextFileCommentId` / `normalizeFileCommentRange` / `formatFileCommentRange` / `remapFileCommentAnnotations`、选区加到输入框、`getProjectFilePickerMatches`、store `file.revealLine` + `revealRequestId`、右键 Copy mention / Add to chat / 在文件夹中显示 / 用已探测编辑器打开、gitignore 过滤的 `listDir`、读 1 MiB、写 `mkdir` recursive。

## 浏览器要接上的字段/方法

对照源 `PreviewManager` 返回值里的每一个（改接法见上表，不删）：

`setMainWindow`（已有主窗）、`getBrowserSession` / `isBrowserPartition` / `getBrowserPartition`、`createTab`（现有 `previewOpen`）、`closeTab`（`previewClose`）、`registerWebview`（改接为 attach 已有 wc）、`navigate`、`goBack`、`goForward`、`refresh`、`zoomIn` / `zoomOut` / `resetZoom`、`hardReload`、`setColorScheme`、`openDevTools`、`clearCookies`、`clearCache`、`setAnnotationTheme`、`pickElement` / `cancelPickElement`、`captureScreenshot`、`revealArtifact`、`copyArtifactToClipboard`、`openPictureInPicture` / `closePictureInPicture`、`startRecording` / `stopRecording` / `saveRecording`、`automationStatus` / `Snapshot` / `Click` / `Type` / `Press` / `Scroll` / `Evaluate` / `WaitFor`、`subscribeStateChanges` / `PointerEvents` / `RecordingFrames`。

另：`normalizePreviewUrl`、`isLoopbackHost`、`isPreviewableUrl`、`newPreviewTabId`、`COMMON_DEV_PORTS`（17 口）、设备工具条视口预设（用 `setBounds` 做出 CSS 视口那块矩形）、`did-start-loading` / `did-stop-loading` / `did-fail-load`、客人 `before-input-event`、权限白名单、去 Electron UA。

## 客人安全（点选要能用）

对照源 picker 要读页面 `__REACT_DEVTOOLS_GLOBAL_HOOK__`，所以客人 `contextIsolation=false`，但 **`sandbox=true`、`nodeIntegration=false`**。dshd 客人 BrowserView 采用同一组。Harness **主窗口**仍 `contextIsolation: true`。preload 只合成 `ipcRenderer`，不把 Node 漏给页面。

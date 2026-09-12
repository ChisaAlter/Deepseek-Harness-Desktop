# Feature: Surfaces work loops

| Field | Value |
| --- | --- |
| **id** | `surfaces-work-loops` |
| **status** | `active` |
| **last verified** | 2026-09-11 — 新增 Browser guest 的 `dshd mini-player` renderer 浮层：复用同一 `previewId`，挂载 `shell.overlay`，聊天区域内可拖拽/八方向缩放并可恢复右栏 Browser；未新增 BrowserView/IPC。focused ui-preview、bundle、`npm test`、`smoke:source` 通过；`test:gui` 在功能 revision 全量通过，后续几何回归轮唯一失败为独立 PDF license 打包子进程超时。此前同日 `PresentedFileCard` 原生操作完成后在菜单卸载后的 layout phase 恢复预览按钮焦点；`Menu` 首次打开等待 portal 挂载后再 autofocus，避免 Escape/动作竞态；caption no-drag、模型菜单隔离与工作环契约保持。 |

## User paths

1. `Ctrl+\` 打开右栏 → Files 搜索 / 预览 / 送对话。
2. 点击对话文件提及、工具路径或产物芯片 → HTML / HTM / XHTML / PDF 进 Browser，其余工作区文件进 Files；点工作区根目录打开 Files 资源管理器。
3. Files：点预览工具栏的悬浮图标 → 当前文件在单独的置顶只读窗口展示；继续打开文件会复用该窗口。
4. Browser：输入 URL、导航；可选截图 / PiP / 录制。
5. Browser：点击工具栏 `dshd mini-player` 按钮后，预览浮在聊天可视区内；拖拽标题条或边/角调整大小，点击恢复按钮回到右栏并保留当前 URL / history。
6. Diff / Agents 按当前 UI 可用。
7. Surface Tab 关闭控件在标题**右侧**。

## Invariants

- 本地 Files 搜索按文件名或路径子序列过滤后再限量；不得把未过滤的目录遍历结果当作已过滤的服务端结果。

- 右栏是**工作环**（搜、导航、选区进对话），不是空态功能卡片网格。
- 空态面板选择卡（`EmptyState`）是**方块瓷砖**：两列、内宽上限 320、`aspect-ratio: 1 / 1`、间距 8、圆角 12，图标/标题/描述垂直堆叠居中——不是横向长条卡。几何钉在 [design-language.md](../design-language.md) 布局段；`harness-desktop-forks.js` 的 `FORK_FILE_MARKERS` 守 `EmptyState.module.css` 的 `max-width: 320px` + `aspect-ratio: 1 / 1`，上游 sync 把它打回长条会炸门禁。改几何先改设计语言文档。
- 不做 note 标明的范围外能力：GPU 终端嵌入、worktree、turn-diff、review-comment pick（勿假装已有）。
- Tab 关闭在标题右侧，未经用户明确要求不挪到左侧。
- 显式保存与防抖落盘走同一 `FileSaveCoordinator` 队列，保存期间敲入的字符保持未保存；搜索会话只走一次树、键击内存过滤（Refresh 重走）。
- `shell:preview-automation-*` 链已删除，不得在无新卡+权限模型的情况下复活。
- browser-doc 扩展名单一事实：`{html, htm, xhtml, pdf}`（openPath 双开与 FilePreview 工具栏同集合）；SVG 按图片留在 Files。
- Files 悬浮预览是工作区权威内的单实例只读窗口：不得绕过 `preview-workspace` token URL，不得把编辑缓冲区或保存队列迁入悬浮窗；HTML 只在 sandbox frame 中运行，图片 / 音视频 / PDF / 文本按浏览器原生只读能力展示。
- `dshd mini-player` 只改变 Browser guest 的呈现边界：状态为 `surface | mini` 时同一 `previewId` 只能有一个 `previewShow/previewResize` owner；mini 几何限制在聊天可视区并使用 pointer capture，恢复后 URL、history、loading 状态不丢；不得创建第二个 BrowserView、外部窗口或 mini 专用 IPC。
- 对话 / 产物 / 工具行 / 终端 / 技能的文件打开都走 `workspaces.openPath`；pin 的 Workspace 服务没有该方法时由 ui-surfaces `ensureBaseOpenPath` 补 Host 本体，ui-chat `openFile` 不得绕过它直连 `remote.session.openWorkspacePath`。当前 Session cwd 内的路径由右栏接管；根目录开 Files，浏览器文档在保留 Files Tab 后激活 Browser，其余文件激活 Files。
- `gitInit` 成功广播 `dshd-git-init`，Diff 门无需切会话即重探。
- 桌面隐藏 rc.1 新增的会话 header 角位展开钮：`harness-chrome-inject.js` 注入样式 `[data-sidebar-right-expand]{display:none}`——它与 titlebar trailing 既有的面板切换键重复；右栏开合入口统一在 titlebar。
- Files 保存拒绝任何含 `.git` 段的路径（大小写不敏感，含 `.git` gitlink 本体）；`listDir` 隐藏 `.git` 与之同一契约。`.gitignore` / `.github/**` 等普通 dotfile 照常可存。

## Allowed touch

- Harness surfaces 相关 client 包（如 `ui-files`、`ui-surfaces`、browser/preview 接线）
- `src/main/preview*.js`、`workspace-fs.js`（Files 供数）
- `src/preload/index.js` 的 preview/surfaces 注入面（2026-08-25 硬化计划扩围，用于 automation 链删除）
- `src/preload/file-preview.js`、`src/renderer/file-preview.*`、`src/shared/themes.js`（悬浮文件窗）
- 本卡、design-language 与 handbook surfaces / IPC 附录

## Do not touch

- 把空态卡片墙当「做完」
- 挪动 Tab 关闭位置（除非用户明确要求）
- 底栏终端契约（见 `terminal-drawer`）除非一并 Touching

## Gates

| Kind | What |
| --- | --- |
| Automated | 相关 client / preview / preload / theme 单测；`npm run qa:source` |
| Manual / QA | `TC-SURF-001` … `TC-SURF-008`；Files 图片 / 文本 / PDF 悬浮预览；`TC-CHAT-007`、`TC-CHAT-008` |

## Sources

- Handbook：[../handbook/modules/surfaces.md](../handbook/modules/surfaces.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- 悬浮文件预览 Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-07-floating-workspace-file-preview.md`
- AGENTS.md Surfaces 段
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)

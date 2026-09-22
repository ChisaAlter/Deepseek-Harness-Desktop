# Feature: Surfaces work loops

| Field | Value |
| --- | --- |
| **id** | `surfaces-work-loops` |
| **status** | `active` |
| **last verified** | 2026-09-22 — 桌面端收敛为**一条可见右栏**：`ui-sidebar-right` 是唯一呈现所有者，旧 `ui-surfaces` 的 `surfaces` 槽保留为 0 宽度休眠兼容层，任何桌面生产包不得再注册 `surfaces` / `surfaces.*` 或以 `openSurfaces()` 重新打开。Files / Terminal / Browser / Diff / Agents 五类入口都落在原生 Sidebar；标题栏按钮与 `Ctrl+\` 调同一个 `sidebarRight.toggleExpanded()`，按下态读 `rightbarShown`。原生悬浮预览改由 Sidebar 文档预览头部的通用 `sidebar.right.tab.document.actions` 槽触发（Desktop 侧 `ui-files` 贡献），支持 `{cwd, relativePath}` 与无 cwd 的 `{absolutePath}`，成功要求 `ok === true`，失败可见且绝不改走系统打开器或 Browser 兜底；preview 专用 authority 以 `allowScratchCwd: true` 支持 Host scratch 只读预览。此前 2026-09-22 — PTC 产出的文件纳入收尾正文点击词表；2026-09-21 — 聊天文件点击进入新版右侧 Sidebar。 |

## User paths

1. `Ctrl+\` 打开右栏 → Files 搜索 / 预览 / 送对话。
2. 点击对话文件提及、工具路径或产物芯片 → 发起点击的 Session 在右栏文档预览打开或聚焦对应文件；HTML / HTM / XHTML / PDF 同时保留文件资源页并由 Browser 承接，其余工作区文件由 Document Preview 展示；点工作区根目录打开 Files 资源管理器。
3. 收尾正文里的行内代码文件名与某一轮成功产出或交付的文件唯一匹配（精确路径，或唯一 basename）→ 保持代码芯片外观，点击后在发起该消息的 Session 右栏打开该文件；PTC 子调用成功写入的文件同样进入该词表。同名路径不唯一时保持不可点击。
4. Files：在统一右栏的文件 / 文档预览头部点“悬浮预览” → 当前已保存文件在单独的置顶只读原生窗口展示；继续打开文件会复用该窗口。新版 Sidebar DockKit float 只生成页内浮层，不是该原生窗口。
5. Browser：输入 URL、导航；可选截图 / PiP / 录制。
6. Browser：点击工具栏 `dshd mini-player` 按钮后，预览浮在聊天可视区内；拖拽标题条或边/角调整大小，点击恢复按钮回到右栏并保留当前 URL / history。
7. Diff / Agents 按当前 UI 可用。
8. Surface Tab 关闭控件在标题**右侧**。

## Invariants

- 本地 Files 搜索按文件名或路径子序列过滤后再限量；不得把未过滤的目录遍历结果当作已过滤的服务端结果。

- 桌面只有一条可见右栏：`@deepseek-ai/dsh-client-ui-sidebar-right` 是唯一呈现所有者，是**工作环**（搜、导航、选区进对话），不是空态功能卡片网格。上游 `surfaces` 槽 / `layoutInfo.surfaces` / `openSurfaces` / `toggleSurfaces` / 旧布局持久化字段保留为休眠兼容层，但桌面组合中必须恒为 0 宽度且无人占用。禁止任何桌面生产包注册 `surfaces` / `surfaces.*` 或调用 `openSurfaces()` / `toggleSurfaces()`。契约由 `src/shared/single-right-panel-contract.test.js` 与 `harness-desktop-forks.js` 的 `FORK_FILE_MARKERS` 守卫。改这条契约先改 [design-language.md](../design-language.md) 与决策记录。
- 不做 note 标明的范围外能力：GPU 终端嵌入、worktree、turn-diff、review-comment pick（勿假装已有）。
- Tab 关闭在标题右侧，未经用户明确要求不挪到左侧。
- 显式保存与防抖落盘走同一 `FileSaveCoordinator` 队列，保存期间敲入的字符保持未保存；搜索会话只走一次树、键击内存过滤（Refresh 重走）。
- `shell:preview-automation-*` 链已删除，不得在无新卡+权限模型的情况下复活。
- browser-doc 扩展名单一事实：`{html, htm, xhtml, pdf}`（openPath 双开与 FilePreview 工具栏同集合）；SVG 按图片留在 Files。
- Files 悬浮预览是工作区权威内的单实例只读窗口：不得绕过 `preview-workspace` token URL，不得把编辑缓冲区或保存队列迁入悬浮窗；HTML 只在 sandbox frame 中运行，图片 / 音视频 / PDF / 文本按浏览器原生只读能力展示。
- `dshd mini-player` 只改变 Browser guest 的呈现边界：状态为 `surface | mini` 时同一 `previewId` 只能有一个 `previewShow/previewResize` owner；mini 几何限制在聊天可视区并使用 pointer capture，恢复后 URL、history、loading 状态不丢；不得创建第二个 BrowserView、外部窗口或 mini 专用 IPC。
- 对话 / 产物 / 工具行 / 终端 / 技能的文件打开都走 `workspaces.openPath`；pin 的 Workspace 服务没有该方法时由 ui-surfaces `ensureBaseOpenPath` 补 Host 本体，ui-chat `openFile` 不得绕过它直连 `remote.session.openWorkspacePath`。桌面接管层把发起 Session 内的路径交给右侧 Sidebar 的 `sidebarRight.openResourceIn(sessionId, fileAddressFor(...))`；根目录开 Sidebar Files，浏览器文档保留带行号文件资源后由发起 Session 激活 Sidebar Browser，其余文件打开文件资源。Sidebar 缺失或目标 Session 没有 adopted store / 同 Session live binding 时保留 Host 兜底；Sidebar 已命中却导航失败时显式失败，不得静默改走 Host 打开器。
- `ui-deliverables` 的收尾正文行内代码词表只来自该轮权威事实：成功的根级或 PTC `write` / `edit` / 有修改作用的 `str_replace_editor`，以及显式 `deliverables/presented`。PTC 的轮次归属只取 Conversation assembler 已解析的 Location（`turn`/`step`）；`unresolved`、`session`、失败结果、读取/查看、未知工具和畸形参数不贡献，不得按邻近事件、`rootCallId`、当前轮次或路径外观猜测。精确路径或唯一 basename 才解析，同名不唯一保持惰性。
- Location 会影响 `match` 归属后，assembler 在 `prepend`/边界 `append` 重建 Location 时必须对先前返回 null 的 (Definition, 事件) 重新判定并回填；已拥有该事件的 Definition 不得重复匹配，`mergeMatches` 的重复检测与 target/fallback 仲裁保持不变。缺少这层回填时，最近分页里先以 `session`/`unresolved` 到达、再被老页解析出 Turn/Step 的事件会永久丢失归属。
- 缺 `cwd` 的绝对 Session 文件路径仍走右侧 Sidebar 文件资源；客户端摘要有真实 `cwd` 时按该 `cwd` 解析相对路径，绝不按目录名字符串识别 no-workspace，也不为缺 `cwd` 的相对路径猜 scratch 根目录。
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

- Decision: [聊天文件预览迁移到右侧 Sidebar 资源路由](../decisions/implemented/bug-fix/2026-09-21-chat-file-sidebar-resource-route.md)
- Decision: [PTC 产出的文件纳入收尾正文的点击词表](../decisions/implemented/bug-fix/2026-09-22-ptc-produced-file-mentions.md)

- Handbook：[../handbook/modules/surfaces.md](../handbook/modules/surfaces.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- 悬浮文件预览 Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-07-floating-workspace-file-preview.md`
- AGENTS.md Surfaces 段
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)

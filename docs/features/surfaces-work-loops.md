# Feature: Surfaces work loops

| Field | Value |
| --- | --- |
| **id** | `surfaces-work-loops` |
| **status** | `active` |
| **last verified** | 2026-09-05 — CI 包实测发现 Files 搜索未排除无关文件；最小源码修复已通过 ui-files 15 文件 / 172 测试和 tsc。旧包 TC-SURF-001 仍为 Fail，须新 CI 包复测。此前：2026-09-04 — 空态选卡改方块瓷砖（用户要求：不要长矩形）：`EmptyState.module.css` 纯 CSS（inner 上限 480→320、卡片 `aspect-ratio: 1 / 1`、图标/标题/描述垂直堆叠居中、去 `min-height` 64），DOM 与令牌不变；设计语言文档（zh/en 布局段）先行钉几何；ui-surfaces 10 文件 86 测试全绿、`build:official` 已重建。此前 2026-09-02 — 修复对话里 `.html` 等文件点开弹系统浏览器：`dsh-v0.1.2-alpha.2` pin 的 `WorkspaceController` 不再带 `openPath`，ui-surfaces 的 `wrapOpenPath` 因此静默变 no-op，ui-chat `openFile` 直连 `remote.session.openWorkspacePath`（Host 系统打开器）。现 ui-surfaces `ensureBaseOpenPath` 在缺失时先装 Host 本体再包拦截器，ui-chat `openFile` 优先走 `workspaces.openPath`；ui-surfaces `apply.client.spec` +5、ui-chat `apply-inject.client.spec` +1，四文件 43 测试全绿，两包 `tsc --noEmit` 干净，`lib/client.js` 已重新 bundle。此前 2026-08-26 — 空态卡片压扁为紧凑矩形（图标与标题同行、描述占满下行，`min-height` 112→64px，padding 16→10/12px；仅 `EmptyState.module.css`，令牌不变），ui-surfaces 11 文件 88 测试全绿。此前 2026-08-25 — `workspace-fs.writeFile` 增加 `.git` 段拦截（安全审查 L-4），`workspace-fs.test.js` 9/9 绿。此前同日（合并树 `ea659884`，consolidation #39 落地后）— desktop `npm test` 997/0/3 绿；harness `test:gui` 409 文件 5338 绿（`node-half.client.spec.ts` 源面解析修复后 0 红）；`qa:source` surfaces/terminal/files/diff/agents 步骤全 PASS（同日第二轮：壁纸三步归因为 walk 英文匹配缺口并修复后，qa:source 整表全绿 exit 0）。此前同日：硬化计划 PR-A~D（保存竞态串行化、preview-automation 全链删除、preview-workspace 流式+上限、每搜索会话一次 walk + 批量 check-ignore、persist 死字段清除、gitInit 后 Diff 门重探、草稿上限按字节） |

## User paths

1. `Ctrl+\` 打开右栏 → Files 搜索 / 预览 / 送对话。
2. Browser：输入 URL、导航；可选截图 / PiP / 录制。
3. Diff / Agents 按当前 UI 可用。
4. Surface Tab 关闭控件在标题**右侧**。

## Invariants

- 本地 Files 搜索按文件名或路径子序列过滤后再限量；不得把未过滤的目录遍历结果当作已过滤的服务端结果。

- 右栏是**工作环**（搜、导航、选区进对话），不是空态功能卡片网格。
- 空态面板选择卡（`EmptyState`）是**方块瓷砖**：两列、内宽上限 320、`aspect-ratio: 1 / 1`、间距 8、圆角 12，图标/标题/描述垂直堆叠居中——不是横向长条卡。几何钉在 [design-language.md](../design-language.md) 布局段；`harness-desktop-forks.js` 的 `FORK_FILE_MARKERS` 守 `EmptyState.module.css` 的 `max-width: 320px` + `aspect-ratio: 1 / 1`，上游 sync 把它打回长条会炸门禁。改几何先改设计语言文档。
- 不做 note 标明的范围外能力：GPU 终端嵌入、worktree、turn-diff、review-comment pick（勿假装已有）。
- Tab 关闭在标题右侧，未经用户明确要求不挪到左侧。
- 显式保存与防抖落盘走同一 `FileSaveCoordinator` 队列，保存期间敲入的字符保持未保存；搜索会话只走一次树、键击内存过滤（Refresh 重走）。
- `shell:preview-automation-*` 链已删除，不得在无新卡+权限模型的情况下复活。
- browser-doc 扩展名单一事实：`{html, htm, xhtml, svg, pdf}`（openPath 双开与 FilePreview 工具栏同集合）。
- 对话 / 工具行 / 终端 / 技能的文件打开都走 `workspaces.openPath` 这一个词汇；pin 的 Workspace 服务没有该方法时由 ui-surfaces `ensureBaseOpenPath` 补 Host 本体，ui-chat `openFile` 不得绕过它直连 `remote.session.openWorkspacePath`（那会让 html 落到系统浏览器）。
- `gitInit` 成功广播 `dshd-git-init`，Diff 门无需切会话即重探。
- Files 保存拒绝任何含 `.git` 段的路径（大小写不敏感，含 `.git` gitlink 本体）；`listDir` 隐藏 `.git` 与之同一契约。`.gitignore` / `.github/**` 等普通 dotfile 照常可存。

## Allowed touch

- Harness surfaces 相关 client 包（如 `ui-files`、`ui-surfaces`、browser/preview 接线）
- `src/main/preview*.js`、`workspace-fs.js`（Files 供数）
- `src/preload/index.js` 的 preview/surfaces 注入面（2026-08-25 硬化计划扩围，用于 automation 链删除）
- 本卡与 handbook surfaces 章

## Do not touch

- 把空态卡片墙当「做完」
- 挪动 Tab 关闭位置（除非用户明确要求）
- 底栏终端契约（见 `terminal-drawer`）除非一并 Touching

## Gates

| Kind | What |
| --- | --- |
| Automated | 相关 client / preview 单测；`npm run qa:source` |
| Manual / QA | `TC-SURF-001` … `TC-SURF-007`；`TC-CHAT-007`、`TC-CHAT-008` |

## Sources

- Handbook：[../handbook/modules/surfaces.md](../handbook/modules/surfaces.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- AGENTS.md Surfaces 段
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)

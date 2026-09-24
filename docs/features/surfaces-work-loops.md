# Feature: Surfaces work loops

| Field | Value |
| --- | --- |
| **id** | `surfaces-work-loops` |
| **status** | `active` |
| **last verified (source launch)** | 2026-09-24 — `titlebar-fit.e2e.ts` 归入 host 类型检查并从 client Web 项目排除；清理失效的 TypeScript 增量记录后，`apps/web` 定向类型构建和 `npm start` 的 host/client/web 全量构建通过，源码 Electron 已启动。 |
| **last verified** | 2026-09-23 — 交付卡片经桌面 CDP 指针点击后在右栏打开 Files 与 HTML Browser；切换文件页签后“悬浮预览”按钮可见，实机打开单独的 `pelican-bike.html` 窗口；交付卡片的文件定位动作实机打开可见 Explorer 并选中同一文件，定向测试通过。同日右栏展开后的标题行几何复现：1440px 实机窗口中 Agent Team 与打开方式重叠约 11px；按真实标题余量收起次级动作并将尾簇实测宽度向上取整后，源码 Electron 重启与 CDP 几何门禁通过（utilities 与尾簇间距约 8.44px），浏览器集成回归 1/1（侧栏展开/收起两态各开合右栏三轮）、CSS 定向测试 9/9、`ui-layout` 小数取整测试 1/1 通过。受影响模块的定向类型检查、打包及 Web 构建通过；全量官方构建被工作区其他 `ui-settings-account` 类型错误阻断。此前同日恢复旧版 DSHD `ui-surfaces` 右栏：顶部页签、文件树、居中两列方形空态、标题栏开合与会话内文件/Browser 路由；桌面实机画面已核对，相关 client 单测与构建已通过；`qa:source` 仍按退役的原生右栏断言，待 QA 脚本同步。同日行内代码底色改为低对比透明 token，官方客户端构建、源码应用重启和 governance 门禁通过。Browser 移除空白页与 guest 容器的重复半透明填充，保留空态文案和禁用图标对比度；官方构建、文档配对、治理门禁与重启后截图均已核对。 |

## User paths

1. `Ctrl+\` 打开右栏 → Files 搜索 / 预览 / 送对话。
2. 点击对话文件提及、工具路径或产物芯片 → 发起点击的 Session 在 DSHD 右栏打开或聚焦文件页；HTML / HTM / XHTML / PDF 同时经桌面 token URL 进入 Browser；点工作区根目录打开 Files。缺少 cwd 的文件路径交回 Host 打开。
3. 收尾正文里的行内代码文件名与某一轮成功产出或交付的文件唯一匹配（精确路径，或唯一 basename）→ 保持代码芯片外观，点击后在发起该消息的 Session 右栏打开该文件；PTC 子调用成功写入的文件同样进入该词表。同名路径不唯一时保持不可点击。
4. Files：在文件预览头部点“悬浮预览” → 当前已保存文件在单独的置顶只读原生窗口展示；继续打开文件会复用该窗口。
5. Browser：输入 URL、导航；可选截图 / PiP / 录制。
6. Browser：点击工具栏 `dshd mini-player` 按钮后，预览浮在聊天可视区内；拖拽标题条或边/角调整大小，点击恢复按钮回到右栏并保留当前 URL / history。
7. Diff / Agents 按当前 UI 可用。
8. Surface Tab 关闭控件在标题**右侧**。

## Invariants

- 本地 Files 搜索按文件名或路径子序列过滤后再限量；不得把未过滤的目录遍历结果当作已过滤的服务端结果。

- 桌面只有一条可见右栏：恢复 `@deepseek-ai/dsh-client-ui-surfaces` 为 DSHD 右栏呈现所有者，顶部页签条与 Files / Terminal / Browser / Diff / Agents 工作面共用同一 `surfaces` 轨道。`ui-sidebar-right` 保留其专有资源的兼容入口，但原生栏展开时关闭 DSHD 轨道；DSHD 轨道展开时收起原生栏。标题栏按钮与 `Ctrl+\` 开合 DSHD 轨道。由 `src/shared/single-right-panel-contract.test.js` 与 `harness-desktop-forks.js` 守卫。
- DSHD 右栏无页签时显示原有居中两列方形入口（内宽上限 320px、8px 间距、12px 圆角，图标 / 标题 / 说明纵向居中）；页签条从窗口顶部开始，关闭键在标题右侧，末尾有新增键。入口只是进入工作环的起点。
- 不做 note 标明的范围外能力：GPU 终端嵌入、worktree、turn-diff、review-comment pick（勿假装已有）。
- Tab 关闭在标题右侧，未经用户明确要求不挪到左侧。
- 右栏展开后，会话标题行按扣除尾簇后的实际可用宽度收起次级 Agent 操作；头部动作与打开方式、打开方式与尾簇不能覆盖，至少留 8px。关闭右栏后自动恢复，不写持久偏好。
- 显式保存与防抖落盘走同一 `FileSaveCoordinator` 队列，保存期间敲入的字符保持未保存；搜索会话只走一次树、键击内存过滤（Refresh 重走）。
- `shell:preview-automation-*` 链已删除，不得在无新卡+权限模型的情况下复活。
- browser-doc 扩展名单一事实：`{html, htm, xhtml, pdf}`（openPath 双开与 FilePreview 工具栏同集合）；SVG 按图片留在 Files。
- Files 悬浮预览是工作区权威内的单实例只读窗口：不得绕过 `preview-workspace` token URL，不得把编辑缓冲区或保存队列迁入悬浮窗；HTML 只在 sandbox frame 中运行，图片 / 音视频 / PDF / 文本按浏览器原生只读能力展示。
- `dshd mini-player` 只改变 Browser guest 的呈现边界：状态为 `surface | mini` 时同一 `previewId` 只能有一个 `previewShow/previewResize` owner；mini 几何限制在聊天可视区并使用 pointer capture，恢复后 URL、history、loading 状态不丢；不得创建第二个 BrowserView、外部窗口或 mini 专用 IPC。
- 对话 / 产物 / 工具行 / 终端 / 技能的文件打开都走 `workspaces.openPath`；pin 的 Workspace 服务没有该方法时由 ui-surfaces `ensureBaseOpenPath` 补 Host 本体，ui-chat `openFile` 不得绕过它直连 `remote.session.openWorkspacePath`。桌面接管层按发起 Session 的真实 cwd 把工作区文件交给 DSHD `surfaces.file`，根目录交给 `surfaces.files`，浏览器文档同时进入 `surfaces.browser`。缺 cwd、路径不在 cwd 内或无法处理时使用 Host 兼容兜底。
- `ui-deliverables` 的收尾正文行内代码词表只来自该轮权威事实：成功的根级或 PTC `write` / `edit` / 有修改作用的 `str_replace_editor`，以及显式 `deliverables/presented`。PTC 的轮次归属只取 Conversation assembler 已解析的 Location（`turn`/`step`）；`unresolved`、`session`、失败结果、读取/查看、未知工具和畸形参数不贡献，不得按邻近事件、`rootCallId`、当前轮次或路径外观猜测。精确路径或唯一 basename 才解析，同名不唯一保持惰性。
- 收尾正文的行内代码使用 `--dsw-alias-markdown-inline-code` 的低对比透明底；是否可点击仍由文件提及词表决定，不靠底色表示。
- Location 会影响 `match` 归属后，assembler 在 `prepend`/边界 `append` 重建 Location 时必须对先前返回 null 的 (Definition, 事件) 重新判定并回填；已拥有该事件的 Definition 不得重复匹配，`mergeMatches` 的重复检测与 target/fallback 仲裁保持不变。缺少这层回填时，最近分页里先以 `session`/`unresolved` 到达、再被老页解析出 Turn/Step 的事件会永久丢失归属。
- 客户端摘要有真实 `cwd` 时按该 `cwd` 解析相对路径；缺 `cwd` 的文件路径交回 Host，绝不按目录名字符串识别 no-workspace，也不猜 scratch 根目录。
- `gitInit` 成功广播 `dshd-git-init`，Diff 门无需切会话即重探。
- 桌面隐藏 rc.1 新增的会话 header 角位展开钮：`harness-chrome-inject.js` 注入样式 `[data-sidebar-right-expand]{display:none}`——它与 titlebar trailing 既有的面板切换键重复；右栏开合入口统一在 titlebar。
- Files 保存拒绝任何含 `.git` 段的路径（大小写不敏感，含 `.git` gitlink 本体）；`listDir` 隐藏 `.git` 与之同一契约。`.gitignore` / `.github/**` 等普通 dotfile 照常可存。

## Allowed touch

- `vendor/deepseek-harness/packages/util/native-command/src/{path-opener,runner}.ts` 与对应测试（交付文件原生定位）
- Harness surfaces 相关 client 包（`ui-surfaces`、`ui-files`、`ui-preview`、`ui-diff`、`ui-agents-panel`、`ui-user-terminal`、`ui-titlebar`、`ui-sidebar-right`、`ui-chat`）
- 右栏展开时的会话头部避让：vendor `ui-conversation` 的标题行样式与回归测试、`ui-layout` 的尾簇测量取整与回归测试、`apps/web/tests/titlebar-fit.e2e.ts`；`scripts/verify-titlebar-fit.mjs` 实机几何门禁
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css` 的 Markdown 行内代码语义底色
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
| Automated | `native-command` 文件定位测试、相关 client / preview / preload / theme 单测；`apps/web/tests/titlebar-fit.e2e.ts` 浏览器几何回归；`npm run qa:source`；源码 Electron 选中普通工作区会话并以 `--remote-debugging-port=9333` 启动后运行 `node scripts/verify-titlebar-fit.mjs`，断言真实控件间距 |
| Manual / QA | `TC-SURF-001` … `TC-SURF-008`；Files 图片 / 文本 / PDF 悬浮预览；`TC-CHAT-007`、`TC-CHAT-008` |

## Sources

- Decision: [交付文件的 Explorer 定位窗口可见](../decisions/implemented/bug-fix/2026-09-23-visible-explorer-reveal.md)

- Decision: [恢复 DSHD 原有右栏](../decisions/implemented/product/2026-09-23-right-sidebar-dshd-guide.md)
- Decision: [右栏展开时标题行避让](../decisions/implemented/bug-fix/2026-09-23-surface-titlebar-fit.md)
- Decision: [聊天文件预览迁移到右侧 Sidebar 资源路由](../decisions/implemented/bug-fix/2026-09-21-chat-file-sidebar-resource-route.md)
- Decision: [PTC 产出的文件纳入收尾正文的点击词表](../decisions/implemented/bug-fix/2026-09-22-ptc-produced-file-mentions.md)

- Handbook：[../handbook/modules/surfaces.md](../handbook/modules/surfaces.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- 悬浮文件预览 Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-07-floating-workspace-file-preview.md`
- AGENTS.md Surfaces 段
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)

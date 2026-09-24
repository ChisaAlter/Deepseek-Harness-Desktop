# 模块：Surfaces 工作环

## 职责与非目标

**职责：** DSHD 原有 `ui-surfaces` 右栏上的 Files / Terminal / Browser / Diff / Agents ——可搜索、导航、选区进对话的工作环。
**非目标：** 不做空态「功能卡片墙」，不保留第二套可见右栏；不做 GPU 终端嵌入、worktree、turn-diff、review-comment pick（见 work-loops note 范围外）。

## 用户路径

1. `Ctrl+\` 打开右栏。  
2. 对话文件提及、工具行和产物芯片通过 `workspaces.openPath` 进入发起 Session 的 DSHD 文件页；HTML / HTM / XHTML / PDF 经桌面 token URL 同时进入 Browser；工作区根目录打开 Files。缺 cwd 或不在工作区内的路径交回 Host 打开。
3. Files：搜文件、预览、Mention / 加入对话；文件预览头部的“悬浮预览”按钮把当前**已保存**文件送入单实例置顶只读原生窗口。点击对话引用不会直接创建原生窗口。
4. Browser：URL 导航、可选截图 / PiP / 录制。
5. Tab 关闭在标题右侧。

## 架构要点

- UI 在 harness client；Browser 与悬浮文件预览栈在 main `preview.js` 及 `preview-*`。悬浮文件窗复用 `preview-workspace.js` 的工作区 token URL，主进程使用 preview 专属的 `allowScratchCwd` authority + 有界只读适配器，不复制 Files 的编辑 / 保存状态。
- DSHD 右栏呈现所有者是 `@deepseek-ai/dsh-client-ui-surfaces`：顶部页签、关闭和新增控件均来自原有组件，内容由 `surfaces.*` 插槽注入。原生 `ui-sidebar-right` 只承接专有资源兼容路径；两条轨道开合互斥，由 `src/shared/single-right-panel-contract.test.js` 与 `harness-desktop-forks.js` 守卫。
- 右栏展开会减少会话标题行的实际内容宽度；`ConversationRoot.module.css` 在扣除 AppFrame 尾簇预留后的标题行上做局部容器查询，窄到 520px 时收起次级 Agent 操作。AppFrame 对尾簇的实测小数宽度向上取整，保留打开方式与尾簇至少 8px 间距。整列宽度决定的尾簇密度不改，以免测量宽度反馈振荡。几何验收用 `node scripts/verify-titlebar-fit.mjs` 连到带 CDP 端口的源码 Electron 普通工作区会话。
- 无页签时使用 DSHD 原有的居中两列方形入口；终端入口选择 shell。
- Feature card：[../../features/surfaces-work-loops.md](../../features/surfaces-work-loops.md)

## 实现入口

- Main：`preview.js`、`preview-file-window.js`、`preview-session.js`、`preview-workspace.js`、`preview-url.js` 等
- Renderer：`src/renderer/file-preview.*`；窄 preload：`src/preload/file-preview.js`
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`

## 不变量

- 工作环，不是空态卡片网格。  
- 关闭控件在标题右侧。  
- 工作区文件的主点击统一经过 `workspaces.openPath`；Chat 显式携带发起 Session，桌面接管层使用该 Session 的真实 cwd，在 DSHD 页签内打开文件与 Browser。缺 cwd 或无法接管的路径交给 Host。
- Files 根目录 `listDir` 未完成时显示列出中，不把空 `root` 画成「此目录为空。」
- 悬浮文件窗单实例、只读、置顶；文件预览头部的 Desktop 动作使用 `{cwd, relativePath}` 或 `{absolutePath}`。成功要求 `ok === true`，失败必须可见，绝不回落到系统打开器 / `workspaces.openPath` / Browser tab。HTML sandbox，文件 URL 仍受 workspace authority 与大小上限约束。

## 门槛

- QA：`TC-SURF-001` … `TC-SURF-007`

## 延伸阅读

- [../superpowers/specs/2026-08-19-files-browser-logic-port-design.md](../../superpowers/specs/2026-08-19-files-browser-logic-port-design.md)
- [terminal.md](terminal.md)

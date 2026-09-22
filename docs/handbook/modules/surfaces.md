# 模块：Surfaces 工作环

## 职责与非目标

**职责：** 唯一可见右栏（DSH 原生 `ui-sidebar-right`）上的 Files / Terminal / Browser / Diff / Agents ——可搜索、导航、选区进对话的工作环。  
**非目标：** 不做空态「功能卡片墙」，不保留第二套可见右栏；不做 GPU 终端嵌入、worktree、turn-diff、review-comment pick（见 work-loops note 范围外）。

## 用户路径

1. `Ctrl+\` 打开右栏。  
2. 对话文件提及、工具行和产物芯片：右栏 Sidebar 存在且有该 Session 的 adopted store（或已挂载的同 Session binding）时，普通文件经 `sidebarRight.openResourceIn(sessionId, fileAddressFor(...))` 在发起 Session 中打开或聚焦文档预览，HTML / HTM / XHTML / PDF 保留该文件资源页后经桌面 token URL 进入 Sidebar Browser，工作区根目录打开 Sidebar Files 页。Sidebar 缺失，或目标 Session 两者皆无时才使用 Host 兼容兜底；Sidebar 已命中却导航失败时显式报错。
3. Files：搜文件、预览、Mention / 加入对话；统一右栏文档预览头部的“悬浮预览”按钮（Desktop `ui-files` 贡献到 `sidebar.right.tab.document.actions`）把当前**已保存**文件送入单实例置顶只读原生窗口。Sidebar DockKit float 是页内浮层，不创建该原生窗口；点击对话引用也不会直接创建原生窗口。
4. Browser：URL 导航、可选截图 / PiP / 录制。
5. Tab 关闭在标题右侧。

## 架构要点

- UI 在 harness client；Browser 与悬浮文件预览栈在 main `preview.js` 及 `preview-*`。悬浮文件窗复用 `preview-workspace.js` 的工作区 token URL，主进程使用 preview 专属的 `allowScratchCwd` authority + 有界只读适配器，不复制 Files 的编辑 / 保存状态。
- 右栏唯一呈现所有者是 `@deepseek-ai/dsh-client-ui-sidebar-right`。上游 `surfaces` 槽/API 保留为 0 宽度休眠兼容层，桌面包不得注册 `surfaces` / `surfaces.*` 或调用 `openSurfaces` / `toggleSurfaces`；由 `src/shared/single-right-panel-contract.test.js` 与 `harness-desktop-forks.js` 守卫。
- Feature card：[../../features/surfaces-work-loops.md](../../features/surfaces-work-loops.md)

## 实现入口

- Main：`preview.js`、`preview-file-window.js`、`preview-session.js`、`preview-workspace.js`、`preview-url.js` 等
- Renderer：`src/renderer/file-preview.*`；窄 preload：`src/preload/file-preview.js`
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`

## 不变量

- 工作环，不是空态卡片网格。  
- 关闭控件在标题右侧。  
- 工作区文件的主点击统一经过 `workspaces.openPath`；Chat 显式携带发起 Session，桌面接管层把该 Session 内的路径交给 `sidebarRight`。只有 Sidebar 服务缺失，或目标 Session 没有 adopted store / matching live binding 时才使用 Host 兼容兜底；不能由 Chat 或工具卡直接调用 Host 系统打开器。Sidebar 已命中却导航失败时向上抛错，不静默改走 Host。
- Files 根目录 `listDir` 未完成时显示列出中，不把空 `root` 画成「此目录为空。」
- 悬浮文件窗单实例、只读、置顶；当前可见入口是统一右栏文档预览头部的 Desktop 动作（`{cwd, relativePath}` 或 `{absolutePath}`）。成功要求 `ok === true`，失败必须可见，绝不回落到系统打开器 / `workspaces.openPath` / Browser tab。HTML sandbox，文件 URL 仍受 workspace authority 与大小上限约束。

## 门槛

- QA：`TC-SURF-001` … `TC-SURF-007`

## 延伸阅读

- [../superpowers/specs/2026-08-19-files-browser-logic-port-design.md](../../superpowers/specs/2026-08-19-files-browser-logic-port-design.md)
- [terminal.md](terminal.md)

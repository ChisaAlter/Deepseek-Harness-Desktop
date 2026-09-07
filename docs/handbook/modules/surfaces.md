# 模块：Surfaces 工作环

## 职责与非目标

**职责：** 右栏 Files / Diff / Browser / Agents ——可搜索、导航、选区进对话的工作环。  
**非目标：** 不做空态「功能卡片墙」；不做 GPU 终端嵌入、worktree、turn-diff、review-comment pick（见 work-loops note 范围外）。

## 用户路径

1. `Ctrl+\` 打开右栏。  
2. 对话文件提及、工具行和产物芯片：HTML / HTM / XHTML / PDF 进入 Browser；图片、媒体、文本与源码进入 Files；工作区根目录打开 Files 资源管理器。
3. Files：搜文件、预览、Mention / 加入对话；工具栏可把当前文件送入单实例置顶只读窗口。
4. Browser：URL 导航、可选截图 / PiP / 录制。
5. Tab 关闭在标题右侧。

## 架构要点

- UI 在 harness client；Browser 与悬浮文件预览栈在 main `preview.js` 及 `preview-*`。悬浮文件窗复用 `preview-workspace.js` 的工作区 token URL，不复制 Files 的编辑 / 保存状态。
- Feature card：[../../features/surfaces-work-loops.md](../../features/surfaces-work-loops.md)

## 实现入口

- Main：`preview.js`、`preview-file-window.js`、`preview-session.js`、`preview-workspace.js`、`preview-url.js` 等
- Renderer：`src/renderer/file-preview.*`；窄 preload：`src/preload/file-preview.js`
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`

## 不变量

- 工作环，不是空态卡片网格。  
- 关闭控件在标题右侧。  
- 工作区文件的主点击统一经过 `workspaces.openPath`；桌面优先使用 Files / Browser，不能由 Chat 或工具卡直接调用 Host 系统打开器。
- Files 根目录 `listDir` 未完成时显示列出中，不把空 `root` 画成「此目录为空。」
- 悬浮文件窗单实例、只读、置顶；HTML sandbox，文件 URL 仍受 workspace authority 与大小上限约束。

## 门槛

- QA：`TC-SURF-001` … `TC-SURF-007`

## 延伸阅读

- [../superpowers/specs/2026-08-19-files-browser-logic-port-design.md](../../superpowers/specs/2026-08-19-files-browser-logic-port-design.md)
- [terminal.md](terminal.md)

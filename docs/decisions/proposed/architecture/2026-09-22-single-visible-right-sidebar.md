# Decision: 桌面端只保留一条可见右栏

Status: proposed

中文 | [English](2026-09-22-single-visible-right-sidebar.en.md)

## Problem

桌面端同时挂载了两套右栏：DSH 原版的 `ui-sidebar-right`（占用 layout 的 `rightbar` 槽）和桌面 fork 的 `ui-surfaces`（占用 `surfaces` 槽）。`ui-layout/AppFrame.tsx` 本身是四列壳 `sidebar | center | rightbar | surfaces`，两条右轨各自持有宽度状态、拖拽手柄与开关 API，且没有任何互斥规则，因此两者会同时可见。

结果是：聊天文件点击只会进入 `ui-sidebar-right`，而最右侧仍留着 `ui-surfaces` 的空态卡片墙（“打开一个面板”）。这不是路由缺陷，而是右栏迁移只完成了一半：新版 `ui-sidebar-*` 家族与旧 `ui-surfaces` + `ui-files` / `ui-preview` / `ui-diff` / `ui-agents-panel` 同时被组合挂载。

文档也存在漂移：`ui-sidebar-right` 自称“The right Sidebar”，当前文件与导航能力都指向它，但 `docs/design-language.md` 仍把旧 `ui-surfaces/EmptyState` 的方块几何冻结为右栏设计契约。

## Proposal

桌面上只有一条可见右栏，且 `@deepseek-ai/dsh-client-ui-sidebar-right` 是唯一呈现所有者。上游 `surfaces` 轨道保留为**休眠兼容层**：源码、槽位、宽度状态与 API 都留在原位，桌面组合把它恒定保持在 0 宽度且无人占用。

- `ui-sidebar-right` 的 guide 成为唯一的空态/起始页，桌面端在其上暴露五类入口：Files | Terminal | Browser | Diff | Agents；既有的原生右栏资源页签（Document Preview、changes review 等）继续留在同一 tab/dock 域。
- 五类旧 occupant 按能力迁移到 `ui-sidebar-right` 的类型注册表，使用 `priority: 'extension'` 覆盖，而不是把旧 `ui-surfaces` 壳嵌进一个右栏 tab：
  - Files：`ui-files` 提供桌面扩展的 files 页与 `dsh-resource://file/**` 资源视图，保留搜索、编辑保存、右键菜单、送入对话、行号定位、原生悬浮预览与草稿持久化；`ui-sidebar-files` / `ui-sidebar-documentpreview` 继续作为非桌面内置实现。
  - Browser：`ui-preview` 提供桌面扩展的 `browser` 类型，保留 BrowserView IPC、URL/history 与 `dshd mini-player`；`ui-sidebar-browser` 继续作为内置 iframe 实现。
  - Terminal：使用既有 `ui-sidebar-terminal`；`ui-user-terminal` 只保留会话列终端抽屉，本地 URL 改为打开右栏 Browser。
  - Diff / Agents：`ui-diff`、`ui-agents-panel` 改为注册右栏页类型，不再占用 `surfaces.*`。
- `ui-surfaces` 降级为 `workspaces.openPath` 兼容适配层：不注册 `surfaces` 槽、不注册任何 occupant、不发布空态；组装时同步把旧 `surfaces` 宽度归零并保留当前 session-scoped `sidebarRight.openResourceIn/openTabIn` 路由。
- 标题栏右面板按钮与 `Ctrl+\` 改为调用 `ctx.sidebarRight.toggleExpanded()`，按下态读取 `rightbarShown`；持久化字段名 `surfacesToggle` 作为兼容键暂时保留。

上游维护约束：共享上游文件的改动只允许极小增量和一处通用缝——`ui-layout/src/client/index.ts` 的 `TitlebarTrailingOwnerProps` 增加 `rightbarShown: boolean`，`ui-layout/src/client/AppFrame.tsx` 把它传给 `shell.titlebar.trailing`；`ui-sidebar-documentpreview/src/client/document/actions.ts` 新增平台中立的 `sidebar.right.tab.document.actions` list slot，并在 `TextPreview.tsx` 的文档头部渲染它。该缝不含 Electron API、scratch 规则或桌面文案；没有注册者时头部与原先完全一致。`columns.ts`、`stores.ts`、`service.ts`、`persist.ts` 与 `packages/bundle/web-app/cordis.patch.yml` 在本决定中不做任何改动。

悬浮预览是显式交付物：桌面文件视图与原生 Document Preview 头部都通过同一个 Desktop-owned `ui-files` 动作触发；支持 `{ cwd, relativePath }` 与无 cwd 的 `{ absolutePath }`，成功必须 `result.ok === true`，拒绝、崩溃或畸形响应显示本地化错误并保持右栏可用，绝不回落到系统打开器、`workspaces.openPath` 或 Browser tab。主进程使用 preview 专属的 `loadWorkspaceAuthority({ allowScratchCwd: true })` 与有界只读适配器，因此 Host scratch 中的文本与 HTML 可以预览；文档页经 `shell:read-file` / `shell:list-dir` 读取 scratch 产物时同样携带该 scratch 根（[decision](../../implemented/bug-fix/2026-09-23-scratch-cwd-document-tab-read.md)）。两条路径都只扩展到既有 Host scratch 根，不包含任意路径。

## Alternatives considered

- **只删 `ui-surfaces` 的可见空态（CSS 隐藏或右栏打开时自动关闭）** — rejected：仍然保留两个所有者与两条可被重新打开的轨道，缺陷会复发；且不符合“一个能力一个所有者”的既有约定。
- **重写 `ui-layout` 为三列，删除 `surfaces` 槽、宽度状态与 API** — rejected：这些是上游架构，删除对桌面端没有可见收益，却会在每次上游同步产生大面积冲突；把上游轨道保留在 0 宽度即可达到同样的产品效果。
- **把七个桌面客户端包整体从 `web-app/cordis.patch.yml` 搬到运行时 overlay** — rejected：`--patch` overlay 机制更适合新增独立运行时插件；这些包已被 Web 组合、源码构建依赖图、`DESKTOP_PACKAGES` 解析检查与打包期验证引用，搬迁需要另行证明源码构建发现、打包产物解析与 `--skip-user-plugins` 恢复路径，属于独立的组合层加固任务，不应与本次去重合并。
- **把旧 `ui-surfaces` 壳整体嵌进一个右栏 tab** — rejected：那会把两套 tab 语义叠在一起，旧 occupant 的 `surfaces.*` 契约仍活着，无法让上游后续改进正常落到内置实现之下。

## Acceptance criteria

- 桌面组合装配后，`ui-sidebar-right` 是唯一可见右栏；`surfaces` 轨道宽度恒为 0 且没有 occupant。
- 对话文件芯片、工作区根目录与浏览器文档都在发起 Session 的右栏打开；右栏缺失或未 adopt 时才使用 Host 兜底，右栏已命中后导航失败必须显式报错。
- `ui-titlebar` 的右面板按钮与 `Ctrl+\` 都调用 `sidebarRight.toggleExpanded()`，按下态读 `rightbarShown`。
- 统一右栏文档预览头部的悬浮预览按钮能打开单个原生只读置顶窗口，支持已知 cwd 与无 cwd 绝对路径，失败可见且不回落系统打开器或 Browser。
- `bash` 之外的门禁：`npm run check:governance`、`npm run doc-sync`、相关包 vitest、`tsc -b`、`build:official` 与 Electron smoke 全绿。

## Risks

- 上游 `ui-layout` 与 `ui-sidebar-documentpreview` 的少量共享改动在下一次 `sync:harness` 会被人工裁定；`FORK_FILE_MARKERS` 与 `single-right-panel-contract` 测试用于早期发现回退。
- 退役旧壳后若某个 Desktop 能力未真正迁移到 Sidebar，会在运行时缺失；因此 Files/Browser/Diff/Agents/Terminal 各自的扩展注册测试与 Electron smoke 是发布门槛。
- 原生悬浮预览与文档页的 scratch 授权若被扩大，会扩大主进程读取面；两条路径的 authority 都只包含既有 Host scratch 根，父目录与任意路径仍被拒绝。

## Consequences

桌面上只剩一条可见右栏：`ui-sidebar-right`。文件点击、guide 的 Files/Browser/Diff/Agents 与 Terminal 全部在 `[data-rightbar-col]` 内打开，`Ctrl+\` 与标题栏图标开合的是同一条右栏，最右侧空态不再存在。

桌面独有的 Files/Browser 能力通过 `priority: 'extension'` 覆盖内置实现保留；若上游日后改进内置版本，两者可共存于注册表而不产生 kind 冲突。旧 `dsh-surfaces:v1:<sessionId>` 中未保存的文件草稿在退役旧壳前一次性导入右栏文件 store，只有全部选中草稿成功提交后才移除旧键；畸形或超限数据按原规则忽略。

上游 `surfaces` 组合行、槽位声明与兼容 API 保留但不被任何桌面生产代码使用，并由契约测试与 fork marker 守卫：任何桌面包重新注册 `surfaces` / `surfaces.*`、或调用 `openSurfaces` / `toggleSurfaces`，都会在建树阶段失败。文件点击路径固定为“对话芯片 → 统一 Sidebar 文件/文档页 → 显式悬浮预览 → 单个原生只读窗口”；DockKit 页内浮层与 Browser mini-player 仍是三个不同概念。下一次上游同步预期只需人工裁定 `ui-layout` 的两处语义增量与 `ui-sidebar-documentpreview` 的通用动作缝。

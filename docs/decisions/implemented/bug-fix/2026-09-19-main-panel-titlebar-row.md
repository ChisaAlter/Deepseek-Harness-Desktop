# Decision: 非会话 main 面板收进标题栏之下的内容行

Status: implemented

中文 | [English](2026-09-19-main-panel-titlebar-row.en.md)

## Problem

侧栏「插件」打开的插件管理页与桌面标题栏冲突：页面内容画进 48px 拖拽带 / 标题栏尾簇区域，且插件列表卡片点击无效。根因在 `AppFrame` 的中列网格契约——桌面合并给 `.frame` 引入多行网格（标题栏 `auto` 行 + 内容 `minmax(0, 1fr)` 行 + 终端抽屉行），`conversation` 面板靠 `grid-row: 1 / -1` 加内嵌 subgrid 独占整个中列；而 `main` slot 的其他 keyed 面板（插件管理等全局面板）被直接渲进中列网格，slot anchor 又是 `display: contents`，面板根元素落在第 1 行（标题栏行），把 `auto` 轨撑高并上探到标题栏区域，既视觉重叠又截走指针事件，表现为「页面顶着标题栏且点不动」。

## Decision

`AppFrame` 的 `MainPanel` 按解析后的面板 key 分流：`conversation`（含 `activePanelId` 为 `null` 的默认态）保持直渲，继续拥有整列 subgrid；其余 key 一律包进新的 `.mainPanel` 容器——占据中列第 2 行、约束宽高、允许页面自身滚动。`main` slot 的契约注释同步写明「`conversation` 为保留的全会话 key，其余 key 是经由 mainPanel 容器渲染的全局面板」。`FORK_FILE_MARKERS` 增加 `AppFrame.tsx` / `AppFrame.module.css` 的标记项，防止上游同步静默回退该桌面布局契约；`ui-layout` spec 新增覆盖该行契约的用例。设计语言文档同步记录「非会话面板只挂内容行、conversation 独占两行」这条不变量。

## Alternatives considered

- **让每个全局面板各自声明 grid-row / 约束** — rejected：契约由 `AppFrame` 拥有才不漏面板；逐面板重复会在下一个 main 面板接入时重现同一缺陷。
- **在 slot renderer 层包容器** — rejected：renderer 是 `display: contents` 的通用机制，不该携带布局行语义；布局属于 `AppFrame` 的职责面。
- **conversation 也进容器、内部再抵消** — rejected：破坏 conversation 既有的整列 subgrid 契约，把特殊面板正常化只会引入第二处回归。

## Consequences

插件管理及今后所有非会话 `main` 面板都落在标题栏之下的内容行，页面不再与拖拽带 / 尾簇重叠，卡片点击恢复。conversation 布局不变。上游同步若丢失该布局修复会被 `assertDesktopForks` 拦下。验证：`ui-layout` 客户端测试 80 项（含新契约用例）、共享 fork 校验 15 项、包级 typecheck 全过；实机 Electron + CDP 验证插件页 `mainPanel` 起点 top=48（恰在标题栏下）、列表卡片点击进入详情页、「‹ 插件列表」返回列表正常。

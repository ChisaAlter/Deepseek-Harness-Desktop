# Decision: 恢复 DSHD 原有右栏

Status: implemented

中文 | [English](2026-09-23-right-sidebar-dshd-guide.en.md)

## Problem

2026-09-22 的单右栏改造把 DSHD 原有的右栏整体换成 DSH 原生 `ui-sidebar-right`。变化不止“开始”页：右栏宽度、顶部位置、页签、内容导航和入口布局都与用户熟悉的 DSHD 不同。只给原生 Guide 换两列 CSS 无法恢复旧版。

## Decision

重新启用 DSHD 原有的 `ui-surfaces` 轨道、`SurfacesRoot`、`SurfaceTabs` 和 `EmptyState`。Files、Browser、Terminal、Diff、Agents 重新注册到 `surfaces.*`，工作区路径在发起 Session 的旧版页签中打开。`Ctrl+\` 与标题栏右面板按钮开合这条轨道。桌面启动时迁移此前原生 Sidebar 的展开状态，让旧右栏显示。没有 cwd 的文件路径交回 Host 打开；原生栏只为其他专有资源保留兼容入口。两条右栏的展开动作互相收起另一条，任何时刻只有一条可见。

## Alternatives considered

- 只调整 DSH Guide 的胶囊入口为方形瓷砖：无法恢复顶部页签、栏宽与文件树的原有布局，已被用户明确否定。
- 完全删除原生 Sidebar：会丢失尚未移植的专有资源类型。

## Consequences

右栏视觉以历史 DSHD 组件和设计语言为准；入口之后仍需完成 Files 搜索/预览、Browser 导航、Terminal、Diff 和 Agents 的工作环。保持文件草稿与页签持久化，检查启动迁移、互斥、标题栏切换、文件打开和桌面实机画面。

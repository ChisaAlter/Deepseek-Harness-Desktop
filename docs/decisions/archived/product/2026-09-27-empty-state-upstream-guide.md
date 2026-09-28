# Decision: 空态入口卡镜像上游 guide 注册表

Status: implemented

Archived: 2026-09-28

中文 | [English](2026-09-27-empty-state-upstream-guide.en.md)

## Problem

经典右栏的空态卡片墙持有一份硬编码的五卡清单（Browser / Terminal / Files / Diff / Agents），与上游 `ui-sidebar-right` guide 注册表是两套独立的入口事实：上游新增或改名一个页类型，卡片区不会跟随；点击卡片走 `ui-surfaces` 自己的 `OpenableKind`，打开的也不是上游面板。用户要求卡片数量与上游 guide 一致、点进去是上游功能，同时保留现有卡片墙视觉。

## Decision

`ui-surfaces` 的空态不再自己定义入口清单。`SurfacesRootInjected` 新增 `guide` 注入面：`entries` 是 `ctx.sidebarRightTabs` 注册表 `guide()` 的可观察快照，`open` 经 `ctx.sidebarRight.openTabIn(sessionId, kind)`（无会话绑定时回退 mounted Session）把选中的上游页类型放进原生 dock——dock 展开自身即收起经典轨，两条右栏依旧互斥。`EmptyState` 在拿到 `guide` 时按注册表条目一一渲染（数量、标题、说明、图标全来自上游，无图标用与上游 guide 相同的立方体占位）；拿不到（sidebarRight 未组成时）回退旧五卡。卡片墙的居中两列方形几何、`data-surfaces-empty` 标记与可用性禁用态样式不变。

## Alternatives considered

- 给 `ISidebarRight` 新增公开 `guideEntries` 服务成员：能工作，但 `sidebarRightTabs` 注册表本就是 `ctx.reflect.provide` 出去的公开服务，`guide()`/`subscribe()` 现成可用，再加一条平行 API 是重复事实。
- 让上游 `GuideBody` 直接套用卡片墙 CSS（合并轨方案）：一个 guide 一个事实源最纯，但这正是 09-26 被 reset 回退的合并 dock 方向；用户当前要的是保留经典壳，不是再合并一次。
- 卡片仍打开 `surfaces.*` 经典 occupant：不满足“点进去是上游功能”的要求。

## Consequences

上游注册的页类型增减会即时反映在空态卡数量上，两份入口清单合一。代价：点卡会切到原生 dock 列（视觉壳是上游的），经典 `surfaces.*` occupant 仍由 openPath / 事件等其他打开路径使用；`EmptyState` 里本地化了上游 `CubeGlyph` 占位（跨包不可共享值导出）。上游图标缺席、描述缺省、注册表更新均已覆盖 spec；`single-right-panel-contract` 与 `harness-desktop-forks` 钉钉此缝。

Supersedes: 2026-09-23 恢复 DSHD 原有右栏（入口清单来源收窄，视觉与宿主归属不变）。

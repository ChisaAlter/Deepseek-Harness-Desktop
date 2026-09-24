# Decision: 会话头部后台任务菜单避开标题栏裁切

Status: implemented

中文 | [English](2026-09-24-header-jobs-popover-clipping.en.md)

## Problem

后台任务按钮在会话标题栏内，任务菜单也作为该按钮的后代绘制。标题栏操作容器使用 `overflow: hidden` 收拢窄窗口内容，菜单随之被裁掉，点击按钮后用户看不到任务列表。

## Decision

任务菜单挂到 `document.body`，使用共享的锚点定位与视口边距规则跟随按钮。按钮仍在标题栏原位；菜单和按钮共同参与外部点击关闭判定，菜单本身从窗口拖拽区扣除。

## Alternatives considered

- **移除标题栏操作容器的裁切**：会让窄窗口中本应收拢的其他操作溢出，并且不能解决上层裁切。
- **提高菜单层级**：`z-index` 不能越过祖先的 `overflow: hidden` 裁切。

## Consequences

任务菜单在标题栏下方可见、可点击，窗口缩放和滚动后继续锚定按钮。定向组件测试覆盖菜单门户位置、边缘钳制及关闭行为。

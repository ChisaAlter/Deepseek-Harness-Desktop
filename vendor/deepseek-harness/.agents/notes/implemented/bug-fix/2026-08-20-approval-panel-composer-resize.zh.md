# Agent Note: 审批接管跟随输入框拖动调整

Status: implemented

[English](2026-08-20-approval-panel-composer-resize.md) | 中文

## 问题

界面设置 `composerResize` 给 InputBar 加上上／左／右拖动手柄。`ApprovalPanel` 在审批等待未决时占据同一个 composer 座位，却仍只使用共享的 14 行上限，因此已经拖大的输入框会弹回自动增高，审批卡片本身也无法拖动。

## 决策

`ApprovalPanel` 注入 InputBar 所读的同一个 `ComposerSubmissionPolicy.composerResize` store（`ApprovalComposerInjected.hooks.composerResize`）。该字段为 `true` 时绘制共享的 `ComposerResizeHandles`，`useComposerResizeDrag` 把高度写到 `[data-approval-scroll]`、把宽度写到 `[data-composer-card]`。若存在 `[data-composer-seat]` 祖先，拖动还会在该座位上发布 `--dsh-composer-resized-height` / `--dsh-composer-resized-width`，并复制到座位下每一个 InputBar / ApprovalPanel 主体，因此被 overlay 隐藏的兜底输入栏保持已拖动的尺寸，接管在挂载时采纳它。关闭该设置会去掉手柄并清除已发布的尺寸。QuestionComposer 不变：它的卡片仍使用视口上限，而不是这项设置所调整的草稿滚动区。

静止上限仍是 `.composerSeat` 上的 `--dsh-composer-text-max-height`（[审批文本上限](2026-07-30-approval-panel-command-cap.md)）。拖动后的区域把 `max-height` 提到 `70vh`，与 InputBar 一致。

## 曾考虑的替代方案

**让 ApprovalPanel 继续只用 14 行上限。** 否决：接管是同一座位上的内容替换；尺寸不同就是一次布局跳动，而且产品文案已经把审批卡片当成输入卡片。

**用 session store 保存宽高。** 否决：座位已经是共同祖先，且 `overlay: true` 会保留两棵 DOM；CSS 变量加上向兄弟滚动区扇出已经足够。

**给 QuestionComposer 同样的手柄。** 此次不做：那个接管用 `min(60vh, 520px)` 限制整张卡片，不是这项设置所调整的草稿滚动区。

## 后果

用户先放大输入框再遇到审批时，盒子保持该尺寸。审批卡片可以用同样的方式拖动。关掉 `composerResize` 后，两个主体都回到自动增高。

## 测试

`approval-panel.client.spec.tsx` 钉住 `composerResize` 为 true 之前没有手柄、从上边拖动设定 `[data-approval-scroll]` 高度、从侧边拖动设定 `[data-composer-card]` 宽度、关闭设置时清除、从 `[data-composer-seat]` 采纳 `--dsh-composer-resized-*`、以及把拖动写回该座位。apply 接线钉住审批条目的 inject store 与界面设置拖动行是同一个对象。InputBar 的拖动用例仍通过共享手柄模块。

## 相关

[审批接管面板与输入框共用同一文本高度上限](2026-07-30-approval-panel-command-cap.md)。[界面设置的 chrome 可见性](../feature/2026-08-19-interface-settings-chrome-visibility.zh.md)。

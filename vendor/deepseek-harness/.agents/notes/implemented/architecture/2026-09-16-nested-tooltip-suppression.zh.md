# Agent Note: 嵌套提示显示时抑制外层提示

Status: implemented

[English](2026-09-16-nested-tooltip-suppression.md) | 中文

## 问题

侧边栏收起时，更新蓝点通过 `sidebar.toggle.badge` 插槽渲染在展开按钮内部，而按钮和蓝点各自挂了一个 `Tooltip`。hover 蓝点会同时出现两个气泡——版本提示和“打开侧边栏”——因为蓝点是按钮的 DOM 后代：只要指针停在蓝点上，按钮的 hover 状态就保持为真，而两个 tooltip 都在正确地跟随各自的 anchor。

## 决策

[Tooltip](../../../../packages/client/ui-primitives/src/Tooltip.tsx)通过内部 `TooltipSuppression` context 提供一个抑制 setter，并把该 context 包在克隆后的 anchor 与气泡外层。嵌套的 tooltip 消费最近的 setter，并在自己的气泡可见时上报。收到抑制声明后，外层 tooltip 保留 hover/focus 触发状态与已测量的位置，但不渲染自己的气泡，因此嵌套气泡消失的同一提交里外层气泡就会回来。

嵌套 tooltip 既在 `show()` 中同步上报，也通过 `visible` effect 上报。同步调用避免在同一 React 提交中同时可见的一对工具提示多绘制一帧的两个气泡；effect 则在其他所有隐藏气泡的路径上释放抑制，包括卸载和 `disabled` 翻转。

`ui-sidebar` 与 `ui-settings-general` 中的组件无需改动：蓝点本就渲染在 toggle 的 anchor 内，因此共享 primitive 也顺带解决了未来任何嵌套组合。

## 考虑过的替代方案

**只要存在更新就禁用 toggle 的 tooltip。** 这是最简单的防护，但也是错的：它会在更新可用的整个期间移除普通 rail hover 的“打开侧边栏”，包括根本不会碰到蓝点的 hover。

**指针位于蓝点上时禁用 toggle 的 tooltip。** 作用域正确，但 `Tooltip` 被禁用时会清空自己的 hover 与 focus 触发状态，而指针从蓝点移到按钮自身区域时按钮不会再触发新的 `mouseenter`。外层气泡会一直消失，直到指针离开按钮并重新进入。

**阻止蓝点的 `mouseenter` 传播到按钮。** 这只能帮助直接从蓝点进入的指针；先进入按钮再移到蓝点上的指针，其外层气泡早已可见，因为外层的 hover 从未结束过。

**把蓝点渲染到 toggle 的 anchor 之外。** 该插槽声明在 toggle 按钮内部，蓝点必须落在按钮角上；把 anchor 移出按钮要么让气泡脱离控件，要么改变插槽声明的放置位置。

## 结果

这条规则是 tooltip 嵌套的性质，而不是更新蓝点的性质：任何 anchor 内含另一个 tooltip 的 tooltip 现在都会把气泡让给最内层可见的那个。没有嵌套 tooltip 的 tooltip 不受影响——它消费到的是 null context，永远不会上报。

外层 tooltip 仅在子级可见期间收回气泡；它的触发状态得以保留，因此不需要重新进入即可恢复。抑制不改变 anchor 的行为：按钮仍然切换侧边栏，蓝点仍然是非交互标记。

[Tooltip 测试](../../../../packages/client/ui-primitives/tests/tooltip.client.spec.tsx)覆盖收回、用真实 `relatedTarget` 从嵌套 anchor 移到外层 anchor 时的恢复，以及已显示的嵌套 tooltip 卸载时的释放。[侧边栏 shell 测试](../../../../packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx)覆盖产品接线：在 toggle 自身的 hover 延迟已经过去之后，rail 蓝点气泡仍替换掉 toggle 气泡。

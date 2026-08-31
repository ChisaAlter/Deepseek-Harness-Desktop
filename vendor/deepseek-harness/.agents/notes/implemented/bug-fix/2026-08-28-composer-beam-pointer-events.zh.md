# Agent Note: Composer thinking beam must not capture toolbar clicks

Status: implemented

[English](2026-08-28-composer-beam-pointer-events.md) | 中文

## Problem

一轮处于发送、思考或流式输出时，InputBar 会在 composer 卡片上绘制行进边光（`data-beam`，默认 `composerBeam` 打开）。三层装饰 span 为 `position: absolute; inset: 0` 且带正 `z-index`，因此盖住草稿和底部芯片行。各 span 虽设 `pointer-events: none`，但 `.beamBloom` 同时使用 `filter: blur(...)`。Chromium 合成器命中测试不尊重该滤镜元素上的 `pointer-events: none`，于是对 `+`、访问芯片、模型座位和草稿的点击在回合结束前都落空。

状态机在 `running` 为 true 时已经不锁定这些控件；失效的是命中测试，不是 `disabled`。

## Decision

三层边光放在未加滤镜的 `.beamLayer` 兄弟节点（`data-composer-beam`）内，由该层持有 `pointer-events: none`、`overflow: hidden` 和 `z-index: 0`。草稿、附件和工具栏行放在 `z-index: 1` 的 `.cardBody` 中。浮层菜单和缩放手柄留在该 body 之外，以保持既有叠放（`overlayAnchor` z-index 5，手柄 z-index 4）。减弱动效时仍隐藏整层边光。裁切 bloom 的 `filter: blur(...)` 溢出，避免灯丝亮起时盖住卡片下方的统计 dock。

## Alternatives considered

**只在三层 span 上保留 `pointer-events: none`。** 否决：这正是 `.beamBloom` 带滤镜时在 Chromium 下失效的安排。

**思考时关掉边光。** 否决：界面设置开关已经可以关掉灯丝；默认打开时必须仍可点击。

**只把 `.row` 抬到边光之上。** 否决：草稿、附件轨和编辑横幅同在一张卡片上，仍会落在合成器拦截的 bloom 之下。

## Consequences

发送/思考灯丝仍画在卡片边缘。原先叠在不透明草稿上的内辉现在位于 `.cardBody` 之后；胶囊周围 1.5px 描边仍然可见。整个运行回合内，工具栏芯片、草稿和停止按钮都可点到。统计 dock 保留自己的布局盒，不会消失在 bloom 溢出之下。

## Testing

`input-bar.client.spec.tsx` 挂载带边光的运行中输入条，断言 `[data-composer-beam]` 不包含命令或访问芯片、这些芯片保持可用、命令启动器仍会触发。`input-bar-beam.client.spec.ts` 钉住样式表中 `.beamLayer` 的 `pointer-events: none` / `overflow: hidden` / `z-index: 0` 以及 `.cardBody` 的 `z-index: 1`。

## Related

[界面设置 chrome 可见性](../feature/2026-08-19-interface-settings-chrome-visibility.zh.md) 持有打开灯丝的 `composerBeam` 偏好。[思考时统计 dock 保留行高](2026-08-28-stats-line-running-gap.zh.md) 持有被裁切 bloom 不得盖住的那一行。

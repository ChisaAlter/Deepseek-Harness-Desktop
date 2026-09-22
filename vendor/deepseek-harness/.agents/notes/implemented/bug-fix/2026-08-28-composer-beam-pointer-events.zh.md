# Agent Note: Composer thinking beam must not capture toolbar clicks

Status: implemented

[English](2026-08-28-composer-beam-pointer-events.md) | 中文

## Problem

一轮处于发送、思考或流式输出时，InputBar 会在 composer 卡片上绘制行进边光（`data-beam`，默认 `composerBeam` 打开）。三层装饰 span 为 `position: absolute; inset: 0` 且带正 `z-index`，因此盖住草稿和底部芯片行。各 span 虽设 `pointer-events: none`，但 `.beamBloom` 同时使用 `filter: blur(...)`。Chromium 合成器命中测试不尊重该滤镜元素上的 `pointer-events: none`，于是对 `+`、访问芯片、模型座位和草稿的点击在回合结束前都落空。

状态机在 `running` 为 true 时已经不锁定这些控件；失效的是命中测试，不是 `disabled`。

## Decision

三层边光放在未加滤镜的 `.beamLayer` 兄弟节点（`data-composer-beam`）内，由该层持有 `pointer-events: none`、`overflow: hidden` 和 `z-index: 0`。该层在卡边外扩 4px、圆角为 26px，仍位于 6px composer stack 间距内。Stroke 与 inner light 内缩 4px 回到 22px 卡边。参照 Libraries.dev Rotate 层次，2px stroke 以 0.6 透明度经过旋转 conic 强度窗口，只保留 `border-radius + ring cutout` 而不叠加重复 `clip-path`；inner light 使用同方向双 conic 窗口。Bloom 把 masked 1.5px 光源放进 `::before`，外层 span 以 0.36 透明度应用 `blur(8px)`。静态 rim 负责始终定义完整胶囊，彩色 beam 则带透明尾迹并扫过每个圆角。草稿、附件和工具栏行放在 `z-index: 1` 的 `.cardBody` 中。浮层菜单和缩放手柄留在该 body 之外，以保持既有叠放（`overlayAnchor` z-index 5，手柄 z-index 4）。减弱动效隐藏完整边光层。

卡片及所有带圆角的 beam 层明确使用 `corner-shape: round`，避免全局 superellipse 与 inner 的圆弧裁切不一致。2px stroke 保证 100% 系统缩放下的四角可见覆盖；bloom 光源仍为 1.5px。桌面像素探针加载真实圆角与 elevation 样式，按截图缩放映射原生像素，同时检查静止轮廓和旋转描边的两个色相端点。旧探针遗漏全局圆角样式，并在错误作用域解析 elevation token，不能代表安装版表面。

## Alternatives considered

**只在三层 span 上保留 `pointer-events: none`。** 否决：这正是 `.beamBloom` 带滤镜时在 Chromium 下失效的安排。

**思考时关掉边光。** 否决：界面设置开关已经可以关掉灯丝；默认打开时必须仍可点击。

**只把 `.row` 抬到边光之上。** 否决：草稿、附件轨和编辑横幅同在一张卡片上，仍会落在合成器拦截的 bloom 之下。

## Consequences

发送/思考灯丝与内辉沿卡边移动，不再读成整圈等亮霓虹。静态 rim 保持胶囊轮廓，2px 彩色亮峰完整经过每个圆角。整个运行回合内，工具栏芯片、草稿和停止按钮都可点到。4px 光晕受壳限制，跨不过 6px stack gap，因此不会触及 dock。

## Testing

`input-bar.client.spec.tsx` 挂载带边光的运行中输入条，断言 `[data-composer-beam]` 不包含命令或访问芯片、这些芯片保持可用、命令启动器仍会触发。`input-bar-beam.client.spec.ts` 钉住 4px 裁切壳、卡边内缩、分层 `blur(8px)` bloom 光源、2px 旋转 stroke 窗口、双 conic inner 窗口、pointer 所有权与正文层级。Chromium 像素探针使用生产态 654×193 半透明卡几何，以 15° 步长冻结一轮旋转并保留运行态亮度滤镜。亮峰经过每个圆角时必须在 32 channel 像素差下达到至少 90% 覆盖，同时每个圆角还必须有低于 25% 的暗帧；外沿 bloom 另行保持存在。

## Related

[界面设置 chrome 可见性](../feature/2026-08-19-interface-settings-chrome-visibility.zh.md) 持有打开灯丝的 `composerBeam` 偏好。[思考时统计 dock 保留行高](2026-08-28-stats-line-running-gap.zh.md) 持有被裁切 bloom 不得盖住的那一行。

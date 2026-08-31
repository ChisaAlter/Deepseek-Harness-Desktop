# Agent Note: Stats dock stays while thinking

Status: implemented

[English](2026-08-28-stats-line-running-gap.md) | 中文

## Problem

StatsLine 挂在 composer 卡片下方的 `conversation.composer.dock`，没有分组时卸载：还没有关闭的 `step/end`，也没有已计费的 `tokenUsage`。会话的第一个进行中回合正好是这种状态——思考已开始、尚无定稿——于是这一条及其 24px 间隔会消失，直到步骤关闭。composer 因此跳动，回合结束后数字才作为新行出现。已有关闭总计的后续运行回合会保留那些数字；塌缩走的是空分组路径。

## Decision

StatsLine 从会话快照读取 `running`。没有分组的空闲会话仍返回 null。`running` 为 true 且分组为空时，保留 `data-stats-line="pending"` 行，并用 `min-height: 24px`（数字行的 padding-top 加 line-height），dock 不再塌缩。界面开关仍映射到 `hidden`，并优先于 `pending`。分块帧不选择 `running`；只有 running 边沿会多一次绘制。

## Alternatives considered

**把未关闭步骤计入投影视图。** 否决：`sessionStats` 按设计只计关闭的 `step/end`；为布局缺陷发明进行中轮次/步骤数字会改动整日志契约。

**思考时实时跳动 LLM 耗时。** 此处否决：报告的是这一行及其空间消失，不是计时器过期。跳动时钟是另一项产品改动。

**连空闲空会话也始终预留 dock。** 否决：没有数字的全新会话仍不渲染，与界面设置的空会话规则一致。

## Consequences

第一次思考等待也会保留这一条的高度，即使还没有任何数字。步骤关闭后，同一行填入计数。空闲空会话仍不显示 dock。后续运行回合上已定稿的数字保持可见。

## Testing

`chat-stats.client.spec.tsx` 钉住运行中全零投影为 `[data-stats-line="pending"]`、界面开关关闭的运行中空会话为 `hidden`、`running` 为 true 时仍显示已定稿数字，以及父级在分块帧上仍不重绘。

## Related

[界面设置 chrome 可见性](../feature/2026-08-19-interface-settings-chrome-visibility.zh.md) 持有隐藏数字并保留间隔的 `statsLine` 开关。[Composer 思考边光](2026-08-28-composer-beam-pointer-events.zh.md) 裁切 bloom 溢出，使灯丝不能盖住这一 dock。

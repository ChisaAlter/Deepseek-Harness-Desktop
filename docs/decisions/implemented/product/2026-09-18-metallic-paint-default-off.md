# Decision: 按钮悬停金属漆默认关闭

Status: implemented

中文 | [English](2026-09-18-metallic-paint-default-off.en.md)

## Problem

[2026-09-17-metallic-paint-toggle](2026-09-17-metallic-paint-toggle.md) 落地「按钮悬停光泽」开关时把 schema 默认定为 `true`，并在备选分析里明确拒绝了默认关（理由：扫光是验收过的默认视觉，默认关等于替存量用户撤回）。用户现在明确要求该特效默认关闭——此前的拒绝理由被用户本人的产品取向推翻：附加动效不应出厂强加，想要的人点一次即可。

## Decision

`metallicPaintEnabled` 出厂默认翻转为 `false`：`theme-settings.ts` 的 `DEFAULT_THEME_SETTINGS` 与 zod schema `.default()` 同步改 false；`applyAppearanceDocumentExtras` 的缺席语义从 `!== false`（缺席即开）改为 `=== true`（缺席即关），与默认关保持一致。存量用户中显式开过开关的保留 `true` 持久化值不受影响；从未触碰过开关的用户升级后扫光关闭——这正是新默认的语义。开关位置、持久化链路、`data-dsh-metallic-paint` 门控与扫光视觉本身全部不变。

## Alternatives considered

- **保持默认开，仅提供开关** — rejected：用户已明确要求默认关；上一记录中「默认关等于替存量用户撤回」的顾虑在原作者提出相反需求时不再成立。
- **缺席语义维持 `!== false`（缺席即开）** — rejected：与 schema 默认 `false` 自相矛盾——无字段调用点会得到与默认相反的视觉，boot 期 partial extras 会闪出扫光再被纠正。

## Consequences

`metallic-paint.css` 两条规则在属性缺席时不命中，出厂/未动过开关的用户不再看到扫光；开关文案、MetallicPaintRow、写入链路不变。feature 卡 [metallic-paint](../../../features/metallic-paint.md) 不变量中的默认 `true` 改为 `false` 并互链本记录，上一记录（[2026-09-17-metallic-paint-toggle](2026-09-17-metallic-paint-toggle.md)）保留为历史决策，其「默认关 rejected」备选由本记录取代。

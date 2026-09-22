# Agent Note: 按钮悬停光泽默认关闭

Status: implemented

[English](2026-09-18-button-sheen-default-off.md) | 中文

## 问题

[悬停光泽记录](2026-09-13-button-metallic-paint-hover.zh.md) 落地 `metallicPaintEnabled` 时把 schema 默认定为 `true`，让从未打开过界面设置的用户也默认看到扫光。用户现在明确要求该特效默认关闭——附加动效应是主动开启项，不该出厂强加。

## 决策

出厂默认翻转为 `false`：`DEFAULT_THEME_SETTINGS.metallicPaintEnabled` 与 zod schema `.default()` 一起改，`applyAppearanceDocumentExtras` 的缺席语义从 `!== false`（缺席即开）改为 `=== true`（缺席即关），使传 partial extras 的调用点与新默认一致。已持久化的 `true` 值不受影响——只有从未动过开关的用户会失去扫光，而这正是新默认的含义。开关行、写入链路、属性门控与扫光视觉本身全部不变。

## 曾考虑的替代方案

- **维持 `!== false`（缺席即开）** — 否决：与 schema 默认 `false` 自相矛盾；boot 期 partial extras 会先画出扫光再被纠正。
- **默认开、依赖现有开关** — 否决：用户已明确要求默认关；「不撤回已发货视觉」的顾虑在提出者本人要求撤回时不再成立。

## 后果

出厂安装与未动过开关的设置不再显示扫光；界面设置开关仍是唯一控制入口。钉住出厂默认或缺席语义的测试随代码一起翻转。上一记录继续描述机制；其中过时的 `default true` 事实已就地更正并互链至此。

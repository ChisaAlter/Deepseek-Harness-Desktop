# Decision: 按钮悬停金属漆增加界面设置开关

Status: implemented

中文 | [English](2026-09-17-metallic-paint-toggle.en.md)

> 默认 `true` 的出厂值已由 [2026-09-18-metallic-paint-default-off](2026-09-18-metallic-paint-default-off.md) 翻转为 `false`；其余开关链路仍然有效。

## Problem

金属漆扫光自上线起在主 Web UI 全局常开，feature 卡曾把「为扫光新增设置开关」列入 Do not touch。用户明确要求能关掉悬停扫光——附加动效属于个人偏好，原先「常开」的产品约束需要反转。

## Decision

新增持久化布尔设置 `metallicPaintEnabled`（`ui-theme` 命名空间，schema 默认 `true`，保住出厂行为），Appearance 页新增「按钮悬停光泽 / Button sheen」开关行（`MetallicPaintRow`），经 `ThemeRuntime.setMetallicPaint` 写入。`applyAppearanceDocumentExtras` 把该标志镜像为 document root 的 `data-dsh-metallic-paint` 属性；`metallic-paint.css` 两条规则改为以 `html[data-dsh-metallic-paint]` 门控——sheet 照常注入，开关只翻转属性，关闭后按钮只剩变体自身 hover 填充。其余范围不变：仍只覆盖主 Web UI 原生 `button`，不扩到 `role='button'`、boot/launcher/图库或 mobile/web。

## Alternatives considered

- **默认关（opt-in）** — rejected：扫光自出厂即为验收过的默认视觉，默认关等于替存量用户撤回它；想关的人点一次即可。
- **CSS 变量改写而非属性门控** — rejected：变量方案下规则仍然命中、只是值被覆盖，语义不如「规则整体不生效」干净；`data-dsh-*` 根属性是 transparent / cursor-fx 已建立的同款模式。
- **运行时卸载整张 sheet** — rejected：样式表随插件生命周期挂载，运行时增删需要新的样式注册机制，为一个开关不值得。
- **不加开关、保持常开** — rejected：用户明确提出需求；强制开启一个没有功能收益的附加动效缺乏理由。

## Consequences

设置面新增一个持久化字段，schema / store / runtime / snapshot / api-catalog 声明全链同步；Appearance 页开关数 +1。`data-dsh-metallic-paint` 成为扫光的唯一激活条件，测试与文档以该属性存在与否为断言点。开启时行为与此前完全一致（含 reduced-motion 静态光泽）；关闭时仅失去扫光，其余主题层不受影响。卡片「Do not touch」中的「不新增设置开关」约束由此记录取代并互链 [feature 卡](../../../features/metallic-paint.md)。

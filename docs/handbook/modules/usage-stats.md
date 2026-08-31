# 模块：用量统计

## 职责与非目标

**职责：** 内置改版 `dsh-usage-panel` 作为设置 section `usage-stats`；跨会话 Token KPI / 热力图 / 模型拆分 / 导出；计费估算（峰谷桶 × 用户价格,官方价目 asOf 2026-08-17,非账单）；输入框下方费用条与「设置」弹层。  
**非目标：** 账户余额 API / user balance；改上游 token-meter；修改 DSH 框架的计费设施（官方 `dsh-billing-shared` 不在当前 harness 快照内,数学本地实现于 `src/shared/`）。

## 用户路径

设置 → 「用量统计」。无用量时空态。数据只读本机会话投影（UTC 日桶）。会话输入框下方费用条（高峰/谷段 + 倒计时 + 当前会话估算费用,悬停价目行）；条显隐与价格在「设置」弹层管理。费用条宽度与统计行、Dock 卡一样跟随输入卡拖动联动（[composer-family-width](../../features/composer-family-width.md)）。

## 架构要点

- 预置：`usage-panel-preset.js` + `vendor/dsh-usage-panel`。  
- Host：`ctx.sessionProjections` key `usagePanel`（stateVersion 2,含峰谷桶）；RPC `/usage-stats` loopback（overview / session.cost / billing.get|set / billing.models）；价格持久化 = storageDomain 域 `dsh_usage_panel_billing`（插件自有 JSON,只读红线不触碰会话日志）。  
- Client：`settings.section` id `usage-stats`；`ui-primitives` + token；费用条挂官方 `conversation.composer.dock` 槽（零 DOM 探测）。  
- Feature card：[../../features/usage-stats.md](../../features/usage-stats.md)

## 实现入口

- `src/main/usage-panel-preset.js`；`harness-controller.js` 在 dshmarket 残留清理之后、ensure dshbot 之前调用。

## 不变量

- 同一 profile 一份插件；桌面副本赢过市场同名安装。  
- 预置失败不挡启动。  
- `dsh-home/profiles/web`，不是 `~/.dsh`（[dsh-home.md](dsh-home.md)）。  
- 计费=估算；未定价模型绝不显示数字；峰谷窗口北京时间 UTC+8（周一至五 09:00–12:00/14:00–18:00 高峰,空闲=高峰一半）。

## 门槛

- QA：`TC-EXT-008`
- 自动化：`vendor/dsh-usage-panel` `npm test`（≥119 用例）/ `npm run build`

## 延伸阅读

- [用量统计设计](../../superpowers/specs/2026-08-23-usage-stats-design.md)
- [v0.3 计费开发流程](../../../vendor/dsh-usage-panel/docs/billing-development-plan.md)

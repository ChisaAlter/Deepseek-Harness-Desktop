# 模块：用量统计

## 职责与非目标

**职责：** 内置改版 `dsh-usage-panel` 作为设置 section `usage-stats`；跨会话 Token KPI / 热力图 / 模型拆分 / 导出；计费估算（峰谷桶 × 用户价格,官方价目 asOf 2026-08-17,非账单）；「设置」弹层（模型价格 + 峰谷开关）。
**非目标：** 账户余额 API / user balance；改上游 token-meter；修改 DSH 框架的计费设施（官方 `dsh-billing-shared` 不在当前 harness 快照内,数学本地实现于 `src/shared/`）；**输入框下方的峰谷状态 / 会话费用行**（归 harness 侧 `PeakValleyRow`，见 [session-cost-display](../../features/session-cost-display.md)；2026-09-02 移除了插件自带的重复费用条）。

## 用户路径

设置 → 「用量统计」。无用量时空态。数据只读本机会话投影（UTC 日桶）。价格与峰谷计价开关在「设置」弹层管理。

## 架构要点

- 预置：`usage-panel-preset.js` + `vendor/dsh-usage-panel`。  
- Host：`ctx.sessionProjections` key `usagePanel`（stateVersion 2,含峰谷桶）；RPC `/usage-stats` loopback（overview / session.cost / billing.get|set / billing.models）；价格持久化 = storageDomain 域 `dsh_usage_panel_billing`（插件自有 JSON,只读红线不触碰会话日志）。  
- Client：只注册 `settings.section` id `usage-stats`（不注册 `conversation.composer.dock`）；`ui-primitives` + token；零 DOM 探测。
- Feature card：[../../features/usage-stats.md](../../features/usage-stats.md)

## 实现入口

- `src/main/usage-panel-preset.js`；`harness-controller.js` 在 dshmarket 残留清理之后、ensure dshbot 之前调用。

## 不变量

- 同一 profile 一份插件；用户自装（真实目录或外部 junction）优先，桌面后退并删 overlay；仅无该条目时桌面复制预置包并自管 junction。  
- 预置失败不挡启动。  
- `dsh-home/profiles/web`，不是 `~/.dsh`（[dsh-home.md](dsh-home.md)）。  
- 计费=估算；未定价模型绝不显示数字；峰谷窗口北京时间 UTC+8（周一至五 09:00–12:00/14:00–18:00 高峰,空闲=高峰一半）。

## 门槛

- QA：`TC-EXT-008`
- 自动化：`vendor/dsh-usage-panel` `npm test`（≥119 用例）/ `npm run build`

## 延伸阅读

- [用量统计设计](../../superpowers/specs/2026-08-23-usage-stats-design.md)
- [v0.3 计费开发流程](../../../vendor/dsh-usage-panel/docs/billing-development-plan.md)

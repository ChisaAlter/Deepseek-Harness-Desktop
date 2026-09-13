# 模块：用量统计

## 职责与非目标

**职责：** 内置改版 `dsh-usage-panel` 作为设置 section `usage-stats`；跨会话 Token KPI / 热力图 / 模型拆分 / 导出；计费估算（峰谷桶 × 用户价格,官方价目 asOf 2026-08-17,非账单）；**唯一的模型价格编辑器**——「设置」按钮打开「计费设置」弹窗（2026-09-13 起 harness 侧的价格面板与入口已删除）。
**非目标：** 账户余额 API / user balance；改上游 token-meter；修改 DSH 框架的计费设施（官方 `dsh-billing-shared` 不在当前 harness 快照内,数学本地实现于 `src/shared/`）；**输入框下方的峰谷状态 / 会话费用行**（归 harness 侧 `PeakValleyRow`，见 [session-cost-display](../../features/session-cost-display.md)；2026-09-02 移除了插件自带的重复费用条）；**自建价格存档**（记录唯一为 `ui-conversation.sessionCostPrices`，插件只经 settings 服务读写它，自有 `dsh_usage_panel_billing` 域降级为一次性导入源）。

## 用户路径

设置 → 「用量统计」。无用量时空态。数据只读本机会话投影（UTC 日桶）。工具栏「设置」按钮打开「计费设置」弹窗管理模型价格（弹窗内不再展示官方价目表）；保存后输入框下方的会话费用条立即按新价重算。

## 架构要点

- 桌面内置模块：`usage-panel-preset.js`（`ensureDesktopUsagePanel`，dsh-im 模式）+ `vendor/dsh-usage-panel`。
- Host：`ctx.sessionProjections` key `usagePanel`（stateVersion 2,含峰谷桶）；RPC `/usage-stats` loopback（overview / session.cost / billing.get|set|models）；价格经 `ctx.settings.get('ui-conversation')` 读取、经 `settings.update` 写回（`settings/updated` 订阅刷新缓存），遗留的插件自有域 `dsh_usage_panel_billing` 在分节已注册且域处于 durable 模式时**一次性并入**（分节优先，先写成功再清退役记录），失败留待下次重试。
- Client：只注册 `settings.section` id `usage-stats`（不注册 `conversation.composer.dock`）；`ui-primitives` + token；零 DOM 探测；不注入任何 harness 客户端服务。
- Feature card：[../../features/usage-stats.md](../../features/usage-stats.md)、[../../features/session-cost-display.md](../../features/session-cost-display.md)

## 实现入口

- `src/main/usage-panel-preset.js`；`harness-controller.js` 在 dshmarket 残留清理之后、ensure dshbot 之前调用。

## 不变量

- 同一 profile 一份；桌面内置模块，不可禁用、不可移除，每轮都挂（含 skip 模式）；`DROPPED` 名单防市场双挂载。  
- 预置失败硬失败，挡启动（桌面运行时损坏）。  
- `dsh-home/profiles/web`，不是 `~/.dsh`（[dsh-home.md](dsh-home.md)）。  
- 计费=估算；未定价模型绝不显示数字；峰谷窗口北京时间 UTC+8（周一至五 09:00–12:00/14:00–18:00 高峰,空闲=高峰一半）。  
- **价格编辑器唯一且在本插件**：harness（峰谷行、界面设置行）不提供任何价格入口；未定价提醒的悬停标题指向 设置 → 消耗统计 → 计费设置。**价格存档唯一**为 `ui-conversation.sessionCostPrices`，插件不得另建记录。

## 门槛

- QA：`TC-EXT-008`
- 自动化：`vendor/dsh-usage-panel` `npm test`（≥119 用例）/ `npm run build`

## 延伸阅读

- [用量统计设计](../../superpowers/specs/2026-08-23-usage-stats-design.md)
- [v0.3 计费开发流程](../../../vendor/dsh-usage-panel/docs/billing-development-plan.md)

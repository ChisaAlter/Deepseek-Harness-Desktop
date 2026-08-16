# @deepseek-ai/dsh-client-ui-settings-usage

[English](README.md) | 中文

使用统计设置页：最近 7 或 30 天的 Token 用量、会话、人工提问、活跃情况和模型占比。

页面调用宿主 [`@deepseek-ai/dsh-usage-stats`](../../session/usage-stats) 的 `usage.summary`。渲染六张汇总卡、周日开头的活跃热力图、按天堆叠柱和模型环形图。图表是 SVG 与 CSS Grid，颜色走 `--dsw-alias-chart-*`。

## 模型体验

无。页面只读已写入日志的用量，不触碰模型、提示词、schema、流或工具结果。

#### KV Cache 影响

无；页面从不组装或发送提供方请求。

## 已知局限与延后工作

- 页面只报 Token，不估算花费。
- 热力图和图表跟随所选 7 / 30 天窗口，没有一年跨度的 GitHub 网格。
- 宿主未挂 `usage-stats` 时显示加载失败文案。

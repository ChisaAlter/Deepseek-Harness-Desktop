# Agent Note: Cross-session usage calendar for the settings page

Status: implemented

[English](2026-08-17-usage-stats-settings-page.md) | 中文

## Problem

设置面没有按时间窗口查看 Token 用量、人工提问或模型占比的入口。现成的 `tokenUsage` 与 `sessionStats` 投影是整段会话合计，撑不起 GitHub 式热力图或按天堆叠柱。若浏览器对每个冷会话拉 `session.history`，会把整本日志搬到客户端。

## Decision

宿主函数插件 `@deepseek-ai/dsh-usage-stats` 注册 `usageDaily` 投影单元并提供 `ctx.usageStats`。折叠记录按 turn/step 去重的带时间戳用量样本和人工 `user/message` 时间，不按本地日历分桶。`usageStats.summarize({ rangeDays, timeZone })` 用客户端 IANA 时区切成 7 或 30 天 DTO。

线上方法是 `usage.summary`。服务缺席返回 `usage-stats-absent`，不是 HTTP 500。Web 设置分区 `usage`（order 15）由 `@deepseek-ai/dsh-client-ui-settings-usage` 渲染：六张卡、周日开头的热力图、按天堆叠柱、模型环形图。图表色走 `--dsw-alias-chart-1..5` 与 `--dsw-alias-chart-empty`，页面不引入图表库。

在线会话优先。冷会话先读投影缓存，再 fail-soft 地并发 `readFrom` 恢复。Token、消息和热力图计入 subagent 子会话；`sessionCount` 只计窗口内有过人工提问的根会话。DTO 只报 Token，不做货币换算。

## Alternatives considered

**复用 `tokenUsage` / `sessionStats` 作为页面数据源** — 否决。这两个单元是全日志合计，没有按天、按模型轴，画不出热力图和堆叠柱。

**浏览器从 `session.history` 折日历** — 否决。打开设置就会在客户端解析每一本冷日志，拖垮面板。

**投影按 UTC 日分桶** — 否决。之后按 America/Los_Angeles 切窗会把晚间 UTC 样本记到错误的本地日。

**侧栏独立整页** — 本次否决。设置槽已经承载功能页；新开壳路由会扩大信息架构，又拿不到 RPC 给不了的数据。

**用内置单价表估算花费** — 延后。仓库没有模型单价，需求 UI 也是 Token 用量。

## Consequences

web-app bundle 同时挂上宿主插件和设置分区。未挂 `usage-stats` 的装配仍可用：RPC 以 `usage-stats-absent` 拒绝，页面显示加载失败。没有缓存行的冷会话付出有限并发的 `readFrom`；读取失败则该会话按空计。不上报 usage 的适配器 Token 为 0，提问仍计入。以后若要一年热力图，可复用同一批带时间戳样本，不必改折叠。

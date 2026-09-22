# 用量统计：预置改版 dsh-usage-panel

桌面启动时把 MIT 插件 `dsh-usage-panel` 装进 web profile（和 `dshmarket` 一样）。设置里多一个 `usage-stats` 分区，展示跨会话 Token 用量。视觉跟官方 `dsh web`：`ui-primitives` + `--dsw-alias-*`，不是第二套皮肤。

## 决定

1. **底盘是社区插件，不是上游新包。** 快照在 `vendor/dsh-usage-panel`，来源 [AlfredChaos/dsh-usage-panel](https://github.com/AlfredChaos/dsh-usage-panel)。Host 用官方 `ctx.sessionProjections` 四桶（未缓存输入 / 输出 / 缓存读 / 缓存写），fork 去重，不写回会话日志。不改 `token-meter`、聊天 `StatsLine`、composer ContextMeter。
2. **只做 Token。** 不做账户余额、峰谷价、人民币计价、预算告警、官方 `/user/balance`。
3. **入口是设置分区。** `settings.section` id `usage-stats`，order 25，导航「用量统计」。不是侧栏 footer、不是会话浮卡。
4. **预置路径与市场相同。** `usage-panel-preset.js` 复制到 `desktop-plugins`，junction 进 `node_modules`，managed `cordis.patch.yml`。不调用 `dsh plugin add`。缺 `zod` 则 strip insert，Harness 仍启动。
5. **桌面改版赢。** 包名保持 `dsh-usage-panel`。每次启动刷新 `desktop-plugins`。`node_modules` 里已有非 junction 用户安装时，仍改成指向 `desktop-plugins` 的 junction，避免两份 client 抢投影 key `usagePanel` 和 section id。profile `bundles` 已列出同名包时不插入第二行 managed patch（市场装过的 patch 仍解析到我们的副本）。
6. **日桶保持 UTC。** 热力图与导出按 UTC 日历日；字幕声明 UTC。v1 不改本机时区（那会 bump `stateVersion` 并全量重折）。
7. **Client 必须走 host 的 ui-primitives。** esbuild 把 `@deepseek-ai/dsh-client-ui-primitives` 标 external；缺失 `Button` / `Menu` 则跳过注册。图表指针跟随 tip 保留自绘，但只吃 token（官方 `Tooltip` 是锚点字符串气泡，不适配环形图）。
8. **展示口径。** 中文 Token 不到 10 万显示整数，万从 10 万起。空态看有计费用量的会话（扫描失败仍出仪表盘；仅空白会话走空态）。

## 非目标

- 改 `agent-loop` 或 token-meter 口径。
- 普通 `dsh web` / npx 自动带此插件。
- 做成 `packages/client` 官方包。
- 给设计语言开「预置插件可自带皮肤」例外。

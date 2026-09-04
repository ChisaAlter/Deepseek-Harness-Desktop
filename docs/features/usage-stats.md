# Feature: 用量统计

| Field | Value |
| --- | --- |
| **id** | `usage-stats` |
| **status** | `active` |
| **last verified** | 2026-09-04 — **host 读法适配 vendored rc.1（修复统计全 0 与「更新失败」）**：面板曾按 npm rc.6 的 1 参 `coldSnapshot(id)` 调用，vendored pin 自 alpha.2 起为 `coldSnapshot(meta, inheritedEventCount, events)`（调用方自备完整日志）→ 全部会话被计「读取失败」、token 全 0，且 deltaScan 的 `cachedSnapshot` 探针在 try/catch 之外致整扫 reject（客户端 fallback「更新失败于 {UTC 时间}」）；「修复」按钮重写健康日志无效、重启无效（病在调用签名，见 [vendor AGENTS §6.5](../../vendor/dsh-usage-panel/AGENTS.md)）。现扫描走 `sq.readSession(id)`（live-preferred + replay 校验）→ 3 参 coldSnapshot（seed+折叠+回写缓存行）；探针裹 try/catch（失败=退化重读）；`SESSION_QUERY_SESSION_NOT_FOUND` ≠ 修复候选；结构化本地 face 落 `vendor/dsh-usage-panel/src/host/types.ts`（npm rc.6 类型面对这些服务不可信）。客户端 repairStill 竞态同修（load 返回载荷，复查等真实刷新）。门禁：面板 `npm run typecheck` + `npm test` 138 全过 + `npm run build`。此前 2026-09-03 — **预置复制不再阻塞主线程**：`ensureUsagePanelPlugin` 改为 async，桌面托管副本用 `fs.promises.cp` 增量刷新（`preserveTimestamps`，size+mtime 相同的文件跳过），替代每次全量启动同步 `fs.cpSync` 约 6k 文件（实机 11.4 s，是安装包首启「未响应」的一段，见 [windows-installer](windows-installer.md)）；控制器早已 `await` 该调用，语义不变；单测钉死不得回退 `cpSync`。此前 2026-09-02 — **移除输入框下方费用条**（`CostStrip` + `conversation.composer.dock` 注册 + 设置弹层「条显隐/峰谷提示」两开关）：pr-76 的 harness 侧 `PeakValleyRow`（[session-cost-display](session-cost-display.md)）与 pr-79 的插件侧 `CostStrip` 在合并后同时挂在同一槽位，输入框下出现两行相同的「高峰时段 / 倒计时 / 本会话费用」；峰谷状态与会话费用行现由 `PeakValleyRow` 独占。`BillingSettings` 只剩 `prices` + `peakValleyEnabled`；旧记录中的 `stripVisible`/`peakHintVisible` 在 zod 边界按可选字段容忍并丢弃。此前 2026-08-28 — 费用条宽度随输入卡拖动联动（`--dsh-composer-resized-width` 回退静止卡宽,见 [composer-family-width](composer-family-width.md)）。此前 2026-08-26 — 计费功能(v0.3 本地改版):投影 stateVersion 2 增峰谷桶,输入框下方费用条(conversation.composer.dock 官方槽)、"设置"弹层(官方 Modal:模型多选/峰谷开关/自定义价/条显隐)、KPI/会话卡/导出费用列;官方价目 asOf 2026-08-17 + 来源链接单测锁值;价格持久化为插件自有 JSON(storageDomain `dsh_usage_panel_billing`);扫描分批评让步防大语料重折假死。此前 2026-08-26 — D1 挂载机制收敛(overlay patch + strip 迁移,见 Invariants);2026-08-24 — 热力图半年窗口月度切换。自动化:`vendor/dsh-usage-panel` `npm test` + `npm run build`。 |

## User paths

1. 设置 → 「用量统计」（`usage-stats`）：KPI（含估算费用卡）、半年窗口内按月可选 UTC 热力图、按模型柱/环、Top 会话（含费用列）、导出（含费用列）、「设置」弹层（模型多选 + 峰谷开关 + 自定义价）。
2. 会话输入框下方的峰谷状态 / 当前会话费用行**不属于本插件**：由 harness 侧 `PeakValleyRow` 独占（[session-cost-display](session-cost-display.md)，界面设置「会话累计费用」开关）。本插件不得再向 `conversation.composer.dock` 注册条目，否则同一信息会出现两行。
3. 无计费用量（含仅空白会话）走空态文案；扫描失败仍出仪表盘，不挡启动。
4. 刷新从 host RPC 重扫；数字来自本机会话投影，不写回日志。

## Invariants

- 预置包名 `dsh-usage-panel`；设置 section id `usage-stats`；投影 key `usagePanel`。同一 profile 只挂一份。
- **桌面内置模块（dsh-im 模式）**：挂载走桌面自有 overlay（`desktop-usage-panel.patch.yml`，**每轮启动**都经 `--patch` 传，含 skip 模式），不写 `cordis.patch.yml` 受管块（该文件纯用户所有，见 desktop-launcher 卡）。`dsh-usage-panel` 在 `DROPPED` 名单：市场/用户 bundle 安装被启动时 `stripDroppedPlugins` 清除，insert + bundle 双挂载不会发生。
- **不可禁用、不可移除**：config `normalizeDisabledPlugins` 剥离别名（禁用名单永不生效），IPC `shell:disable-plugin` 返回 `desktop-builtin`，`shell:remove-plugin` 返回 `preset`；forensics 标记为 `inBox`（桌面内置组件）。
- 只统计 Token 四桶；**计费为估算**（费用 = 峰谷桶 × 用户价格，全部本地计算,非账单）;不做余额 API。
- 峰谷口径：北京时间 UTC+8 无夏令时,周一至五 09:00–12:00、14:00–18:00 高峰;整步按 step/start 时刻归类;compaction 不入费用桶;官方价目 asOf 2026-08-17 + 来源链接 + 单测锁值。
- 不猜价：未定价模型显示"设置价格"/"—",绝不编造数字(竞品红线延续)。
- 日桶 UTC；字幕声明 UTC。
- 颜色只走 `--dsw-alias-*` / `--dsw-static-deepseek-*`；刷新/导出/设置弹层用 `ui-primitives`；零 DOM 探测。客户端只注册 `settings.section`，**不注册** `conversation.composer.dock`（`src/shared/composer-family-width.test.js` 钉死）。
- 价格持久化 = 插件自有 JSON(storageDomain 域 `dsh_usage_panel_billing`),不写入会话日志;记录形状 `{prices, peakValleyEnabled}`，旧字段 `stripVisible`/`peakHintVisible` 只读容忍、不再写出。
- **损坏日志修复(用户授权,只读承诺的唯一例外)**:扫描失败的会话 id 在覆盖度中列出;页面显式「自动修复」→ 仅重写该损坏工件(解码全部行→0 基连续重编号→重打包 zstd→原子替换,先备份 `.bak-<ts>`);解码失败即中止;健康日志永不触碰;仅桌面运行时可用(standalone npm 优雅报错)。
- 安装落点是桌面 `dsh-home/profiles/web`，不是 `~/.dsh`（见 [dsh-home](dsh-home.md)）。
- 预置失败硬失败，挡 `dsh web`（桌面运行时损坏，skip 模式无法修复）。

## Allowed touch

- `src/main/usage-panel-preset.js`、`harness-controller.js`、`index.js`（启动接线）
- `vendor/dsh-usage-panel/`（预置插件源与改版 client）
- `scripts/setup-harness.js`、`scripts/after-pack.js`、`package.json` extraResources
- 相关桌面测试、本卡、handbook 用量章、QA `TC-EXT-008`

## Do not touch

- 上游 token-meter / StatsLine / ContextMeter — 例外：StatsLine 宽度联动由 [composer-family-width](composer-family-width.md) 卡拥有
- 账户余额 API、/user/balance、侧栏 footer 的余额能力
- 无关邻域：市场窗、壁纸、Surfaces（除非用户扩大 Touching）

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/usage-panel-preset.test.js`、`harness-controller.test.js` 接线、extraResources / gitignore 钉死；`qa:source` / `release-ui-walk` 的 `usage-stats` 分区存在 |
| Manual / QA | `TC-EXT-008`（空态含仅空白会话算通过）；有用量时 KPI 整数（不到 10 万）为 P1 |

## Sources

- Handbook：[../handbook/modules/usage-stats.md](../handbook/modules/usage-stats.md)
- Spec：[../superpowers/specs/2026-08-23-usage-stats-design.md](../superpowers/specs/2026-08-23-usage-stats-design.md)
- Implementation entry：`src/main/usage-panel-preset.js` `ensureUsagePanelPlugin`

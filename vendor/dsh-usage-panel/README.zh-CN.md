<div align="center">

# dsh-usage-panel

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Token 用量统计插件，在 Web GUI 的「设置 → 消耗统计」下展示。插件通过会话投影机制增量聚合持久化会话日志，永不写回任何数据。

[English](README.md) · [![npm](https://img.shields.io/npm/v/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![npm downloads](https://img.shields.io/npm/dm/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![CI](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml) [![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin) [![Mentioned in Awesome DeepSeek Harness](https://awesome.re/mentioned-badge.svg)](https://github.com/0xsline/awesome-deepseek-harness)

<img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/demo.gif" width="620" alt="dsh-usage-panel v0.2 使用演示：加载、KPI 动画、热力图入场、悬停明细与时间范围切换" />

</div>

## 页面内容

- **汇总数据（全部历史）** —— 计费输入 / 输出 Token、会话数量（次级标注总会话数与主/子代理用量拆分）、最常用模型及其占比。
- **缓存命中率** —— `缓存读 ÷（未缓存输入 + 缓存读 + 缓存写）`，附读写绝对量。
- **费用合计（估算）** —— 按模型定价的全历史费用，附峰段/谷段拆分；详见「费用与计价」。
- **活跃热力图** —— 半年数据窗口内按 UTC 自然月展示（列为周、行为星期），‹ › 切换月份。按当月非零日用量的四分位分 4 级色阶。
- **每日柱状图** —— 按模型堆叠的每日用量，可切换最近 7 / 14 / 30 天。
- **会话用量排行** —— 最耗 Token 的 10 个会话（含折叠标题），每行按委派深度标注**主会话**或**子代理**，并带估算费用列。
- **服务商用量** —— 多 Provider 时以横向条形按路由展示各自 Token 消耗。
- **模型环形图** —— 各模型全历史占比，旁边列出前 5 名；每行带**缓存命中率**列，颜色与对应分段一致。
- **导出** —— 完整 JSON、每日 CSV、模型 CSV（防公式注入、RFC 4180、UTF-8 BOM；费用列以整数分计）。
- **输入框下方费用条** —— 当前高峰/谷段、距下次切换倒计时、当前会话估算费用（悬停显示当前模型价目行）；宽度随输入卡拖动联动（`composerResize`，回退静止卡宽）；可在用量统计页「设置」中开关。
- **计费设置** —— 导出旁的「设置」弹层：条显隐、峰谷计价总开关、逐模型自定义价（模型列表与 DSH 提供商目录同步 + 用量中见过的模型）。

悬停柱子、热力图格子或环形图分段可以看到具体明细：

| 柱状图悬停 | 概览（KPI + 热力图） | 会话排行与服务商 |
| --- | --- | --- |
| <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-hover-bar.png" width="200" alt="柱状图悬停明细" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-overview.png" width="200" alt="KPI 卡片与热力图概览" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-sessions.png" width="200" alt="会话用量排行与服务商用量" /> |

## 安装

插件以 bundle 形式发布：`dsh plugin add` 会把它追加到 profile 的 bundle 列表，patch 行负责挂载 Host 半。

```sh
# 从 npm 安装（推荐）
dsh plugin --profile web add dsh-usage-panel

# 或从 GitHub 安装
dsh plugin --profile web add github:AlfredChaos/dsh-usage-panel

# 或从本地目录安装
dsh plugin --profile web add ./dsh-usage-panel
```

重启 `dsh --profile web`，打开「设置 → 消耗统计」。npm 包内 `lib/` 下是预构建的纯 JavaScript 产物，无安装脚本；GitHub 安装同样不需要 pnpm 的构建放行，因为仓库里提交了相同的文件。卸载：

```sh
dsh plugin --profile web remove dsh-usage-panel
```

## 数据来源

Host 半聚合持久化会话日志：

- **主路径（增量）**：注册一个会话投影（`ctx.sessionProjections`，带 `stateVersion` 校验），把每个已提交事件折叠进四个互斥桶 —— 未缓存输入 / 输出 / 缓存读 / 缓存写 —— 以及按模型、按 Provider、按天（UTC）的映射。checkpoint 落盘，重启与保鲜扫描几乎零回放。
- **回退路径（全量重扫）**：投影服务不可用时，同一套 reducer 通过只读 `sessionQuery` 服务重放每个会话日志。

记账规则：`request/header` 与 `request/context` 记录模型（context 打底、header 覆盖）；该步骤的 `assistant/message` 用量**替换**流式暂记用量（同一步重试的消息不会重复累计）；`llm/retry` 事件只计重试次数、不计 Token；`compaction/summary` 用量归属其自身模型并单独披露（且**绝不进入费用桶**）；reasoning token 已含于 output，绝不重复相加。

**子会话（fork）去重**：最后一个 `session/end-seed` 标记之前的事件（fork / resume / replay 种子历史）一律不计数，fork 出的会话不会重复计算父会话的用量。

**时区声明**：日桶与导出一律用 **UTC** 自然日（`YYYY-MM-DD`），热力图副标题声明所选月份与 UTC。计费时段使用**北京时间**（UTC+8、无夏令时）——见「费用与计价」。

由于从不写回，统计可跨重启存活，并覆盖安装插件之前的会话。

## 费用与计价

所有金额都是**估算，不是账单**——插件无法访问 DeepSeek 计费系统，数字为本地按用量计算。

- **时段（官方）**：高峰 = 北京时间周一至周五 09:00–12:00 与 14:00–18:00；其余一切时刻（周末、晚间、深夜、午间休息）为谷段，按官方空闲价计。官方声明空闲价 = 高峰价的一半。
- **官方价目表**：数据文件，`asOf 2026-08-17` + 官方来源链接，单测锁值。模型：`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`;命中 / 未命中 / 输出 × 高峰 / 谷段。
- **整步归类**：一次请求（step）按其 `step/start` 时刻判定时段——跨时段的步骤整步按其开始时刻计费。compaction 不入费用桶。
- **计价**：逐模型、在客户端按峰谷桶计算——改价即时重算所有数字，**绝不重放日志**。解析顺序：你的自定义价（provider 作用域键优先，裸模型兼容）→ 官方列 → **未定价**。未定价模型显示"设置价格"/"—"，绝不猜测；非 DeepSeek 模型须先设自定义价才会出现费用。
- **自定义价**：在用量统计页「设置」弹层编辑（每模型：命中 / 未命中 / 输出；可选显式谷段价；可选逐模型"峰谷计价关闭"）。持久化在**插件自有 JSON 记录**（storage-domain 槽 `dsh_usage_panel_billing`），绝不写入会话日志。
- **峰谷开关**：全局——关闭后两时段都按高峰价计。
- **数学**：整数微元 + 最后单次舍入到分；CSV 导出费用列为整数分（未定价的行留空）。

**升级说明（v0.3）**：投影状态版本升至 2；升级后首次启动会对每个会话日志重折一次（分批让步执行，宿主保持响应——大语料不会假死，页面显示"后台更新中"），此后读取保持增量。

## 加载策略

插件加载时立即开始首次扫描，打开页面时通常直接命中缓存。缓存 10 分钟内视为新鲜；更旧的缓存会立即返回并标记 `stale`（页面显示「后台更新中…」），同时后台重扫刷新。每 10 分钟定时轻量重扫保鲜，刷新按钮始终强制同步重扫。浏览器还会把最近一次成功载荷存入 `localStorage`（带版本号与结构校验），刷新页面即刻渲染；刷新失败时保留旧数据并如实标注，绝不伪装最新。

## 单位

中文界面：不到 10 万显示整数；≥ 10 万用「万」；≥ 1 亿用「亿」。英文界面：K / M / B。

## 实现

源码为 TypeScript（strict）位于 `src/`，esbuild 构建；`lib/` 产物提交进仓库，安装无需构建步骤。

| 文件 | 说明 |
| --- | --- |
| `src/host/index.ts` → `lib/index.js` | Host 半（Cordis 插件）：投影注册、聚合、带预热的 RPC 缓存、fail-soft 回退、计费 RPC 端点 |
| `src/host/projection.ts` | 纯函数会话投影 reducer（四桶 + 峰谷桶、fork 去重、重试/压缩语义、UTC 日桶、step/start 时段判定） |
| `src/host/aggregate.ts` | 跨会话合并 → overview 载荷（含费用映射） |
| `src/host/billing-store.ts` | 计费偏好持久化（storageDomain 插件自有 JSON；fail-soft 内存） |
| `src/client/*` → `lib/client.js` | Client 半（`./client` 导出，`__ModuleLoader__` bundle）：TSX 设置页 UI、设置弹层、输入框费用条，`--dsw-*` 变量，中英双语 |
| `src/shared/contract.ts` | Host↔client wire 契约（单一来源） |
| `src/shared/pricing.ts` | 官方价目表（asOf + 来源）、解析器、价格校验 |
| `src/shared/billing.ts` | 峰谷窗口数学 + 倒计时 |
| `src/shared/cost.ts` | 整数费用数学（微元 → 分） |
| `src/shared/contract.ts` | host↔client wire 契约（单一来源） |
| `cordis.patch.yml` | Bundle patch：向 profile 组合插入 `usage-stats` 行 |

Host 通过 `ctx.connection.rpc.handle('/usage-stats', …, { authority: 'loopback' })` 提供 `overview` 端点，浏览器经 `rpc.call('/usage-stats', 'overview', …)` 调用。overview 载荷包含 `coverage`（总会话数与主/子代理用量拆分，展示于会话数量 KPI 次级文字）、`topSessions`、`providers`，并保留 v0.1.0 形态的 `days` / `totals` / `byModel` / `allTime`。基于 DeepSeek Harness `0.1.0-rc.6` 开发验证。测试使用 Node 内置 test runner（`npm test`）；CI 执行 typecheck + build + test + 打包门禁。

## License

[MIT](LICENSE)

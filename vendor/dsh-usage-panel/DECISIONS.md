# DECISIONS.md — v0.2.0 迭代决策记录

> 每个 P0/P1 项的决策与验收证据。遵循策略文档与 AGENTS.md 的既定方向；所有偏离都记录在案。

## D1. 数据路径：投影为主、全量重扫为回退，共用同一 reducer
- **决策**：`sessionProjections` + `sessionProjectionCache` 可用时走增量投影（`mode: 'projection'`）；不可用或注册失败时 fail-soft 到 `sessionQuery` 全量重扫（`mode: 'scan'`）；`sessionQuery` 也没有时 `mode: 'none'`。两条路径共用 `src/host/projection.ts` 的 `applyEvent`（单一记账核心）。
- **验收**：`tests/projection.test.ts`（14 用例）+ `tests/aggregate.test.ts`（4 用例）全绿；host 导出 `{name, inject, apply}` 与 v0.1.0 一致。

## D2. 种子边界：最后 `session/end-seed` 标记（武装语义）
- **决策**：投影注册表的冷折叠是单趟（`init` + 逐事件 `apply`，无回看），故 reducer 采用武装语义——看到最后一个 `session/end-seed` 之前一律不计数；`foldEvents` 与 scan 路径先预扫最后一个标记再折叠。scan 模式对无标记的旧日志用 `header.seedLength` 合成边界（v0.1.0 兼容），两者皆无时从 seq 0 计数。
- **已知限制**：投影模式下"双重 fork"（种子内再种子的日志）会把第二个种子计入（v0.1.0 的 seedLength 可处理）；属边缘场景，记录于 projection.ts 注释。
- **验收**：`seed events are never counted` 用例；scan 路径合成边界逻辑在 scan.ts 有注释。

## D3. 日期口径：UTC 日桶 + 显式声明
- **决策**：`dayKeyUTC` 全量替换 v0.1.0 的本地时区 `dayKey`；README 与覆盖度卡片声明口径。
- **偏离说明**：最近 30 天窗口从"事件时间戳 >= now-30d"改为"日桶 key >= 今天-30d"（日粒度边界，差异 < 1 天），两模式一致。
- **验收**：`tests/usage.test.ts`（UTC 跨时区用例）、`buildDayWindow` 用例。

## D4. 命中率公式（无需 clamp）
- **决策**：DSH `TokenUsage` 四桶**互斥**（`inputTokens` 只含未缓存输入，已核 `dsh-llm` 类型注释），故 `hitRate = cacheRead / (input + cacheRead + cacheWrite)`，分母为 0 返回 null；v0.1.0 的 `total = 四桶之和` 确认无重复计。
- **验收**：`tests/usage.test.ts` `hitRate` 用例 + `totalsFrom sums the four disjoint buckets` 用例。

## D5. i18n：DSH locale 服务 + 本地词典回退
- **决策**：client `inject` 追加 `locale`；词典经 `ctx.locale.register(NS, …)` 注册，`bind` 翻译，`locale/change` 事件驱动重渲染；设置页 label 用 thunk 每次重读。host 只返回错误码（`ErrorCode`），文案映射全部在 client。
- **偏离说明**：使用 untyped `bind`（命名空间未并入 `LocaleNamespaceMap` 合并表，属官方允许路径）；注册失败时回退本地 zh 词典。
- **验收**：`createI18n` 单测未单列（依赖宿主运行时），词典键与组件一一对应；错误码枚举在 contract.ts。

## D6. 导出在客户端完成
- **决策**：CSV/JSON 由客户端从 overview 载荷构建（`src/client/export.ts`），不新增 RPC 端点；防公式注入 `=+-@` 前缀、RFC 4180、UTF-8 BOM、UTC 日期键。
- **验收**：`tests/export.test.ts` 4 用例全绿。

## D7. Provider 维度：日志采集 + listProviders 命名
- **决策**：`request/context.provider` 与 `request/header.config.provider` 双源采集（与模型归因同构），`llm.listProviders()` 只用于名字解析（失败回退路由 id）。未做 settings 解析（策略原文提及，量级不符，记入 P2 决策文档）。
- **验收**：`tests/projection.test.ts` 归因用例断言 `byProvider`；`aggregate.test.ts` 断言 `providers` 行。

## D8. 构建：esbuild + 自写 wrap，不用 tsdown
- **决策**：host ESM 全外部化；client CJS bundle（`react` 外部）套 `__ModuleLoader__.load` 工厂；声明产物走 tsc。拒绝 token-usage 的 tsdown/monorepo 布局耦合。
- **验收**：`scripts/build.mjs` + `wrap-client.mjs`；模拟 loader 加载 `lib/client.js` 返回 `{apply, inject: ['slots','connection','locale']}`。

## D9. 依赖事实修正
- **决策**：`@deepseek-ai/cordis` 实为 `^4.0.1`（cordis v4 fork，非 rc.6 号段）；`dsh-session-projection` peer 要求 **zod ^4.4.3**（v4 的 `z.record` 需双参）；`SessionId` 是品牌类型。`cordis-plugin-timer` 仅作 devDep 类型源，产物零运行时 import（本地声明增强替代）。
- **验收**：typecheck 全绿、`npm ls` 无冲突。

## D10. P2 四项：全部 no-go（书面结论）
- **决策**：见 `docs/P2-decisions.md`——费用/预算/悬浮窗/余额 API 各有硬前提（真实价目、覆盖完整、公开 overlay slot、opt-in 降级），本轮不实现，建议 v0.3.0 重新评估。

## D11. 覆盖度与统计字段
- **决策**：`coverage.eventsCounted` 仅在 scan 模式填充（投影模式不重放全量事件）；`compactionTokens` 与 `retries` 全局聚合；`topSessions` 取全历史 Top 10，标题在 scan 模式折叠自日志、投影模式只对 Top10 调 `readTitle`（读盘上限 10 次/扫描）。
- **验收**：`finalizeOverview` 用例断言 coverage/titles/providers 字段。

## D12. 打包门禁
- **决策**：`files` 白名单仅 `lib/` + patch + READMEs；`scripts/check-pack.mjs` 挂 `prepublishOnly` 与 CI；README 图片指向 GitHub raw URL。
- **验收**：`npm run check-pack` 通过；`npm pack --dry-run` 清单无资产（见 PR 描述）。

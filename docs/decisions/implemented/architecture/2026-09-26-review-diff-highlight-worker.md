# Decision: ReviewDiff 语法高亮移入内嵌源码 Worker，主线程只保留有界降级

Status: implemented

中文 | [English](2026-09-26-review-diff-highlight-worker.en.md)

## Problem

上游采用计划 D5 要求每个高亮相关主线程任务 <50 ms，且「首次 grammar/tokenize 使用可测小于 50 ms 的 worker 或可中断分片，不把同步长任务原样挪进 timer」。实测在真实 Electron/Chromium 中，共享 ReviewDiff 首次 tokenize 内部存在单次不可分割的逐规则 scanner 构造（单次 `tokenizeLine2` 调用 50–200 ms，首块 1 行仍是 ~66 ms 固定成本）。`tokenizeTimeLimit` 只在 scanner 迭代之间检查，覆盖不了这次构造；预热语料也无法覆盖任意输入会触达的规则集（Node 探针显示每个新构造族首降 30–70 ms，无界）。因此主线程内不存在合规路径。

## Decision

按 `ui-sidebar-documentpreview` 既有内嵌源码 Worker 配方式实现：

1. `markdown/highlight-engine.ts`：从 `highlight.ts` 拆出的 worker-safe 引擎核（shiki 引擎、pattern 表、warmup、`lineSpans`、`grammarRegistered`、`registerGrammarModules`），不含 `LAZY_GRAMMARS`——否则 rolldown iife 打包会把 40+ 懒语言模块全部内联进 worker 字符串。
2. `markdown/highlight.worker.ts`：自包含 worker 入口，`ready` 握手 + `job/done/missing/drop` 协议；worker 侧一次性 `codeToTokensBase` 每侧，无需分片。
3. `markdown/highlight-jobs.ts`：主线程客户端。懒 `import('./highlight.worker.ts?raw')` → Blob URL → 每页一个共享 Worker；run-scoped job id 使多个面板互不失效；`drop` 抑制取消后的浪费；`missing` 回复时主线程 `fetchGrammarModule`（只取注册数据、不在主线程注册）→ 投递 worker → 重发 job；worker 失败整体回退内联路径。
4. `ReviewDiff.tsx`：worker 优先；无 `Worker`/`createObjectURL` 或构造失败时走原有 15 ms 分片内联路径。span 应用计入 `dsh.reviewDiff.slice` measure；worker 耗时以 `dsh.reviewDiff.worker` mark 独立上报；取消记 `dsh.reviewDiff.discard`。
5. tsdown 配置加 `?raw` 拦截插件把 worker 子图打包成单文件 iife 文本；动态 import 使 worker chunk（~607 KB / ~91 KB gzip）懒加载，不进 `lib/index.js` 主图。

Markdown/普通代码块路径不变（继续用主线程 warmup + 同步 tokenize）；本决策只约束 ReviewDiff 对比渲染面。

## Alternatives considered

- **更大预热语料覆盖全部规则集** — rejected：每个未覆盖构造族首降 30–70 ms，语料无界；探针证明这是 whack-a-mole。
- **`tokenizeTimeLimit` 逐行时限** — rejected：时限只在 scanner 迭代间检查，scanner 构造在单次 `matchRuleOrInjections` 内原子发生。
- **枚举 grammar 内部强制编译所有 scanner** — impossible：rule 对象在首次下降时惰性注册，无法穷举。
- **沿用 15 ms 内联分片做主路径** — rejected：分片只能约束每 tick 的工作量，首次 tokenize 的原子调用本身已超预算（实测 68–92 ms）。
- **上游未采纳的独立组件** — 本结构沿用上游 `?raw`+Blob worker 先例（`excelWorker` 插件模式），非新机制。

## Consequences

- 8 场景 × 5 样本浏览器基准：主线程高亮 slice max 10.2 ms，0 违规；worker 侧耗时独立记录（单 6000 行约 200–230 ms）。
- `lib/` 增 ~607 KB 懒 chunk；jsdom/无 Worker 环境自动走内联降级，测试不需 Worker polyfill。
- worker 拉取语法走 `missing→langs→repost` 协议；纯文本始终先可读，高亮失败/取消不留陈旧结果。
- 与 `docs/decisions/proposed/architecture/2026-09-21-syntax-highlight-scheduling.md` 部分取代关系：该记录的 warmup/pattern 表机械仍在 markdown 路径服役，其 deferred「worker 是下一步」条件在 Diff 面上达成并落地。
- 维护点：新增 grammar 或 shiki 升级时 `harness-desktop-forks` marker + bench 复跑守卫协议面。

# Decision: 语法高亮按需调度，并把初始化拆成受预算约束的切片

Status: proposed

中文 | [English](2026-09-21-syntax-highlight-scheduling.en.md)

## Problem

`ui-primitives/src/markdown/highlight.ts` 在**模块加载**时无条件执行
`setTimeout(() => highlighter(), 0)`。只要 Markdown renderer 被导入——也就是每个会话——
即使当前界面没有任何代码块，也会构造 shiki 引擎并预热 TypeScript / shell / JSON 三个 grammar。
代码自己的注释按历史测量记录为约 120–175 ms 的同步任务。

本轮实测（Node 22.23.2，`packages/client/ui-primitives`，同一进程内另起一次运行取多次样本）
把这段成本拆开：

| 阶段 | 实测 |
|---|---|
| Oniguruma → JavaScript pattern 翻译（231 个 pattern） | ~135–150 ms |
| 三个 grammar 的首次 tokenize（TypeScript 为主） | ~200–285 ms |
| 单个最大 scanner（128 pattern）构造 | ~90–93 ms |

也就是说：真正的长任务不在「构造 highlighter」这一行，而在**首次 tokenize 时按 grammar
惰性构造 scanner**。把 `setTimeout` 改成 `requestIdleCallback` 只是把同一个长任务搬走，
不构成消除阻塞。

## Proposal

两步，都可独立回滚。

### 1. 构建期生成 pattern 表，运行时只做 `new RegExp`

`scripts/generate-highlight-pattern-table.mjs` 在构建期把 boot grammar 实际用到的 TextMate
pattern 翻译成 JavaScript `RegExp` source + flags，产出
`src/markdown/highlight-pattern-table.generated.ts`（当前 322 项，约 144 KB 源码）。

运行时用该表作为引擎 `cache` 的种子：shiki 的 scanner 会直接复用命中的 `RegExp`，不再调用
翻译。表里没有的 pattern（懒加载的 read-card grammar，或依赖升级后新增的 pattern）继续走
原来的 `defaultJavaScriptRegexConstructor`，代价是旧速度而不是失败。

`tests/highlight-pattern-table.client.spec.ts` 用与生成器相同的样本重放两个 boot grammar，
只要安装的 grammar 请求了表中没有的 pattern 就**失败**——依赖升级不会静默退回运行时翻译。

### 2. 按需 + 分片预热

- 删除模块加载时的无条件预热。`warmHighlighter()` 由 `useViewportHighlighting` 在第一个
  **支持高亮的代码表面挂载**时调用；没有任何代码内容的页面因此构造 highlighter **0 次**。
- 预热拆成多个后台任务：先按 24 项一片把 pattern 表写进引擎 `cache` 并对每个 `RegExp` 执行
  一次（V8 的编译发生在首次 `exec`，放在这里就不在第一个代码块的渲染里），再逐个 grammar
  用一行代表文本做首次 tokenize。每个 grammar 一个任务，互不叠加。
- 分片预算按「单任务 < 50 ms」设定并实测。当前实测每个预热任务 ≤ 49 ms，预热全部完成后任意
  新代码块的首次高亮 ≤ 32 ms。

正确性不依赖预热：抢在预热任务之前渲染的代码块仍走同步路径；未就绪或失败时降级为完整、
可复制的等宽原文，绝不显示旧输入的高亮结果。

## Alternatives considered

- **只把模块级 `setTimeout` 换成 `requestIdleCallback` / 更晚的 `setTimeout`** — rejected：
  实测证明长任务位于 grammar scanner 构造，换调度器只是把同一个 100–285 ms 的任务推迟，
  不满足设计文档「不能只用 idle 调度冒充已消除阻塞」。

- **只保留 pattern 表，不做分片** — rejected：表把 translation（~145 ms）从主线程去掉，
  但单次 grammar 首次 tokenize 仍是 ~100 ms 的不可分割任务。表与分片各自解决一半。

- **上 worker 做整段 tokenize** — deferred：当前实测已能把预热压到每个任务 < 50 ms，
  不值得为该收益引入 worker 资产、CSP、Vite 静态表与安装包资源验证。若后续实测再次超过
  预算（例如 grammar 变大），worker 是下一步，而不是本轮。

- **把 pattern 表按 grammar 拆成多个 chunk，按需 import** — deferred：表在 144 KB 量级，
  一次 import 的成本远低于它省掉的翻译；拆分只有在表显著变大时才划算。

- **保留无条件预热，只把样本缩小** — rejected：无代码页面仍然构造 highlighter，与本项目标
  （无代码页面构造 0 次）直接冲突。

## Acceptance criteria

- 无代码内容的页面：highlighter 构造次数为 0（模块加载不再触发任何构造）。
- 有代码内容：原文先可见、可复制；高亮就绪后在原位替换。
- 预热期间单个主线程任务 < 50 ms（当前实测 ≤ 49 ms，表分片 24 项 + 每 grammar 一个任务）。
- 预热完成后，任意新代码块的首次高亮 < 50 ms（当前实测 ≤ 32 ms）。
- pattern 表覆盖 boot grammar：样例行重放无缺失 pattern；表中每一项都能被 `new RegExp`
  接受。
- 现有 Markdown DOM parity、streaming→settled、复制文本不含行号、懒加载 grammar 完成后
  重新高亮等用例全部保持通过。

## Risks

- **依赖升级漂移**：`@shikijs/langs` 升级后 grammar 可能请求新 pattern。表未命中时走运行时
  翻译（正确但慢），并由 pattern-table spec 在 CI 中失败提示重新生成。
- **预热的 text 与真实代码差异**：预热只覆盖代表性构造，未覆盖的规则集仍会在第一个使用它的
  代码块里构造 scanner。实测这类残留首次高亮 ≤ 32 ms，已在预算内；若将来超出，需要补样本
  或改用 worker。
- **表体积**：约 144 KB 进 client bundle。相比它移除的 ~145 ms 主线程翻译，当前判断是划算的；
  若表继续增长，应改为按 grammar 拆 chunk。
- **后台任务顺序**：预热任务彼此串行调度，避免同时抢占主线程；真实测量在空闲机器上取得，
  高负载机器上的分片耗时需要按同一口径复测。

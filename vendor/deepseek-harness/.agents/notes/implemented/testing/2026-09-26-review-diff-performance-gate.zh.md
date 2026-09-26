# Agent Note: 共享对比渲染器的 Review-diff 基准

Status: implemented

[English](2026-09-26-review-diff-performance-gate.md) | 中文

## Problem

共享的 `ReviewDiff` 渲染器（`packages/client/ui-primitives/src/ReviewDiff.tsx`）被两个业务方消费——`ui-deliverables` 的 turn 快照和 `ui-diff` 的 worktree 状态——因此没有任何一个包的 `.perf.ts` 能单独拥有它的性能契约。对比必须先挂载纯文本、约束自身工作量（单次对比 5000 行渲染上限、多文件懒展开、可取消的高亮），并让每个高亮相关的主线程任务保持在 50 ms 以下。单元级断言看不到任务调度或 Worker 的真实成本画像；这道门禁需要在正式发布组合上的测量。

## Decision

`benchmarks/review-diff/review-diff.bench.ts` 在 Vitest 的串行 bench 泳道下驱动构建好的正式发布组合 Web scaffold（由共享 scaffold 设施提供的 `apps/web/dist`）。一个 `window.shell` 初始化脚本桩向真实的 `DiffPanel` 喂入确定性的 IPC 形态 fixture（`fixtures.ts`），因此被测路径是从 `gitDiff` 到 `ReviewDiff` 的生产代码，包括真实的 shiki grammar。

工作负载是八个由评审常量合成的固定 fixture——不依赖已记录的 Session、仓库或网络服务：`single-1000`、`single-6000`（超过渲染上限）、`long-line-100k`（单行十万字符，超过逐行高亮上限）、`files-100x200`（懒展开的多文件对比，超过面板预算）、`binary`、`renamed`、`pure-add`、`pure-del`。

五个样本中的每一个都在 1440×900 参照视口下用一个带私有 scaffold 世界的全新浏览器打开。每个样本测量：冷打开的点击到可读、一次热重渲染、一次关闭再打开循环；渲染器发出的每条 `dsh.reviewDiff.slice` performance measure（每条对应一个高亮主线程任务——Worker 结果应用或内联降级分片）；携带离线程 tokenize 耗时的每条 `dsh.reviewDiff.worker` mark；对应被取消工作的 `dsh.reviewDiff.discard` mark；Chromium `longtask` 条目；挂载/折叠行数；note 种类（`binary`、`renamed`、`truncated`、`omitted`、高亮跳过）；二十次单列/双列换行模式切换；一次输入响应探测；以及在各自强制 CDP 垃圾回收之后的基线、峰值、关闭后和重开后 `JSHeapUsedSize`。

硬门禁执行评审常量 `HIGHLIGHT_TASK_BUDGET_MS = 50`——发出的每条高亮分片都必须低于它——并要求预期有高亮的场景记录到 worker 完成数，这样空 trace 不能空过。可读性、输入和模式切换预算作为候选结论上报而非断言。原始逐样本 JSON 行与逐 fixture 聚合作为 trace 落入采用方工作区的证据目录。

## Timing boundaries and memory endpoints

- 可读 = 首个 `[data-diff-line]`、`[data-diff-note]` 或文件行绘制；两次 rAF 回调证明存在渲染机会，而非硬件呈现。
- 分片 measure = 主线程上的一段同步高亮任务区间（Worker 结果应用，或一次内联降级 tick）。
- Worker mark 是离线程证据，永不计入主线程预算。
- 堆端点只在 `HeapProfiler.collectGarbage` 之后测量保留内存，因此瞬态 tokenize 垃圾不计入关闭/重开恢复。

## Calibration reference

记录于采用机器：Windows x64、Intel Core i7-11800H（16 核）、32 GB RAM、Node v26.7.0、Chromium 149.0.7827.55、视口 1440×900、设备像素比 1。观测到的 worker 侧首次 tokenize 成本为 150–270 ms（逐规则 scanner 构造），而所有实测主线程高亮任务不超过约 10 ms。50 ms 规则是设计语言常量而非机器校准；候选结论按评审预算上报中位数，不做 CI 时间缩放。

## Alternatives considered

- **从源码打一个仅用于 bench 的页面** — rejected：AGENTS 要求经共享 scaffold 驱动构建好的 Client bundle；定制的 esbuild 页面测到的是与正式组合不同的模块图。
- **驱动桌面 Electron 应用** — rejected 作为门禁：契约属于共享 Client 渲染器；scaffold 确定性地钉住组合。真实应用的采用仍是单独的验收环节。
- **主线程分片作为主路径** — 由测量否决：首次 tokenize 的逐规则 scanner 构造是一段不可分割的约 50–200 ms 调用，任何 chunk 尺寸都无法约束，因此发布路径使用内嵌源码 Worker（`markdown/highlight.worker.ts`，经 tsdown `?raw` 插件打包），并把有界同步分片只保留为无 Worker 时的降级。

## Consequences

- 本 bench 需要构建好的 `apps/web/dist` 并按样本启动真实浏览器；它跑在串行的 `test:bench` 泳道，不在单元测试套件里。
- `window.shell` 由确定性 fixture 桩接，因此门禁永不退化成易受网络或仓库状态影响的 flaky 测试；代价是 Git 传输正确性必须在别处覆盖。
- Worker 证据按场景断言：预期有高亮的 fixture 必须记录到 `dsh.reviewDiff.worker` mark，而 `binary` 与 `long-line-100k` 合法地记录为零。
- 候选结论（可读性、输入、模式切换）按评审预算上报中位数而不使运行失败；唯一被断言的计时门禁是 50 ms 高亮任务上限。

## Known exclusions

- `window.shell` 桩意味着 Git IPC 传输、仓库状态和授权不在范围内；`stage/unstage/discard` 正确性由 `ui-diff` 的 spec 覆盖，不在本 bench。
- scaffold 自身调度的长任务（session 列表、侧栏启动）出现在证据里但不是高亮工作，不参与门禁。
- 内存数字是供趋势审阅的保留堆端点；不断言绝对堆预算——从未评审过这样的预算。
- Worker 生成与 chunk 拉取落在可读性计时内而非分片预算内；ready 握手超时（10 秒）是可启动性下限，不是预算。

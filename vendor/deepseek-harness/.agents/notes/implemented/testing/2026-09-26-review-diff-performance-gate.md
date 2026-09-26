# Agent Note: Review-diff benchmark for the shared comparison renderer

Status: implemented

English | [中文](2026-09-26-review-diff-performance-gate.zh.md)

## Problem

The shared `ReviewDiff` renderer (`packages/client/ui-primitives/src/ReviewDiff.tsx`) is consumed by two business owners — `ui-deliverables` turn snapshots and `ui-diff` workspace state — so no single package's `.perf.ts` can own its performance contract. The comparison must mount plain text first, bound its work (5000 rendered lines per comparison, lazy multi-file expansion, cancellable highlighting), and keep every highlight-related main-thread task under 50 ms. A unit-level assertion cannot see task scheduling or the Worker's real cost profile; the gate needs a shipped-composition measurement.

## Decision

`benchmarks/review-diff/review-diff.bench.ts` drives the built shipped-composition Web scaffold (`apps/web/dist` served by the shared scaffold harness) under Vitest's sequential bench lane. A `window.shell` init-script stub feeds the real `DiffPanel` deterministic IPC-shaped fixtures (`fixtures.ts`), so the measured path is production code from `gitDiff` through `ReviewDiff`, including the real shiki grammar.

The workload is eight fixed fixtures synthesized from reviewed constants — no recorded Sessions, repositories, or network services: `single-1000`, `single-6000` (past the render budget), `long-line-100k` (one 100,000-character line, over the per-line highlight bound), `files-100x200` (lazy multi-file expansion past the panel budget), `binary`, `renamed`, `pure-add`, `pure-del`.

Each of five samples opens a fresh browser with a private scaffold world at the reference 1440×900 viewport. Per sample the bench measures: click-to-readable for a cold open, a warm re-render, and a close-and-reopen cycle; every `dsh.reviewDiff.slice` performance measure the renderer emits (one per highlighting main-thread task — Worker apply or inline-fallback tick); every `dsh.reviewDiff.worker` mark carrying the off-thread tokenize duration; `dsh.reviewDiff.discard` marks for cancelled work; Chromium `longtask` entries; mounted/collapsed row counts; note kinds (`binary`, `renamed`, `truncated`, `omitted`, highlight-skipped); twenty split/wrap mode switches; one input-response probe; and `JSHeapUsedSize` at baseline, peak, after close, and after reopen, each after a forced CDP garbage collection.

The hard gate enforces the reviewed constant `HIGHLIGHT_TASK_BUDGET_MS = 50` — every emitted highlighting slice must stay below it — and requires scenarios that expect highlighting to record worker completions, so a silently empty trace cannot pass vacuously. Readability, input, and mode-switch budgets are reported as candidate verdicts, not asserted. Raw per-sample JSON lines and per-fixture aggregates land as traces for the adopting workspace's evidence directory.

## Timing boundaries and memory endpoints

- Readable = the first `[data-diff-line]`, `[data-diff-note]`, or file row paints; two rAF callbacks prove a rendering opportunity, not hardware presentation.
- Slice measure = one synchronous highlighting task span on the main thread (Worker result apply, or one inline-fallback tick).
- Worker marks are off-thread evidence, never part of the main-thread budget.
- Heap endpoints measure retained memory only after `HeapProfiler.collectGarbage`, so transient tokenize garbage does not count against close/reopen recovery.

## Calibration reference

Recorded on the adoption machine: Windows x64, Intel Core i7-11800H (16 cores), 32 GB RAM, Node v26.7.0, Chromium 149.0.7827.55, viewport 1440×900 at device pixel ratio 1. Observed worker-side first-tokenize costs run 150–270 ms (per-rule scanner builds), while every measured main-thread highlight task stayed at or under ~10 ms. The 50 ms rule is a design-language constant, not a machine calibration; candidate verdicts report medians against reviewed budgets without CI time scaling.

## Alternatives considered

- **Bundling a bench-only page from source** — rejected: AGENTS requires driving built Client bundles through the shared scaffold; a bespoke esbuild page would measure a different module graph than the shipped composition.
- **Driving the desktop Electron app** — rejected for the gate: the contract belongs to the shared Client renderer; the scaffold pins the composition deterministically. Real-app adoption remains a separate acceptance pass.
- **Main-thread slicing as the primary path** — rejected by measurement: the first tokenize's per-rule scanner build is one indivisible ~50–200 ms call no chunk size bounds, so the shipped path uses the embedded-source Worker (`markdown/highlight.worker.ts`, bundled via the tsdown `?raw` plugin) and keeps bounded synchronous slicing only as the no-Worker fallback.

## Consequences

- The bench needs a built `apps/web/dist` and launches a real browser per sample; it runs in the sequential `test:bench` lane, not the unit suite.
- `window.shell` is stubbed with deterministic fixtures, so the gate can never regress into flaky network or repository state; the cost is that Git transport correctness must be covered elsewhere.
- Worker evidence is asserted per scenario: fixtures expected to highlight must record `dsh.reviewDiff.worker` marks, while `binary` and `long-line-100k` legitimately record zero.
- Candidate verdicts (readability, input, mode switching) report medians against reviewed budgets without failing the run; the only asserted timing gate is the 50 ms highlight-task bound.

## Known exclusions

- The `window.shell` stub means Git IPC transport, repository state, and authorization are out of scope; `stage/unstage/discard` correctness is covered by `ui-diff` specs, not this bench.
- Long tasks the scaffold itself schedules (session list, sidebar boot) appear in the evidence but are not highlighting work and do not gate.
- Memory numbers are retained-heap endpoints for trend review; no absolute heap budget is asserted — none was reviewed.
- Worker spawn and chunk fetch land inside readability timing, not the slice budget; the ready-handshake timeout (10 s) is a startability floor, not a budget.

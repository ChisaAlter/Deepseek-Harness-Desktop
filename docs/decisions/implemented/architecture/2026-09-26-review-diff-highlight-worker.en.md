# Decision: ReviewDiff syntax highlighting moves to an embedded-source Worker; the main thread keeps only a bounded fallback

Status: implemented

[中文](2026-09-26-review-diff-highlight-worker.md) | English

## Problem

Adoption plan D5 requires every highlight-related main-thread task to stay under 50 ms, and "the first grammar/tokenize must use a measurably <50 ms worker or interruptible slicing — do not move an unchanged synchronous long task behind a timer." Real Electron/Chromium measurement showed the shared ReviewDiff's first tokenize contains a single indivisible per-rule scanner build (one `tokenizeLine2` call of 50–200 ms; a 1-line first chunk still costs ~66 ms fixed). `tokenizeTimeLimit` is only checked between scanner iterations and cannot cover that build; warmup corpora cannot cover the rule sets arbitrary input reaches (Node probes showed each novel construct family pays 30–70 ms on first descent, unbounded). No main-thread path complies.

## Decision

Follow the established embedded-source Worker recipe from `ui-sidebar-documentpreview`:

1. `markdown/highlight-engine.ts`: worker-safe engine core extracted from `highlight.ts` (shiki engine, pattern table, warmup, `lineSpans`, `grammarRegistered`, `registerGrammarModules`) with no `LAZY_GRAMMARS` — otherwise the rolldown iife bundle would inline all 40+ lazy language modules into the worker string.
2. `markdown/highlight.worker.ts`: self-contained worker entry with a `ready` handshake and `job/done/missing/drop` protocol; one-shot `codeToTokensBase` per side, no slicing needed.
3. `markdown/highlight-jobs.ts`: main-thread client. Lazy `import('./highlight.worker.ts?raw')` → Blob URL → one shared Worker per page; run-scoped job ids keep multiple panels from invalidating each other; `drop` suppresses wasted work on cancel; on `missing` replies the main thread calls `fetchGrammarModule` (fetch registration data without registering locally) → posts it to the worker → reposts the job; worker failure falls back to the inline path wholesale.
4. `ReviewDiff.tsx`: worker-first; falls back to the existing 15 ms inline slicing when `Worker`/`createObjectURL` is unavailable or construction fails. Span application is recorded under `dsh.reviewDiff.slice` measures; worker-side duration is reported separately via `dsh.reviewDiff.worker` marks; cancellation records `dsh.reviewDiff.discard`.
5. The tsdown config adds a `?raw` interception plugin that sub-bundles the worker subgraph into single-file iife text; the dynamic import keeps the worker chunk (~607 KB / ~91 KB gzip) lazy, out of the `lib/index.js` main graph.

The markdown/ordinary-code-block path is unchanged (main-thread warmup + synchronous tokenize); this decision bounds only the ReviewDiff comparison surface.

## Alternatives considered

- **Larger warmup corpus covering all rule sets** — rejected: every uncovered construct family pays 30–70 ms on first descent; the corpus is unbounded and probes proved whack-a-mole.
- **`tokenizeTimeLimit` per-line budget** — rejected: checked only between scanner iterations; the scanner build happens atomically inside one `matchRuleOrInjections` call.
- **Enumerate grammar internals to force-compile every scanner** — impossible: rule objects register lazily on descent and cannot be enumerated.
- **Keep 15 ms inline slicing as the primary path** — rejected: slicing bounds per-tick work, but the first tokenize's atomic call already exceeds the budget (68–92 ms measured).
- **Independent component not adopted upstream** — the structure reuses the upstream `?raw`+Blob worker precedent (`excelWorker` plugin pattern); no new mechanism.

## Consequences

- 8 scenarios × 5 samples browser benchmark: main-thread highlight slice max 10.2 ms, zero violations; worker-side duration recorded separately (~200–230 ms for the 6000-line file).
- `lib/` gains a ~607 KB lazy chunk; jsdom/no-Worker environments automatically take the inline fallback, so tests need no Worker polyfill.
- Worker grammar loading rides the `missing→langs→repost` protocol; plain text always stays readable first, and highlight failure/cancellation leaves no stale result.
- Partial supersession of `docs/decisions/proposed/architecture/2026-09-21-syntax-highlight-scheduling.md`: that record's warmup/pattern-table machinery still serves the markdown path, and its deferred "worker is the next step" condition has been met and shipped for the Diff surface.
- Maintenance point: new grammars or shiki upgrades are guarded by `harness-desktop-forks` markers and bench reruns over the protocol surface.

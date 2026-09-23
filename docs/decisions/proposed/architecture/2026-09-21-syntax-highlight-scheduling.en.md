# Decision: Schedule syntax highlighting on demand and split initialization into budgeted slices

Status: proposed

[中文](2026-09-21-syntax-highlight-scheduling.md) | English

## Problem

`ui-primitives/src/markdown/highlight.ts` ran `setTimeout(() => highlighter(), 0)` unconditionally
**at module load**. Importing the Markdown renderer — which every session does — therefore built the
shiki engine and warmed the TypeScript, shell, and JSON grammars even when the current view rendered
no code block at all. The file's own comment recorded that work as a ~120–175 ms synchronous task.

Measurements taken this iteration (Node 22.23.2, in `packages/client/ui-primitives`, several runs in
separate processes) split that cost apart:

| Step | Measured |
|---|---|
| Oniguruma → JavaScript pattern translation (231 patterns) | ~135–150 ms |
| First tokenize of the three grammars (TypeScript dominates) | ~200–285 ms |
| Constructing the single largest scanner (128 patterns) | ~90–93 ms |

The real long task is therefore not "constructing the highlighter" as such: it is the **lazy
per-grammar scanner construction inside the first tokenize**. Swapping `setTimeout` for
`requestIdleCallback` only moves that same long task; it does not remove the blocking.

## Proposal

Two steps, each independently revertible.

### 1. Generate the pattern table at build time; construct `RegExp`s at runtime

`scripts/generate-highlight-pattern-table.mjs` translates the TextMate patterns the boot grammars
actually reach into JavaScript `RegExp` sources and flags, emitting
`src/markdown/highlight-pattern-table.generated.ts` (currently 322 entries, ~144 KB of source).

At runtime the table seeds the engine's `cache`: shiki's scanner reuses a hit verbatim instead of
calling the translator. A pattern the table does not carry — a lazily loaded read-card grammar, or a
pattern added by a dependency upgrade — still goes through
`defaultJavaScriptRegexConstructor`, which keeps it correct at the old cost instead of failing.

`tests/highlight-pattern-table.client.spec.ts` replays the generator's own samples through both boot
grammars and **fails** if the installed grammars request a pattern the table lacks, so an upgrade
cannot silently fall back to runtime translation.

### 2. On demand, in slices

- Remove the unconditional module-load warm-up. `warmHighlighter()` is called by
  `useViewportHighlighting` when the first **highlightable code surface mounts**, so a page with no
  code content constructs the highlighter **zero times**.
- Split the warm-up across background tasks: first write the pattern table into the engine `cache` in
  slices of 24, running each `RegExp` once (V8 compiles on first `exec`, so doing it here keeps that
  compile out of the first fence's render), then tokenize one representative line per grammar. Each
  grammar is its own task so their costs never stack.
- The slice budget is set to "one task < 50 ms" and measured. Every warm-up task currently measures
  ≤ 49 ms; once warm-up completes, any new fence's first highlight measures ≤ 32 ms.

Correctness never depends on warm-up: a fence that renders before its task runs still takes the
synchronous path, and anything not ready or failing falls back to the complete, copyable monospace
source — never highlighted output for stale input.

## Alternatives considered

- **Replace the module-level `setTimeout` with `requestIdleCallback` / a later `setTimeout`** —
  rejected: measurement shows the long task lives in per-grammar scanner construction, so changing
  the scheduler only defers the same 100–285 ms task and fails the design document's rule that idle
  scheduling must not masquerade as removed blocking.

- **Keep the pattern table but skip slicing** — rejected: the table removes the ~145 ms translation
  from the main thread, but a single grammar's first tokenize is still a ~100 ms indivisible task.
  The table and the slicing each solve half.

- **Move the whole tokenize into a worker** — deferred: measurement already brings every warm-up task
  under 50 ms, which does not justify worker assets, CSP, the Vite static module table, and packaged
  resource verification. If measurement exceeds the budget again (for example after a grammar grows),
  a worker is the next step rather than this one.

- **Split the pattern table into per-grammar chunks behind dynamic imports** — deferred: the table is
  on the order of 144 KB, and one import costs far less than the translation it removes. Splitting
  only pays if the table grows substantially.

- **Keep the unconditional warm-up but shrink the samples** — rejected: a page without code would
  still construct the highlighter, which directly contradicts this item's goal of zero constructions.

## Acceptance criteria

- A page with no code content: zero highlighter constructions (module load no longer builds one).
- With code content: the plain source is visible and copyable first, and highlighting replaces it in
  place.
- Each main-thread task during warm-up stays under 50 ms (currently ≤ 49 ms: 24-item table slices plus
  one task per grammar).
- Once warm-up completes, any new fence's first highlight stays under 50 ms (currently ≤ 32 ms).
- The pattern table covers the boot grammars: the sample replay reports no missing pattern, and every
  entry is accepted by `new RegExp`.
- Every existing case for Markdown DOM parity, streaming→settled, copy text without line numbers, and
  re-highlighting after a lazy grammar loads keeps passing.

## Risks

- **Dependency drift**: after a `@shikijs/langs` upgrade a grammar may request new patterns. A miss
  falls back to runtime translation (correct but slow) and the pattern-table spec fails in CI to ask
  for regeneration.
- **Warm-up text differs from real code**: warm-up covers representative constructs, so a rule set it
  never reaches still builds inside the first fence that uses it. Measured, that residual first
  highlight stays ≤ 32 ms, inside budget; exceeding it later means adding samples or moving to a
  worker.
- **Table size**: ~144 KB enters the client bundle. Against the ~145 ms of main-thread translation it
  removes, that is currently the right trade; if the table keeps growing it should be split per
  grammar.
- **Background task ordering**: warm-up tasks are scheduled sequentially to avoid contending for the
  main thread. Measurements were taken on an idle machine; slice duration on a loaded machine needs
  remeasuring with the same protocol.

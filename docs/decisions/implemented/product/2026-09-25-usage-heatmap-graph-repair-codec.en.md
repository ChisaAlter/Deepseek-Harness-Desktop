# Decision: Usage heatmap becomes a contribution graph; repair codec vendored

Status: implemented

[中文](2026-09-25-usage-heatmap-graph-repair-codec.md) | English

## Problem

The usage-stats month calendar was judged unusable as a whole: 24px day cells are visually heavy inside the ~520px settings page, the month picker plus start/end date inputs outweigh the graph itself, and heat levels were re-quartiled per month — the same total colors differently across months, so nothing is comparable.

The "repair session" button could not succeed on the desktop runtime: `runtimeCodec()` dynamically imported `@deepseek-ai/dsh-session` for `decodeStorageRecord`, an export removed in the vendored pin (dsh-v0.1.7-rc.2, decode moved behind the persistence format catalog). The plugin's own `^0.1.0-rc.6` spec can also resolve into the newer line, and a mixed tree lets rc.6's session package hit a `dsh-llm` that only exports `ToolCallId`, failing at link time with `CallId`. Either resolution path fails before a single row is decoded — the same pin-drift class as AGENTS §6.5: npm rc.6 faces are untrustworthy against the desktop runtime.

Live re-verification then surfaced a second failure class unrelated to byte corruption: the only failed session on this machine, `session-whale-12d39638-…`, is a v3-format artifact (`session.v3.jsonl.zstd` — all 94 zstd frames intact, seqs continuous). This build serves v3 only through its migration chain, which hard-refuses at `format v3 contains unknown event type`: the log carries `session/presentation` (written by the whale plugin) and `user-questions/asked` — both first-class in the current event vocabulary but absent from the frozen `RELEASED_V3_EVENT_TYPES`, and neither was written with `ignorable: true`. A decode-and-renumber repair preserves the v3 header verbatim, so the artifact is refused again after "repair" — a fake success.

## Decision

- The heatmap becomes a GitHub-style contribution graph: the 182-day window tiles into ~26 Monday-first week columns × 7 rows, month labels sit above their columns (an overcrowded leading label yields, matching react-activity-calendar), Mon/Wed/Fri row labels on the left; 12px rounded cells at 3px gaps, ~430px wide overall — fits the settings page.
- Heat levels use quartiles computed once over the whole window, comparable across months.
- Interaction converges on the contribution-graph idiom: hover/focus tooltip (with the cost row), click selects a day, Shift+click extends the range, "Clear selection" resets; the range still only rescopes this card's summary. Keyboard uses roving tabindex plus arrows/Home/End.
- The repair codec is vendored as `src/host/storage-rows.ts`: a faithful port of rc.6 `decodeStorageRecord` (the three `*-chunks` packed rows expand to `assistant/chunk`; every other value passes through), with no dynamic `@deepseek-ai/dsh-session` import. New guard: an unrecognised `-chunks` row tag aborts — that is a newer packing generation, and renumbering it would corrupt rather than repair.
- Repair no longer depends on host package resolution, so it works in standalone npm installs too (a missing artifact still reports gracefully).
- `rebuildSessionLog` forks on the header `version`: a v3 artifact gets an admission rewrite — each line is parsed, and `seq`+`type` event envelopes whose type is absent from `RELEASED_V3_EVENT_TYPES` (a vendored copy of the frozen set) and not already `ignorable` gain `ignorable: true`; every other line is preserved byte-identically (packed `*-chunks` rows carry `seq0` and are naturally exempt), with no renumbering (migration remaps seqs positionally, so rewriting them could break `sourceEventSeqs`/`surfaceOp` references). The pipeline then carries those rows through as `plugin:`-namespaced opaque events with payloads intact — the channel upstream designed for plugin-owned events. Versions above 4 are refused outright rather than rewritten under this build's assumptions; a missing version or 0–2/4 takes the existing decode+renumber path.

## Alternatives considered

- **Keep the month calendar, only re-skin** — rejected: the user rejected the calendar form itself, and per-month quartiles make colors incomparable regardless of palette.
- **Fixed token thresholds instead of quartiles** — rejected: user magnitudes differ by orders of magnitude; fixed bands leave light users all-blank or heavy users all-max. Whole-window quartiles adapt and stay comparable.
- **Decode via vendored `session-persistence-jsonl`** — rejected: it is pin-internal surface without a `decodeStorageRecord` export; depending on it replants the same drift pit. The storage-row grammar is immutable for existing files, so a vendored port is the right boundary.
- **Keep the month picker alongside the graph** — rejected: a fully-visible window needs no navigation; controls would again outweigh the graph.
- **Patch the vendored `RELEASED_V3_EVENT_TYPES`** — rejected: the vendored tree tracks the upstream pin, so a local patch conflicts on every upgrade; and desktop-injected event types belong on the `ignorable`/`plugin:` channel by design. The gap is that the freeze predates the desktop's writes, not that the set is wrong.
- **Decode+renumber v3 artifacts too** — rejected: migration remaps source seqs positionally, which serve only `sourceEventSeqs`/`surfaceOp` references — renumbering would misalign them; and expanded packed rows are not a row shape the historical catalog admits. The per-line admission rewrite is the smallest provably correct intervention.
- **Transcode to v4 inside repair** — rejected: the migration state machine (turn/step liveness, seed boundary, catalog facts) is harness-owned; re-implementing it forks the format semantics. The admission rewrite lets the harness's own pipeline upgrade the log, at its existing write-open moment.

## Consequences

Nine month-picker/date-input locale keys are removed; `heat.window`/`heat.range`/`heat.clear`/`heat.hint` are added. Range filtering survives as click + Shift-click only — no native date inputs — an accepted trade for a readable graph.

The repair path is fully decoupled from harness package surfaces, so pin upgrades cannot break it again; the cost is that a future `-chunks` packing generation must be ported into the vendored decoder (which fails loudly instead of silently corrupting).

The v3 admission rewrite widens what "read failure" repair covers: byte-level corruption was the only recoverable class before; now artifacts refused by the migration vocabulary are rescued too. The vendored `RELEASED_V3_EVENT_TYPES` copy needs keeping in sync — but a "released" set is frozen by definition. Events marked `ignorable` survive migration as `plugin:*` opaque entries: the whale session's presentation metadata loses its first-class type in the v4 view (acceptable — the alternative is an unreadable session), payload preserved. A v5+ artifact is refused explicitly instead of being rewritten under v4 assumptions.

## Verification

`storage-rows.test.ts` locks the three packed-row expansions, malformed-row throws, and the unknown-tag abort; `usage.test.ts` locks week-column grouping and the label collision rule; `session-repair.test.ts` locks the v3 admission rewrite (unknown types gain `ignorable`, released types and packed rows stay byte-identical, seqs untouched) and the v>4 refusal. All 37 real session artifacts under the local dsh-home rebuilt through the vendored decoder: 3227 events, 0 errors. The real failed artifact `session-whale-12d39638-…` was verified end to end: `persistence.open('read')` threw `format v3 contains unknown event type` before repair and returned all 192 events after `repairSessionLog` ran on a copy. Panel typecheck / test 187 / build / check-pack all green.

Supersedes (partially): [Compact usage calendar and repair session identity](2026-09-23-usage-calendar-repair.en.md) — the calendar half only; the repair-identity contract still stands.

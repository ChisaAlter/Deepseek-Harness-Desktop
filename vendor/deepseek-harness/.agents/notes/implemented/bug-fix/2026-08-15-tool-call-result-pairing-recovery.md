# Agent Note: Tool-call result pairing recovery

Status: implemented

English | [中文](2026-08-15-tool-call-result-pairing-recovery.zh.md)

## Problem

A tool scheduler failure could leave a session log where an `assistant/message` declared tool calls that never received matching `tool/result` events, and that transcript was then replayed verbatim into every later request. OpenAI-compatible providers reject such history (`assistant message with tool_calls must be followed by tool messages responding to each tool_call_id`), so the session was bricked: every subsequent send failed the same way and repair logic never fixed it because the turn had already closed.

Two independent causes fed the failure:

1. **Scheduler identity could break.** The tool runtime's internal scheduler view is addressed by a module-scoped `unique symbol`. A process that accidentally loaded two copies of `@deepseek-ai/dsh-tools` (a duplicated install, a stale profile fallback link, or a mixed packaged runtime) evaluated two distinct symbols, so the consumer's `ctx.tools[TOOL_RUNTIME_SCHEDULER]` read `undefined` and `prepare` crashed with a bare `TypeError: Cannot read properties of undefined (reading 'prepare')`.

2. **The failure path did not close the transcript.** `executeToolCalls` deliberately drained started dispatches and rethrew the first error without recording results, so a failed step's assistant tool calls were left dangling. `interruptedTurnClosers` only repairs an *open* tail turn; a closed error turn was skipped, and `deriveMessages` projected the unbalanced history as-is.

## Decision

### Runtime pairing invariant (agent-loop)

`executeToolCalls` now treats "every assistant tool call has exactly one in-order result" as an invariant that holds even when the scheduler fails:

- A terminal scheduler failure drains started dispatches, then completes every started call in model order — committing settled results (a throwing `finalize`/`finish` is treated as outcome-unknown and its stage is never re-run) and recording a synthetic `TOOL_OUTCOME_UNKNOWN` result for started calls without one.
- Calls that never began receive a synthetic `TOOL_NOT_STARTED` call/result pair.
- The original first failure still ends the turn as `turn/end { reason: { kind: 'error' } }`; completion is best-effort and a secondary failure only logs.
- The scheduler is resolved once per group through `requireToolRuntimeScheduler`, which fails loud with a deployable diagnosis (stale `$DSH_HOME/profiles/<name>/node_modules` copies, mixed packaged runtime) instead of a bare `TypeError`.

### Stable scheduler identity (tools)

`TOOL_RUNTIME_SCHEDULER` is now `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`, so two module copies in one realm share the same key. The `unique symbol` type and the generated Cordis API surface are unchanged.

### Transcript canonicalization (session)

`Session.deriveMessages()` canonicalizes the projected history through `normalizeToolTranscript` before any consumer sees it: missing results are synthesized as deterministic error tool messages (outcome-unknown when a durable `tool/call` start exists, not-started otherwise), misplaced results are re-emitted in block order, and duplicate or orphan tool results are suppressed. The append-only log is never rewritten. `agent.ts` then runs `assertToolTranscriptValid` on the request payload as a provider-validity gate.

This recovers legacy logs of the reported shape without touching durable data: a corrupted turn that already has later user messages yields a valid transcript on the next request.

### Client display

The conversation projection already settles a running tool card at a closed turn/step boundary by rendering it as an interrupted error card; a regression test now pins that behavior for a turn closed in `error`.

## Alternatives considered

**Insert synthetic results into the closed turn in the durable log.** Append-only logs cannot be edited mid-stream; tail appends would interleave results after later messages and violate event order for providers and the surface fold.

**Rewrite and renumber the whole log.** Touches seq contiguity, revisions, `sourceEventSeqs`, forks, and both persistence backends for a problem that is purely about the derived projection.

**Silently drop dangling assistant tool calls in the serializer.** Loses history the model should reason about (the tool may have run) and hides the damage from diagnostics.

**Retry the throwing scheduler stage.** A tool may already have produced side effects; re-running `finalize`/`finish` could duplicate them.

## Consequences

- New failures never produce orphan tool calls; the turn still ends in error with the original failure surfaced.
- Legacy corrupted sessions recover on the next request with deterministic synthetic results; providers never receive a known-invalid payload.
- Duplicate module copies of dsh-tools no longer break the scheduler lookup, and a missing scheduler is diagnosed instead of crashing with a `TypeError`.
- The append-only log, session format version, event vocabulary, and both persistence backends are unchanged.

## Verification

- Unit/integration: `tool-calls.spec.ts` (30 tests) covers scheduler-missing, prepare/finalize/dispatch failures, mixed real+synthetic completion, later-group failure/abort, and a followup whose next request passes `assertToolTranscriptValid`; `tool-transcript.spec.ts` (14 tests) covers the exact corrupted-log shape (assistant tool calls with no results, closed error turn, later user messages) through `deriveMessages`; the interrupted tool card is pinned in `conversation-node-definitions.client.spec.ts`.
- Type gates: host and client `tsc -b` pass; per-file coverage thresholds pass for the changed files.
- Shell: root `npm test` is green (69/69) after installing the Electron package and its binary.
- Packaging: `npm run pack` succeeds; the shipped runtime archive contains the fix (scheduler guard, outcome-unknown synthesis, canonicalizer, `Symbol.for` key). A script imported the packaged `dsh-session`/`dsh-llm` bundles and verified the corrupted shape derives a provider-valid transcript.
- In-app end-to-end: the packaged desktop app was launched with a corrupted fixture session in the active workspace; sending a message through the app composer (provider: opencode-go / DeepSeek V4 Flash) completed normally. The model observed the synthetic results ("returned 'No result provided' — odd. Let me retry"), continued the agent loop with real tool executions, and produced a full reply — no `INVALID_REQUEST`, no failure.

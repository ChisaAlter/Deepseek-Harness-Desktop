# Feature: Harness tool-call integrity

| Field | Value |
| --- | --- |
| **id** | `dsh-tools` |
| **status** | `active` |
| **last verified** | 2026-08-27 (post-merge closeout re-verification) — merged to `main` via PR #54 (`cac4f790`); on the merged tree vendor `test:gui` is green (412 files / 5409 pass / 1 skip) and desktop `npm test` is 1219 pass / 0 fail; the upstream handoff doc now extracts the diff from the merge commit (source branch deleted). Earlier same day — host TypeScript compilation, 454 focused Harness tests (llm, adapters, agent-loop, session, tools, sqlite persistence), per-file 100% coverage on every changed Harness source file, keyless snapshot suite delta-neutral vs main, and 1,118 desktop tests |；本次 alpha.4：未复活 persistence-sqlite；正式构建与 keyless smoke 通过。

## User paths

1. A provider streams a tool call; Harness validates its call id and function name before persisting or executing it.
2. A malformed provider response enters the normal model-request recovery path without adding an assistant tool call to session history.
3. Opening an older poisoned session projects a provider-valid transcript so the next prompt can continue.

## Invariants

- Tool-call ids are non-empty and names match `[A-Za-z0-9_-]{1,64}` before a call becomes durable or executable.
- Malformed model tool calls use the retry-eligible `MALFORMED_RESPONSE` failure code.
- Transcript repair changes only the derived provider history; the append-only session log remains untouched.
- Tool registration enforces the same function-name grammar as streamed calls.

## Allowed touch

- `vendor/deepseek-harness/packages/llm/` — shared validation, adapters, retry policy, and tests.
- `vendor/deepseek-harness/packages/core/agent-loop/` — pre-persistence request-failure guard and tests.
- `vendor/deepseek-harness/packages/core/session/` — poisoned-transcript projection repair and tests.
- `vendor/deepseek-harness/packages/session/session-persistence-sqlite/src/codec.ts` — exact optional-field reconstruction for persisted tool-call chunks.
- `vendor/deepseek-harness/examples/acp-agent/tests/snapshots/empty-response-retry/session.jsonl` — keyless snapshot fixture recording the default retryable-code set.
- `vendor/deepseek-harness/packages/core/tools/` — registration validation and tests.
- `vendor/deepseek-harness/packages/extensions/tool-cordis/src/api-catalog.ts` — generated public type catalog.
- `vendor/deepseek-harness/.agents/notes/` — Harness decision record.
- `docs/features/dsh-tools.md` and `docs/features/README.md` — desktop feature-spine contract.
- `.cursor/rules/dsh-tools-product.mdc` — short always-on invariants.

## Do not touch

- Electron desktop-shell startup, windows, settings, or IPC.
- Tool argument parsing, execution policy, or provider configuration beyond retry eligibility.

## Gates

| Kind | What |
| --- | --- |
| Automated | Focused Vitest suites for llm, adapters, agent-loop, session, tools, and sqlite persistence; per-file 100% coverage on changed Harness sources; keyless snapshot replay delta-neutral vs main; changed-package typecheck/lint |
| Manual / QA | Real-machine checklist (needs `DEEPSEEK_API_KEY`): 1) open a pre-fix session whose log contains an empty-name tool call and send a prompt — reply arrives with no `unknown tool ""`; 2) run a normal tool-using turn — calls execute and persist as before; 3) real-API e2e (`pnpm run test:e2e`) for provider adapters |

## Sources

- Root cause: provider adapters previously defaulted absent tool-call ids and names to empty strings.
- Agent Note: `vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-27-malformed-tool-call-recovery.md`
- Implementation entry: `vendor/deepseek-harness/packages/llm/llm/src/assembler.ts`
- Upstream handoff: [docs/superpowers/plans/2026-08-27-dsh-tools-upstream-handoff.md](../superpowers/plans/2026-08-27-dsh-tools-upstream-handoff.md)

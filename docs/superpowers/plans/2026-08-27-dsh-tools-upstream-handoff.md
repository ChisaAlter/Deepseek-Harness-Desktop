# dsh-tools upstream handoff checklist

**Goal:** Submit the tool-call integrity fix (desktop PR #54, feature card [dsh-tools](../../features/dsh-tools.md)) to the official `deepseek-ai/deepseek-harness` repository. This document exists because the desktop CI environment has no write access to the upstream repository; a maintainer with access executes the checklist.

**Do not** update `vendor/harness-upstream.json` until upstream has merged and tagged a release containing the fix; the pin records the integrated official baseline, never a pending PR.

## What the patch contains

All changes live under `vendor/deepseek-harness/` and are now **merged into `main`** via PR #54 (merge commit `cac4f790`; the fix itself is `f8c1deb7`, and the original head branch `cursor/fix-unknown-tool-empty-name-8eab` has been deleted). They apply cleanly to the upstream tree because the touched packages carry no desktop-fork edits:

- `packages/llm/llm/` — `requireValidToolCallIdentity` / `isValidToolCallIdentity` (`content.ts`), assembler rejection of nameless or id-less tool calls, `MALFORMED_RESPONSE` failure code added to the default retryable set (`retry-policy.ts`, `error.ts`), optional `id`/`name` on `tool-call-delta` (`types.ts`).
- `packages/llm/llm-deepseek/` + `packages/llm/llm-pi-ai/` — adapters stop defaulting absent tool-call ids/names to empty strings.
- `packages/core/agent-loop/` — pre-persistence guard: malformed model tool calls enter the `agent/request-error` recovery waterfall instead of durable history.
- `packages/core/session/` — `normalizeToolTranscript` repairs poisoned projections (derived history only; append-only log untouched).
- `packages/core/tools/` — registration enforces the `[A-Za-z0-9_-]{1,64}` function-name grammar.
- `packages/session/session-persistence-sqlite/src/codec.ts` — packed tool-call rows keep a required id (typed `NonNullable`), optional `name` reconstructed exactly.
- `packages/extensions/tool-cordis/src/api-catalog.ts` — regenerated public type catalog.
- `examples/acp-agent/tests/snapshots/empty-response-retry/session.jsonl` — keyless snapshot records `MALFORMED_RESPONSE` in the default retryable-code `policyKey`.
- `.agents/notes/implemented/bug-fix/2026-08-27-malformed-tool-call-recovery.md` (+ `.zh.md` / `.i18n.yaml`) — Agent Note required by upstream policy.
- Bilingual README updates in the touched packages.

## Submission checklist

- [ ] Extract the `vendor/deepseek-harness/` diff onto a fresh branch of `deepseek-ai/deepseek-harness` (the source branch is deleted; diff the merge commit instead, e.g. `git diff cac4f790^1...cac4f790 -- vendor/deepseek-harness/ | git apply -p3 --directory=.` from the upstream checkout, or cherry-pick `f8c1deb7` with path rewrite).
- [ ] Run upstream gates on Node ^22.19 || >=24: `pnpm run test`, `pnpm run test:coverage` (per-file 100% on changed sources — verified locally 2026-08-27), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run test:snapshot`, `pnpm run doc-sync`.
- [ ] Run real-API gates with `DEEPSEEK_API_KEY`: `pnpm run test:e2e` (blocked in the desktop CI environment — no key).
- [ ] Open the upstream PR with one `kind/bug` label, `area/*` labels for llm / agent-loop / session / tools / session-persistence, and link the Agent Note.
- [ ] After upstream merge + release tag: update `vendor/harness-upstream.json` via `npm run sync:harness` per [2026-08-18-harness-rc7-vendor-pin.md](2026-08-18-harness-rc7-vendor-pin.md), then drop the now-redundant local fork edits if the release supersedes them.

## Known snapshot baseline caveat

The vendored tree fails 7 keyless snapshot tests on `main` that are unrelated to this fix (agent-instructions text, `read_image` vision-fallback description, escalation-approved, goal wrap-up, headless task, image-offload pin). This branch is snapshot-delta-neutral: it fails exactly the same 7. Re-record or reconcile those baselines upstream separately.

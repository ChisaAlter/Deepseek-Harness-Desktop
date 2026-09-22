# Post-merge test debt (dsh 0.1.1-rc.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks 1–4 of this wave are independent and run in parallel. Do not commit from subagents (shared index + unrelated dirty files). Controller commits after green evidence.

**Goal:** Clear remaining post-merge test debt so production-acceptance lanes are green or evidence-backed waived. Do not change product behavior except Phase B6, which needs Trent confirmation.

**Already on `main` (do not redo):** B1–B5 and B7 spec forks (`af18e7a81b`…`25e0403e2e`); settings/models/apply-desktop web e2e forks; hmr-live zh-hero + timeout (`7f31d08d82`); jsonrpc SDK snapshot Windows path skip (`a867782c48`).

**This wave:** verify those specs still pass; rerun web replay (exclude 2 serial files); rerun assembled snapshots; diagnose B6 without changing the product gate.

**Architecture:** Desktop fork vs upstream: motion/async specs already absorb timing. Remaining reds are replay goldens, boot/HMR, assembled snapshots, or the `assertToolTranscriptValid` dispatch gate.

**Tech stack:** vendor vitest (jsdom unit, Playwright web, snapshot subprocess). Cwd: `vendor/deepseek-harness`.

## Global constraints

- Touching: none — local test-debt, no Feature Spine card. Do not change product contracts.
- Do not edit mobile-remote / composer-QA / `RemoteSection` / `src/main/remote.js` (unrelated dirty tree).
- Do not change `assertToolTranscriptValid` in `packages/core/agent-loop/src/agent.ts` (B6 product).
- Navigation geometry: absorb the assertion, do not change four-column layout.
- Do not `git commit` or `git push`. Write a report file instead.
- Do not run `hmr-live.e2e.ts` in the same wave as the web replay pool (Playwright + `dsh web` spawn collide).

---

### Task 1: Phase A web replay classify (and fix remaining clusters)

**Files:** `apps/web/tests/**/*.e2e.ts` except `hmr-live.e2e.ts` and `cordis-tool-round.e2e.ts`. Goldens under `apps/web/tests/`. Layout assertions in `navigation-panes.e2e.ts`.

**Steps:**

- [x] Confirm `apps/web/dist` exists. Do **not** run a full `pnpm run build` unless the suite fails because dist is missing.
- [x] From `vendor/deepseek-harness`, with `DSH_SNAPSHOT=replay`:

```powershell
$env:DSH_SNAPSHOT = 'replay'
pnpm exec vitest run --config vitest.web.config.ts `
  --exclude=apps/web/tests/hmr-live.e2e.ts `
  --exclude=apps/web/tests/cordis-tool-round.e2e.ts `
  --fileParallelism --maxWorkers=3
```

- [x] Tee full output to `.superpowers/sdd/2026-08-22-post-merge-test-debt/phase-a-replay.log` (repo root).
- [x] Cluster remaining failures: (a) navigation geometry, (b) banner goldens, (c) `[data-sample="bash"] [data-terminal]` visibility vs pwsh. Other clusters: name them.
- [x] Fix by absorbing fork assertions / goldens. Do not change layout. Unfixable → evidence in the report, do not waive in code without controller OK. Remaining reds: `built-boot.snapshot.ts`, `approval-composer.e2e.ts`.

**Done when:** replay pool finished; remaining reds listed with cluster + file + assertion; fixes applied for clusters that are clearly fork-assertion drift; report written.

---

### Task 2: Phase B package verification (B1–B5, B7)

**Files (read; edit only if a spec is still red):**

- `packages/client/ui-workflow-run/tests/workflow-run.client.spec.tsx`
- `packages/client/ui-conversation/tests/input-bar.client.spec.tsx`
- `packages/client/ui-theme/tests/apply.client.spec.ts`
- `packages/client/connection/tests/connection.client.spec.ts`
- `packages/client/runtime/tests/wire-events.client.spec.ts`
- `packages/session/session-persistence-sqlite/tests/sqlite.spec.ts`

**Steps:**

- [x] Run each file with `pnpm exec vitest run <file>` from `vendor/deepseek-harness`.
- [ ] If green, do not edit. If red, adapt the spec the same way as the existing `// Desktop fork:` comments (await/poll/motion node / 500ms sqlite budget). Do not change production code unless a test proves a real bug — then stop and report.

**Done when:** all six files exit 0, or remaining reds have a precise cause in the report.

---

### Task 3: Phase D assembled snapshot replay

**Files:** `examples/headless-agent/tests/*.snapshot.ts`, `examples/jsonrpc-agent/tests/sdk.snapshot.ts`, `examples/acp-agent/tests/*.snapshot.ts`. Do not edit `packages/core/agent-loop/src/agent.ts`.

**Steps:**

- [x] From `vendor/deepseek-harness`, `DSH_SNAPSHOT=replay` (default), cap load: `$env:DSH_SNAPSHOT_MAX_CONCURRENCY='2'`.
- [x] Run `pnpm exec vitest run --config vitest.snapshot.config.ts examples/jsonrpc-agent/tests/sdk.snapshot.ts examples/headless-agent/tests examples/acp-agent/tests`.
- [x] Extract failure names; capture stderr tails for `TransportClosedError`.
- [x] Spec/fixture-only fixes that match `a867782c48` (Windows path escape, skip POSIX-only). Boot hangs / chokidar / overlay bisect: record evidence, do not disable plugins as a silent skip.
- [x] If a failure is the 1→0 request cut from `assertToolTranscriptValid`, **do not fix** — mark BLOCKED-for-B6 and paste the stderr. (None this run.)

**Done when:** those snapshot files are green, or each red has a named cause and a recommended next step (waiver vs B6).

---

### Task 4: Phase B6 diagnosis only (sdk/server)

**Files:** `packages/sdk/server/tests/` (read). Production `assertToolTranscriptValid` is off-limits.

**Steps:**

- [x] `pnpm exec vitest run packages/sdk/server/tests` from `vendor/deepseek-harness`.
- [x] If red, temporarily comment `assertToolTranscriptValid(requestMessages)` in a **local uncommitted** experiment only long enough to see whether request count goes 0→1, then **revert the production file before reporting**.
- [x] Report: pass/fail, whether the gate is the cut, recommended absorb-vs-keep. Do not leave the experiment in the tree. Flake (`vi.waitFor` 1s); **keep** the product gate.

**Done when:** sdk/server tests have a result; production file is unchanged vs HEAD; recommendation written.

---

## Later (not this wave)

- Phase C: run `hmr-live.e2e.ts` after Task 1 releases Playwright; dump console + `[data-dsh-boot]`.
- Phase E: desktop `npm test`, vendor full unit, official `test:web:ci`, snapshot, CLI e2e; Feature Spine `last verified`; no push without Trent.

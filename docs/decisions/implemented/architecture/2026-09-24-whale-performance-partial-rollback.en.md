# Decision: Partial rollback and release blocking for whale performance changes

Status: implemented

[中文](2026-09-24-whale-performance-partial-rollback.md) | English

## Problem

The performance changes lacked comparable before/after measurements and complete visual, multi-display, and automatic fallback startup checks, but introduced an unattended 60 fps cap, a 200 ms sleep inference interval, and deferred Anime4K loading. Packaging repair also allowed one source dependency to become multiple module instances when the root version conflicted. Matching files and versions cannot prove equivalent module-level shared state. The user stopped development, requested another review, and authorized the recommended partial rollback.

Record audit: the [original optimization decision](2026-09-24-whale-runtime-footprint.en.md) partially overlaps this decision. This record supersedes its rendering schedule, Anime4K loading order, and dependency identity exemption; its reasons for persistence, resource deduplication, and request coordination still apply. Existing live-first engine, settings, and interaction decisions are not superseded by this rollback.

## Decision

- Restore the original painting relationship between `tickStill`, inference completion, and rAF. Remove the unattended 60 fps cap and the 200 ms sleep interval. Inference retains 50 ms, or 110 ms only with user-enabled power saving after five idle minutes. Keep default-off performance counters and the fix preventing ordinary growth snapshots from waking the pet; update the measurement script to read the restored pacing.
- Restore the static Anime4K script in HTML and remove the runtime loading helper and await. Retain the original engine, model, super-resolution, and offline fallback paths.
- Fail the build for every split of a shared source dependency; conflicting root versions or peer contexts grant no exemption. Keep checks against merging different source instances, runtime file and dependency graph checks, test-only package exclusion, and the real CLI gates. Freeze the remaining workspace dependency layout changes without further development; the known identity splits remain a release blocker.
- Keep unchanged-state write suppression, save retry, shutdown flush, identical shell deduplication, and unreachable resource filters. Minute active-time checkpoints can lose about one minute of statistics on abnormal exit. Keep separate history and catalog request coordination; minute catalog refreshes and full history-tail requests are partial implementation, not completion of the original ten-minute catalog or incremental-history goals.

## Alternatives considered

- **Revert every change from this task** — Restores more original paths, but also removes independently supported persistence and retry fixes. The original packaging flow already allowed old dependencies to win, so a complete rollback does not establish release readiness. The mixed working tree also requires changes to be handled by specific hunks.
- **Continue repairing dependency layout and retain the rendering experiment** — Could eventually achieve the performance goals, but requires new implementation and unfinished acceptance work beyond this rollback scope.
- **Retain the dependency split exemption** — Allows packaging to continue, but cannot guarantee module-level shared state and defeats the identity check, so it is withdrawn.

## Consequences

Rollback restores the previous display pacing and its higher painting cost. No net CPU, GPU, or memory benefit is claimed. About 13.85 MiB of excluded raw resources is not an installer size reduction. A three-consumer counterexample with a conflicting root version must fail; the positive case with a shareable root must still share one object.

Verification for this rollback covers focused tests, the full suite, documentation governance, and source restart; no installer is rebuilt. The user interrupted the final7 build, and existing dist artifacts are not deliverables. Three repeated comparable performance runs, a thirty-minute write observation, four automatic cold-start fallback paths, and complete multi-display visual checks remain unfinished. Retaining code does not mean those optimizations passed release acceptance.

## Verification

Before the change, the rollback counterexample failed with Missing expected rejection. After withdrawing the exemption, focused tests passed 116/116; the full suite had 2294 passes, 2 skips, and no failures. Governance passed 6/6 and document synchronization 8/8, recorded in `.omc/whale-rollback-{focused,full,governance,doc-sync}.log`.

Source startup succeeded with WebGPU and Anime4K ready, the static script present, and the dynamic loader and frame cap removed. With power saving disabled, five-second awake and sleep checks both used the 50 ms inference start interval. Display refresh was about 163–164 per second and Canvas paints about 287–346 per second, confirming restoration of the previous schedule. This short sample verifies rollback only, not performance benefits or complete visual acceptance. See `.omc/whale-rollback-live.png` and `.omc/whale-rollback-runtime-qa.json`. Verification restored the user's original `enabled=false` and disabled performance sampling.

ChatGPT's independent read-only review returned APPROVED, finding no evidence of an incomplete rollback or accidental removal of retained fixes. Approval covers only this partial rollback; it does not complete performance acceptance or remove release blockers. [Review task](https://chatgpt.com/c/6ab12b4a-e908-83ea-9390-6c0e515bf9b3).

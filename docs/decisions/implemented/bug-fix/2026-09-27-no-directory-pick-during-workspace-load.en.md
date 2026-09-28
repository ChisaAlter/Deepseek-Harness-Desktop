# Decision: Picking the no-directory target while the Workspace list loads

Status: implemented

[中文](2026-09-27-no-directory-pick-during-workspace-load.md) | English

## Problem

After the desktop app starts, the empty-session Hero chip menu can open while the Workspace list still reads "正在加载工作区…", and "无工作目录" is in it. Picking it closes the menu, reverts the chip to "选择工作区", and leaves the composer inert: the click reads as doing nothing.

Live diagnosis found two layers stacked, and each needed its own fix:

1. **Environment (the fatal layer in this run)**: `$DSH_HOME/sessions/_no-cwd/preset-keep/session.v3.jsonl` is plaintext JSONL while the session backend is configured for `zstd`; `WorkspaceRegistry` throws `uses .jsonl, but this backend is configured for compression "zstd"` while scanning headers at startup, the whole `workspace` plugin fails to mount, and the `workspaceController` service is unavailable. The list therefore never leaves "正在加载工作区…" and `workspace/follow` answers `gateway/service-unavailable` — no Workspace target could work. That file is an externally written placeholder session (`id: session-placeholder`, cwd pointing at the repo), not one the product created.
2. **Client (the product defect this record fixes)**: `scratchCwd` (the Host's `$DSH_HOME/no-workspace`) exists on `WorkspaceSnapshot` only after the first Workspace follow baseline, and `connectNoDirectory()` read it directly, throwing `the Workspace baseline has not arrived yet` when absent. The Hero caller cleared its pending flag without surfacing an error, so the failure collapsed into "nothing happened" — including the case above, where the Host never came up at all.

Leaving the entry enabled during the loading state is deliberate: it is a legitimate target while the list loads; the pick only needs to queue behind the baseline instead of failing. Desktop shell reconnect/rebuild widens the window — the Hero renders before the baseline arrives.

## Decision

`connectNoDirectory()` gains `connectScratchCwd()`: return `scratchCwd` immediately when present; while `phase` is `pending`, subscribe to the Workspace list and continue candidate reuse or `session.create({ cwd })` after the first baseline; abort with the `lifetime` signal when the owner is disposed; fail with an explicit error when `phase === 'ready'` or `state === 'error'` still carries no `scratchCwd`, never waiting forever.

The snapshot is re-read after subscribing so a baseline landing around subscription time cannot be missed, and the subscription is removed on resolve, reject, and abort.

`openNoDirectory()` now matches `openWorkspace()`: a refused creation surfaces through `createFailed` instead of only reverting the chip; requests superseded by later navigation or disposal stay silent.

A Host outage itself is outside the client's reach: when `workspaceController` is absent the picker stops pretending to work and surfaces the failure. The leftover file in the observed environment was quarantined rather than deleted — moved under `%APPDATA%/Deepseek-Harness-Desktop/quarantine/sessions/` to keep the evidence — and the Host mounted normally again.

## Alternatives considered

- **Disable the "无工作目录" entry while loading**: avoids the failing click but hides a legitimate entry during startup — still "not available to me" with no explanation; waiting for the baseline honors the menu's existing selectable semantics.
- **Wait in the UI, polling `scratchCwd` per click**: duplicates the same race into every caller (Hero menu, sidebar group `+`) and is a worse implementation of one subscription.
- **Keep throwing and only add a visible notice**: the user at least learns why, but the click still does not work; the startup window is fixable rather than reportable.
- **Fall back to `session.create`'s default cwd**: it would land no-directory sessions in `process.cwd()`, which can equal a real Workspace path and be absorbed by membership projection — it violates the core no-directory invariant.
- **Let the session backend ignore mismatched encodings**: it would rescue this environment, but silences a real corruption where one root carries two encodings and makes users think sessions vanished; the fail-loud scan is deliberate, and the fix belongs at the source that wrote the file, not in relaxed reads.
- **Delete the leftover `preset-keep` placeholder session**: it would recover too, but destroys the diagnostic evidence irreversibly; quarantining restores startup and keeps the scene.

## Consequences

- Picking "无工作目录" while the list still loads opens a blank session once the baseline lands: the chip reads "无工作目录" and the composer unlocks instead of the click appearing dead.
- The wait is bounded: a baseline that settles ready without `scratchCwd` ends in a readable error with a notice rather than hanging; disposal aborts immediately.
- An absent Host service (as in this run's encoding conflict) now surfaces as a visible "New session failed" instead of blending into "the click does nothing"; the notice was observed changing with the Host failure reason.
- The leftover file from the observed environment sits under `quarantine/sessions/`; after restarting `dsh web` no `4 entries did not activate` line appears and `workspaceController` is back.
- Regression: three cases added to `packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` — queue-then-succeed while loading, visible failure on a ready baseline without cwd, and release on disposal; 66 focused cases and the card's four-package gate of 1331 pass.
- The desktop fork marker gains `connectScratchCwd` so an upstream sync cannot silently restore the throwing version.
- Related record: [No-directory task sessions](../../../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-no-directory-task-sessions.md).

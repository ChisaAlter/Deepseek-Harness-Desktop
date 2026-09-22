# Decision: adjudicate dsh-v0.1.6-alpha.1 merge drift as "upstream contract first, desktop features preserved"

Status: implemented

[中文](2026-09-17-vendor-alpha1-merge-drift-remediation.md) | English

## Problem

The vendor GUI suite failed in 16 places after the alpha.1 merge — these specs had never run on CI since the merge, and the failures mixed three kinds: upstream contracts our tree lagged behind, deliberate desktop features breaking assertions written for the old contract, and genuine code defects. Deciding each case ad hoc would conflate real regressions with upstream evolution, so a single adjudication rule was needed.

## Decision

Every failure is adjudicated as "upstream contract first, desktop features preserved": follow upstream where its contract moved, keep deliberate desktop behavior and move the spec to an equivalent assertion, and fix genuine defects as defects.

- The `dsh.workspace.view` persistence key returns to upstream `v5` (dropping the desktop-leftover `v6`, accepting a one-time view-preference reset); `WorkspaceBrowser` manual ordering goes back to upstream's summary-aware `reconcileManualOrder(…, list.byId)`, restoring arrival-order and late-blank semantics.
- The settings connection copy returns to upstream (`连接异常，刷新重试` / `重新连接中`) — the package README.zh already documents that copy; the local strings were rc.1 merge leftovers, not deliberate customization.
- Deliberate desktop features keep their implementation: the FlipText flipping label (specs now assert the accessible text with `aria-hidden` parts stripped, equivalent to the old assertion), the composer pick holding until the projection lands (specs now simulate the confirming frame before asserting enabled), managed-presentation sessions, hidden `dshbot-room`, and the `custom-instructions` settings row; upstream's `+` launcher folded the old `指令` and `添加附件` chips into one control, so the affected assertions move to the current label `添加文件或调用指令`.
- Genuine defect fixes: `ConversationContent`'s eagerly built `heroWorkspaceRow` fired the `conversation.hero.workspace` slot unconditionally (JSX child expressions evaluate at construction time), and a presentation-owned session must never instantiate the workspace picker — the row is now gated by `hero` at construction; `TerminalCleanup .stack` gains `-webkit-app-region: no-drag` (a fixed interactive-layer rule gap); the pdf-license spec untars with a relative filename on Windows (bsdtar reads a `C:` prefix as a remote host).

The core contract suite then exposed a second wave of the same merge drift, adjudicated by the same rule:

- The unknown-id rejection in `unarchiveSession` is a deliberate desktop contract (the `WorkspaceUnknownSessionError` `operation` parameter and its spec were introduced together; upstream rc.1/rc.2 had no such API). Upstream alpha.1 wrote a same-named API with idempotent no-op semantics, and the merge took that implementation wholesale, swallowing the rejection and leaving a self-contradictory spec (`never-archived` must resolve while `ghost` must reject). The desktop contract is kept: an unarchived id naming nothing rejects without writing again, and the upstream-carried idempotent case now asserts on a known unarchived id. The archived-delete and ghost-pruning paths only unarchive ids already in the archive set and are unaffected.
- The merge broke the durable-question resume handoff in `agent.ts`: alpha.1 wrapped `setupAndPublish` in `runMaintenance`, but the desktop `resumePendingInteraction` still claimed the running phase inside the maintenance window per its old assumption, and `runMaintenance`'s unconditional idle reset in `finally` would clobber the freshly installed phase. The fix lets `resumePendingInteraction` accept the maintenance phase and take over phase ownership — the maintenance window only resets to idle and replays latched wakes while it still owns the phase; the resumed driver's own drain loop takes over the inbox so no wake is lost.
- The `delete-archived.host.spec` fixture was stale: alpha.1 made `agents.register()` an async-generator effect whose `enter` lands on a microtask; the desktop fixture registered synchronously then read `agents.get`, which was necessarily empty. Registration is now awaited, matching every other spec in the package.
- The `malformed-tool-call-retry` expected oracles were stale: alpha.1 made `tool-ralph` opt-in (disabled by default in dsh-base), but this desktop scenario's `tool-schemas.expected.json` and `system-prompt.expected.md` were recorded when it was enabled by default; the `ralph-loop` scenario owns its own composition and already re-enables the tool with an explicit `disabled: false`. The expectations were regenerated with `DSH_SNAPSHOT=refresh` (the authored session JSONL never contained ralph and is untouched).
- `cordis-client-runner`'s `slot-catalog.ts` is a generated artifact left stale by the merge — regenerated with `gen-client-catalog` (line references, the `SteeringMessageNodeView` occupant name, and new slot entries).

## Alternatives considered

- **Revert everything to upstream implementations** — rejected: FlipText, pick-hold, managed presentation, and the rest are deliberate desktop features; reverting would withdraw already accepted product behavior.
- **Loosen assertions to `toContain` or delete them** — rejected: weaker assertions would hide the next real regression of the same kind; the accessible-text assertion is equivalent to the original contract with no loss of strength.
- **Keep the `v6` persistence key** — rejected: it forks the key name from upstream permanently, and upstream already reworked the schema semantics for that key (dropping the timestamp ledger); keeping `v6` only carries the divergence into the next merge.

## Consequences

One-time cost: existing users' workspace view preferences (ordering mode and manual order) reset to defaults; no data is lost. The spec updates bind the current contracts of the desktop features — the old FlipText label stays mounted `aria-hidden` during the animation, the pick holds until the projection frame, and `conversation.hero.workspace` is no longer instantiated for presentation-owned sessions. The second wave restores the unknown-unarchive-id rejection (`cannot unarchive session '<id>'`, symmetric with archive) and repairs the durable-question resume from a phase conflict back to an atomic in-window handoff; default-composition request headers no longer contain ralph (upstream's opt-in semantics). The vendor GUI suite (7252 tests) and the core contract suite (4729 tests) are green again, snapshot/catalog/notices gates pass, unblocking the `test.yml` gate so the release candidate build can proceed.

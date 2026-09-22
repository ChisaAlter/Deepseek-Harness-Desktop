# Decision: Desktop interface adaptation for Harness alpha.2

Status: implemented

[中文](2026-09-18-harness-alpha2-desktop-adaptation.md) | English

## Problem

alpha.2 moves session navigation from the session controller to workspace navigation, replaces the global current field with retained references, and moves input queues to the inbox. A successful textual merge can still leave the Skills page incorrectly scoped, agent navigation broken, and conversation components missing injected services.

Existing decision audit: [alpha.1 merge-drift adjudication](../bug-fix/2026-09-17-vendor-alpha1-merge-drift-remediation.en.md) partially overlaps and continues to supply the upstream-contract-first, Desktop-fidelity principle. This record covers alpha.2 interface adaptation without replacing those historical fixes.

## Decision

- Keep the three-way merge and Desktop extensions while adopting alpha.2 session references, status APIs, and component factories; do not resurrect removed current, queue, or open APIs.
- Navigate to agents through workspace navigation with complete subagent addresses. Scope the Skills catalog to the session retained by the main view, keeping the per-session cwd cache that prevents transient rescoping.
- Adapt the conversation body extension chain, plugin-owned presentation, no-directory entry, draft transition, composer width, and typing effects to the new factory injection contract. References outside the main view must not change the Skills scope.
- Follow alpha.2 sandbox escalation: repeating the current mode succeeds immediately; narrower requests are rejected instead of silently retaining broader permissions. Keep approval cancellation signal propagation.
- The CLI name `web` is profile shorthand. Desktop launcher flags remain ahead of app flags, and tests extract actual option declarations from the new profile parser.
- Model editing adopts alpha.2's expandable shared rows and effective input-type inheritance. Explicit edits cannot deselect the final type, and saving keeps text before image. Desktop reasoning controls remain; fixtures open the disclosure before checking the new contract.
- AppFrame's captionDrag remains the sole Desktop window drag region. New fixed overlays declare no-drag. Pointer leave still hides Tooltip while incorporating upstream nested-tooltip suppression.
- Overlays mount in the opening render so focus effects can access their nodes; the 200ms exit hold remains. Model-menu keyboard rows come from committed DOM instead of refs cleared during rendering, and the pane resets only after exit completes.

## Alternatives considered

- Keeping old session-controller APIs reduces local edits but creates competing navigation owners and breaks reference release and view synchronization; rejected.
- Taking the entire upstream UI reduces conflicts but removes accepted Desktop interactions and plugin extensions; rejected.
- Silently mapping a narrower sandbox request to the current broader mode supports old callers but violates the requested semantics and upstream validation; rejected.

## Consequences

Desktop code follows the upstream object lifecycle at the cost of adapting consumers, fixtures, dependency declarations, and generated catalogs together. Updating the pin does not establish acceptance: the sync feature card records build, GUI/core contracts, Desktop startup, and fork-invariant validation. Existing user edits remain byte-for-byte intact; no branches or commits are created.

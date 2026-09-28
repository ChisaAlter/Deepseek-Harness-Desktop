# Decision: Empty-state cards mirror the upstream guide registry

Status: implemented

[中文](2026-09-27-empty-state-upstream-guide.md) | English

## Problem

The classic right column's empty-state card wall carried a hard-coded five-card list (Browser / Terminal / Files / Diff / Agents) — a second entry inventory beside the upstream `ui-sidebar-right` guide registry. Adding or renaming an upstream page type never followed through, and card clicks went to `ui-surfaces`' own `OpenableKind`, opening the desktop implementations rather than the upstream panels. The user asked for a card count matching the upstream guide and clicks landing on upstream functionality, while keeping the existing card-wall visuals.

## Decision

`ui-surfaces`' empty state no longer defines the entry list itself. `SurfacesRootInjected` gains a `guide` face: `entries` is an observable snapshot of the `ctx.sidebarRightTabs` registry's `guide()`, and `open` places the picked upstream page type into the native dock via `ctx.sidebarRight.openTabIn(sessionId, kind)` (falling back to the mounted Session for the sessionless seat) — the dock's own expansion collapses the classic track, keeping the two right columns mutually exclusive. With `guide` present, `EmptyState` renders the registry entries one-for-one (count, title, description, and icon all come from upstream; an entry without an icon falls back to the same cube placeholder the upstream guide draws). Without it (sidebarRight not composed), it keeps the legacy five-card set. The centered two-column square card geometry, the `data-surfaces-empty` marker, and the availability-disabled styling are unchanged.

## Alternatives considered

- A new public `guideEntries` member on `ISidebarRight`: works, but the `sidebarRightTabs` registry is already a public service via `ctx.reflect.provide`, with `guide()`/`subscribe()` ready-made; a parallel API would duplicate the same fact.
- Rendering the upstream `GuideBody` with the card-wall CSS (the merged-dock approach): one guide, one truth — but that is exactly the merged-dock direction reset away on 09-26; the user wants the classic shell kept, not merged again.
- Cards still opening the classic `surfaces.*` occupants: fails the "clicks open upstream functionality" requirement.

## Consequences

Upstream page-type additions or removals now change the empty-state card count immediately; the two entry inventories are unified. The cost: a card click switches to the native dock column (upstream chrome), while the classic `surfaces.*` occupants remain reachable through openPath / event routes; `EmptyState` carries a local copy of the upstream `CubeGlyph` placeholder (value exports cannot be shared across client packages). Specs cover iconless entries, missing descriptions, and registry updates; `single-right-panel-contract` and `harness-desktop-forks` pin the seam.

Supersedes: 2026-09-23 Restore the DSHD right sidebar (narrows the entry-list source; visuals and host ownership unchanged).

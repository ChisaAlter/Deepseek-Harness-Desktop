# Decision: Collapse conversation actions according to title-row space when the right panel opens

Status: implemented

[中文](2026-09-23-surface-titlebar-fit.md) | English

## Problem

Opening the DSHD right panel narrows the conversation column, but `AppFrame` selects `full/cozy/compact` from the whole column width. In a live 1440px window the column remains above 720px and stays `full`; after the Session log and Git trailing cluster consumes about 500px, the title row has only 225px left. `Agent Team` reaches x≈482 while the directory opener starts at x≈471, creating about 11px of overlap and squeezing the title to 16px. Existing static CSS and intra-cluster spacing tests did not inspect the real boundary between the two header groups.

## Decision

The conversation title row is a CSS query container whose content width already excludes the trailing cluster reserve. At 520px or less it hides secondary `header.actions` while retaining the title, opener, and trailing cluster. At other widths the action group may shrink, with any excess clipped inside its own box instead of painting over utilities. Density still selects trailing labels from the whole column width so label changes cannot feed back into density selection. `AppFrame` rounds the trailing cluster's measured fractional width upward before publishing the reserve; rounding to nearest previously reduced the 8px safety gap to 7.7px in Electron. A live Electron/CDP geometry gate now requires at least 8px horizontal clearance between actions and utilities, and between utilities and the trailing cluster, after the right panel opens.

## Alternatives considered

- **Change only the whole-column 720px density threshold**: panel, sidebar, window-control, and plugin widths vary, so a fixed column threshold still cannot guarantee the actual title-row space.
- **Drive trailing `full/cozy/compact` from the remaining title space**: collapsing trailing labels changes the measured width and can oscillate between density states; the existing crowding-density note already rejected that feedback loop.
- **Clip the action group alone**: boxes would cease crossing, but buttons would be cut off and still consume title width, so this is not an acceptable normal narrow state.

## Consequences

When the right panel squeezes the title row, secondary Agent actions temporarily collapse; closing the panel restores them according to available space, with no persisted preference change. The opener and trailing cluster remain clickable, and the title retains ellipsis behavior. This local query does not change trailing width, so it introduces no density oscillation. The live reproduction changed from about 11px overlap between actions and opener to a hidden action group. A `ui-layout` test pins fractional-width rounding; `apps/web/tests/titlebar-fit.e2e.ts` locks the real geometry of all three control groups in a built browser, and `scripts/verify-titlebar-fit.mjs` repeats the check in source Electron. This partially overlaps the [right-panel restoration decision](../product/2026-09-23-right-sidebar-dshd-guide.en.md) but owns only top-row clearance; the [titlebar click-region decision](2026-09-23-titlebar-click-regions.en.md) still owns `no-drag` hit testing.

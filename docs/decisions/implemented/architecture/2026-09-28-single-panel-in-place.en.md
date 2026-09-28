# Decision: One right panel with in-place work loops

Status: implemented

[中文](2026-09-28-single-panel-in-place.md) | English

> Supersedes [2026-09-27-empty-state-upstream-guide](../../archived/product/2026-09-27-empty-state-upstream-guide.en.md)

## Problem

Guide cards occupied the classic surfaces column, but clicking one opened another dock column and collapsed the original. The user confirmed keeping the current appearance and removing the second sidebar so entry and content change in place.

## Decision

Mount one full-height right panel. Use Sidebar tab and resource lifetimes for upstream functions while preserving the DSHD 320px two-column guide, window-top tabs, close after title, and caption-control clearance. Remove the classic host and mutual exclusion. Route files, Office, Browser, terminal links, and titlebar controls to the same owner. Closing the last content tab restores the guide in place. Mini opens may preserve current expansion.

## Alternatives considered

- Remove only the transition animation: cheap, but leaves independent widths, tabs, and entry state.
- Keep only the old five kinds in the classic column: preserves appearance easily but excludes remote files and new upstream types.
- Reimplement all tab and resource lifetimes: fully customizable, but duplicates upstream capabilities and expands maintenance.

## Consequences

Guide and content share width, tabs, and expansion while retaining upstream capabilities. Classic component sources remain for existing types and historical tests, but the product no longer mounts a second column; legacy widths no longer consume another grid track. Existing classic tabs and unsaved buffers are not migrated automatically. Routing, last-tab return, and mini-without-expansion regressions are added.

Verification: related packages passed 88 files / 1128 tests, and uniform-entry regressions passed 8/8; `apps/web` type checking and the final full source build passed, and Electron was restarted. In source Electron, Files / Browser / Diff / Agents opened and closed in place with x=1027, width=542, y=0 unchanged across sampled frames, zero legacy hosts, and last-tab close returning to the guide. After restart, all four entries were rechecked at a 1440px window: x=898 and width=542 stayed constant; the workspace file tree, real Git diff, and titlebar geometry gate passed. Governance passed 6/6 and the first doc-sync passed 8/8; a later run fell to 6/8 because concurrent titlebar documentation lacked its pairing record and design-language exceeded its budget. The full GUI suite still has failures in other areas; desktop contracts passed 25/26, with the sole failure being a stale existing input-trigger source-text marker, which is not reported as passing.

Decision audit: fully supersedes the cross-column opening choice of the 2026-09-27 guide mirror; partially overlaps the 2026-09-23 appearance restoration and retains its visual constraints. Cross-session ownership and Browser guest handoff decisions remain applicable.

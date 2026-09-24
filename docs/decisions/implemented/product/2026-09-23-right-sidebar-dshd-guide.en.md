# Decision: Restore the original DSHD right panel

Status: implemented

[中文](2026-09-23-right-sidebar-dshd-guide.md) | English

## Problem

The 2026-09-22 single-panel change replaced the original DSHD right panel with DSH's native `ui-sidebar-right`. Its width, top edge, tabs, navigation, and entry layout all differ from the DSHD panel users knew. Replacing only the native Guide's capsules with two-column CSS cannot restore the previous interface.

## Decision

Re-enable the original DSHD `ui-surfaces` track, `SurfacesRoot`, `SurfaceTabs`, and `EmptyState`. Register Files, Browser, Terminal, Diff, and Agents under `surfaces.*` again; open workspace paths in the originating session's classic tabs. `Ctrl+\` and the titlebar right-panel button toggle this track. On desktop startup, migrate the interim native Sidebar expansion so the classic panel can appear. File paths without a cwd return to the Host opener; the native Sidebar remains only for other exclusive resources. Opening either panel closes the other, leaving one visible right column.

## Alternatives considered

- Change only the DSH Guide capsules to square tiles: this cannot restore the original top tabs, panel width, or file-tree layout, and the user explicitly rejected it.
- Remove the native Sidebar entirely: this would lose exclusive resource types not yet ported.

## Consequences

The historical DSHD components and design language govern the panel's appearance. The entries still lead to working Files search/preview, Browser navigation, Terminal, Diff, and Agents surfaces. Preserve file drafts and tab persistence; verify startup migration, mutual exclusion, titlebar toggling, file opening, and the running desktop display.

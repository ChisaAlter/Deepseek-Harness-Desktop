# Decision: Files directory entry and legacy viewer address recovery

Status: implemented

[中文](2026-10-01-sidebar-files-guide-address.md) | English

## Problem

The right-panel guide shows both Files and File viewer, but the viewer entry has no specific file. Restoring or opening that entry passes `sidebar://desktop-file` to file reads and produces ENOENT. The user requires one directory entry while preserving existing file tabs and drafts.

Record audit: [One right panel](../architecture/2026-09-28-single-panel-in-place.en.md) retains host and tab lifetime; [DSHD right-panel appearance](../product/2026-09-23-right-sidebar-dshd-guide.en.md) retains the visual source, while the former owns replacement of its older two-panel arrangement; [Project audit fixes](2026-09-30-project-audit-fixes.en.md) retains save and draft guarantees for valid files. All three partly overlap; this change fully supersedes none of them.

## Decision

Files registers only the Files directory guide. `desktop-file` continues to handle specific Session file resources without its own guide. Legacy fileless viewers, internal Sidebar addresses, absolute or malformed addresses, and empty-root resources mount no file editor and perform no file reads. The body directly reuses the standard `SidebarFilesPanel`. Its owning Session comes from the slot's standard share without borrowing the foreground Session. The title component under the same key shows the localized Files title; valid files retain `resourceTitle`.

Compatibility rendering lists only the owning Session's directory and preserves the tab record, pane, expanded state, and floating-window state. It calls no replacement action that would expand or activate the panel or move a floating tab back into the dock. Valid file-resource addresses, tab identity, draft retention without a cwd, and save queues stay unchanged. No persisted-layout migration or storage format version change occurs.

## Alternatives considered

- Replace the legacy viewer with `files` through the standard tab action: this normalizes the address and reuses directory-page deduplication, but the existing planner expands and activates the panel and moves floating tabs back into the dock, changing hidden or floating state. In-place compatibility rendering avoids those side effects.
- Rewrite or delete all `desktop-file` tabs at startup: this clears old placeholder addresses early, but broadens persisted-layout migration and touches valid files and drafts. Keeping the record changes only the fileless page's presentation.

## Consequences

Users select a specific file from one directory entry, and legacy viewer addresses no longer reach file reads. Old placeholder records remain, so their compatibility body and title must stay supported. Directory presentation uses the existing file-tree behavior. Regression coverage includes the guide list, real layout restoration, Session ownership, hidden and floating state, and unchanged valid files and drafts without a cwd.

Verification: real Guide / registry / controller / keyed-body and layout-restoration regressions passed 9/9; existing adapter / apply tests passed 16/16. Narrow lint on changed sources and tests, the `ui-files` type build, and the client catalog check passed. Documentation pairing and checks passed; these results do not certify acceptance of a new installer.

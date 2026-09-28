# Decision: Shell window silhouette corners unified at a 10px circular arc

Status: implemented

Archived: 2026-09-27

[中文](2026-09-27-shell-window-corner-radius-10.md) | English

## Problem

Both transparent windows — launcher and desktop — carry a 20px outer silhouette. The radius reads oversized and bubbly, clearly off the conventional macOS window corner (≈10px), which is what the user flagged ("the corners always feel off"). The value was also duplicated across four renderer contexts and nine literal sites: four in `harness-chrome-inject.js` (body / `#dshd-frame-canvas` / `#dsh-wallpaper` / `#dshd-frame-ring`), two in `boot.css` (body / `.scene`), `launcher.css`'s `.shell`, the confirm-dialog scrim, and vendor `ui-layout`'s `.frame` plus `--dsh-windows-content-radius` — with no single contract point and guaranteed drift. A second inconsistency: the launcher `.shell` edge line uses `border-l1` (4% black) while the desktop `#dshd-frame-ring` uses `border-l2` (10% black), so the two windows' edges differ in strength.

Pixel-level verification after converging to 10px exposed a second cause: the harness page loads `ui-theme/corner-shape.css`, whose universal rule `* { corner-shape: superellipse(1.5) }` makes every desktop silhouette layer (body / canvas / wallpaper / ring and `.frame`) render as a squircle — a curve that pulls a 10px window corner into roughly half its visual span — while the launcher and dialog (file:// pages without the rule, round by default) render true arcs. The "off" feeling traced to both size and shape.

## Decision

Silhouette radius 20→10 (the conventional macOS Big Sur+ window corner), and the silhouette layers inside the harness page explicitly take `corner-shape: round` — opting out of the global squircle so the window corner is a circular arc rather than the UI-panel curve; document-first then code:

- `harness-chrome-inject.js` gains a `FRAME_RADIUS = 10` constant shared by all four injected silhouette layers, each of which also takes `corner-shape: round`; the maximized-to-zero rules are untouched.
- `boot.css` body and `.scene` move to 10px.
- `launcher.css` `.shell` moves to 10px and its edge token `border-l1`→`border-l2`, matching the desktop hairline ring.
- `update-dialog.css` scrim follows the silhouette to 10px (continuing the `dialog-scrim-silhouette-radius` same-value contract).
- vendor `ui-layout` `AppFrame.module.css` `.frame` moves to 10px and takes `corner-shape: round` (matching the existing opt-out precedent on `.centerCol`), and `--dsh-windows-content-radius` moves to 10px (centerCol's top-left corner and ui-sidebar-right's fullscreen corner follow the var automatically); the compiled `lib/client.js` is patched in sync; the stale 16px in both READMEs is corrected.
- A new `src/main/shell-silhouette-radius.test.js` pins the same-value contract, the round corner shape, and the maximized zero across all layers.

The boot page, launcher page, and dialog child window are file:// renderers that never load `corner-shape.css`, so they are already round and need no opt-out.

## Alternatives considered

- **8px (Windows 11 native)** — rejected: the user explicitly asked for the macOS-conventional value, and 8px reads nearly square under 150% DPI scaling.
- **12px** — rejected: no macOS precedent; a mid-point compromise has no anchor.
- **Keep squircle(1.5) and enlarge the radius to compensate visually** — rejected: the same declared radius draws different curves in different renderer contexts, so launcher and desktop corners would never match; the squircle edge also feathers tangentially, leaving "visual outer radius" unpinable as a contract.
- **A shared CSS variable** — rejected: boot, harness, launcher, dialog child, and the vendor module live in different renderer contexts with no common DOM scope to carry a variable; constants plus a regression test are the only workable contract.

## Consequences

Both windows' silhouettes settle at the macOS-conventional 10px circular arc with identical curves and edge strength; `--dsh-windows-content-radius` consumers (content top-left corner, right-rail fullscreen corner) follow via the var. The silhouette's round opt-out applies only to the window corner — in-page UI panels keep the global squircle. Cost: the radius literal still lives in five files by structural necessity, now guarded by `shell-silhouette-radius.test.js`; `update-dialog.test.js`'s scrim assertion moves to 10px with the contract. Live verification: per-pixel CDP inspection confirmed the harness-page silhouette corner changed from the tight squircle to a true 10px arc matching the launcher; maximized still zeroes out.

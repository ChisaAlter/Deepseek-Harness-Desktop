# Decision: Roll the shell window silhouette radius back to 20px

Status: implemented

[中文](2026-09-27-shell-window-corner-radius-20.md) | English

> Supersedes [2026-09-27-shell-window-corner-radius-10](../../archived/product/2026-09-27-shell-window-corner-radius-10.en.md)

## Problem

The same day the unified 10px silhouette landed, hands-on feedback called the launcher and desktop corners too small. Re-checking the macOS reference showed the anchor itself is drifting: 10pt is the Big Sur–Sequoia (macOS 11–15) window radius; current Tahoe (macOS 26) raised it to 16pt and up — toolbar/sidebar windows run larger and are no longer uniform — because the corner wraps concentrically around glass toolbar elements. 10px anchors the previous macOS generation and reads tight on this product's desktop.

## Decision

The silhouette radius goes 10→20; every other part of the contract stays: same-value layering across the four rendering contexts (the injected `FRAME_RADIUS`, boot `body`/`.scene`, launcher `.shell`, dialog scrim, vendor `.frame` + `--dsh-windows-content-radius` + the `lib/client.js` artifact + ui-layout README), the `corner-shape: round` circular arc, the `border-l2` edge ring, radius zeroed while maximized, and `shell-silhouette-radius.test.js` pinning the shared value updated to match.

## Alternatives considered

- **16px (Tahoe's toolbar-free default)** — rejected: the user picked 20 outright, and Tahoe's radius floats with window furniture, so 16 is only its lower bound.
- **Keep 10px (the Sequoia anchor)** — rejected: it measured too small for the user, and after Tahoe that anchor no longer stands for "the mac norm".
- **Squircle shape to fake a larger radius** — rejected: the previous record's shape call stands; equal radii still draw different curves across rendering contexts, and the split between the page's squircle panels and the window's round corner is kept.

## Consequences

20px sits above the Sequoia norm (10) and above Tahoe's toolbar-free default (16), in the visual range of Tahoe toolbar windows — an explicit preference, not a platform anchor. Shape, layer structure, edge-ring strength, and the maximized zeroing rule are unchanged; `--dsh-windows-content-radius` consumers (centerCol content corner, right-column fullscreen corner) follow through the var. The cost is unchanged from the previous record: the radius literal lives split across per-context files, held in place by the test.

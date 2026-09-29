# Decision: Render the whale status card at display pixel density

Status: implemented

[中文](2026-09-29-pet-canvas-density.md) | English

## Problem

At 150% Windows scaling, the pet Canvas backing buffer still matches its CSS dimensions, so the status card text becomes blurry when enlarged. The feed button sits too close to the statistics text without enough separation.

## Decision

Allocate the Canvas buffer at the current devicePixelRatio and use an absolute setTransform to keep drawing, clearing, display bounds and hit-testing in CSS pixels. Rebuild on resize and resolution media-query changes, rebinding the query to the current density so display moves cannot leave an outdated buffer. Move the feed button down 8px, leaving 12px after the preceding 12px line box; drawing and hit-testing share geometry constants.

The existing [hit and bubble geometry decision](2026-09-24-whale-hover-bubble-geometry.en.md) covers the adjacent CSS coordinate contract and remains valid; this fix does not change body hit bounds.

## Alternatives considered

- Only increase font weight or disable image smoothing: a small change, but it cannot recover missing physical pixels and would alter the existing text style.
- Build a separate DOM menu: the browser would handle text density directly, but rebuilding painting, click-through and hit-testing exceeds this local fix.

## Consequences

Menus and bubbles render at native display density while layout and interaction coordinates retain their size. Canvas memory grows with density squared; THA4 inference dimensions stay unchanged. Focused regression checks cover 100%/125%/150%/200% transitions, edge placement, button spacing and hit regions; visual verification uses the current 150% display.

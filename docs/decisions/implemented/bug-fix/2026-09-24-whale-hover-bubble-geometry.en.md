# Decision: Use drawn geometry for whale hover and bubble placement

Status: implemented

[中文](2026-09-24-whale-hover-bubble-geometry.md) | English

## Problem

The whale girl lives in a transparent window covering one display. Once the window becomes interactive, even transparent pixels block clicks to applications underneath. The main process added a 24px margin around the body, and the renderer treated an oversized ghost-clearing rectangle as the body bounds during live poses. When dragged, the same rectangle pushed the speech bubble far from her head or flipped it below her.

## Decision

Reduce the main process hold margin and renderer exit hysteresis to 8px. Compute live model hit bounds from the actual alpha box transformed by the same foot or grab pivot, rotation, scale, and mirror used by `drawLive`. Keep the larger rectangle exclusively for clearing old pixels. Anchor bubbles to the body bounds, independent of the status and chat cards. A drag continues to hold interactivity until release.

## Alternatives considered

- **Reduce only the main process margin** — rejected: sleep and drag poses would still report the oversized clear rectangle, and bubble placement would remain wrong.
- **Use per-pixel alpha for native window hit testing** — rejected: the transparent window's interaction switch applies to the entire window, so pixel data would still need cross-process synchronization; reading frames would also burden inference.

## Consequences

More of the neighboring desktop remains clickable, and the bubble follows the carried head. An extreme sway frame may pass clicks through sooner than the old broad margin; the drag guard and 200ms edge debounce continue to protect gestures. Regression tests cover the main process margin, carried bubble, and rotated pose bounds.

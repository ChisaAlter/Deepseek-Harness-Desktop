# Decision: Shell confirm dialog scrim follows the window silhouette radius

Status: implemented

[中文](2026-09-27-dialog-scrim-silhouette-radius.md) | English

## Problem

`ShellConfirmDialog`'s scrim `body::before` is a square sheet painting the whole transparent child window. The child shares the parent's bounds, so the four corner gaps (transparent regions outside the shell silhouette's 20px rounding) get dimmed too: on the side where the desktop wallpaper is dark, the gap's brightness collapses to nearly the window's interior and the rounded edge becomes optically invisible — task-protection confirms, update asks, and other shell dialogs made the dark-wallpaper-side top-right and bottom-right corners read as square (user report: "右上和右下的圆角没了"). Row-by-row screenshot pixel comparison proved the silhouette curve still exists; the dimmed gap simply loses all contrast with the interior.

## Decision

The scrim is clipped to the shell silhouette's 20px radius: `update-dialog.css`'s `body::before` gains `border-radius: 20px`, so the corner gaps stay transparent and show the desktop — the same pixels as when no dialog is open. When the parent is effectively maximized the silhouette is square: `show()` sends `maximized` in the `view` payload via `chrome.js`'s `isEffectivelyMaximized(parent)`, and the renderer sets `html[data-window-maximized]` to restore a square scrim; if the parent flips state through `resize`/`moved` while the dialog lives, the same view is re-pushed at the same revision and the renderer only refreshes the attribute on non-newer revisions instead of re-rendering.

## Alternatives considered

- **Keep the scrim square and overlay a silhouette hairline ring on top** — rejected: a ring restores the curve's legibility, but the gap stays dimmed and on bright wallpaper the rectangular dim edge remains visible; the corner pixels still differ from the normal state — cosmetic cover-up, not a fix.
- **Use `parent.isMaximized()` for the square check** — rejected: transparent frameless windows fake-maximize by bounds on Windows, so `isMaximized()` stays false; the geometry-backed `isEffectivelyMaximized` is required, the same source as the injected `data-window-maximized`.
- **Snapshot the state once in `show()`** — rejected: the parent's bounds can still change programmatically while a dialog is open (display-metrics relayout, restore paths); a stale snapshot misaligns scrim and silhouette. The resize/moved sync is a cheap state comparison.

## Consequences

Cost: a new `maximized` field on the `changed`/`status` payload (the renderer tolerates its absence via `Boolean(state.maximized)`); the scrim radius is a third site holding the same 20px literal as boot.css and harness-chrome-inject.js. Gain: the corner gaps show the desktop wallpaper again, keeping the rounded edge legible on any wallpaper; under a maximized parent the scrim stays square with no residual un-dimmed arcs. `src/main/update-dialog.test.js` pins the radius rule, the payload field, and the re-push path with 5 tests; a faithful repro (real modules + real renderer files) verified pixel-by-pixel that all four corner gaps show un-dimmed wallpaper with a crisp silhouette edge.

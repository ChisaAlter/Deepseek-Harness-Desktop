# Decision: Releasing the native guest when the floating preview closes

Status: implemented

[中文](2026-09-27-browser-float-close-release.md) | English

## Problem

After clicking the floating preview's close control, the top strip and the rounded frame disappear while the page stays in the chat at its last position. The frame is a renderer node; the page is a main-process `BrowserView`. A native view always paints above the renderer, so unmounting the frame does not remove it.

The deliverable-card path opens the float first and leaves the right column closed. When the user closes it, the `ui-surfaces` Browser occupant is still mounted but hidden: its effect's local `visible` variable resets to `false` on every dependency change, so nothing ever hides the guest. With no usable host rectangle to reclaim it either, the native view stays where the float last called `previewSetBounds` until some other surface navigates the guest.

## Decision

Closing the float keeps the existing handoff semantics: the departing surface does not call `previewHide`, so it cannot race the new owner's `previewShow`. What was missing is the cross-surface fact that the float actually painted this guest, so the panel keeps a `floatOwnedGuestRef`: it is set while the float is open with the same `previewId`, and the panel consumes and clears it on its first sync after the float closes.

That first sync branches on host availability. With a visible host rectangle it reclaims the guest through `previewShow` at the panel's current bounds, preserving URL, history, and page state. With no host rectangle (collapsed column, hidden surface) it calls `previewHide` to release the native view. Regular `previewShow` / `previewResize` looping resumes after that.

## Alternatives considered

- **Have the close control call `previewHide` directly** — rejected: it races the right panel's `previewShow` in the same tick, which is exactly the race the 2026-09-24 handoff fix removed; the float cannot know whether the panel already took over.
- **Promote the panel effect's `visible` flag to a module singleton** — rejected: several seats/sessions may each mount a `PreviewPanel`, and shared state would cross-contaminate ownership.
- **Destroy the guest on close and build a new one on reopen** — rejected: the `dshd mini-player` contract requires one guest migrating between presentations with URL and history intact; rebuilding loses page state.
- **Replace the native `BrowserView` with an in-renderer `webview`** — rejected: out of scope for this defect and it would redesign the whole preview isolation and hit-testing model.

## Consequences

Closing the floating preview now leaves the chat clean, and a collapsed right column no longer strands a page. A visible right column still reclaims the same guest on the existing contract, so page state survives. The cost is one extra cross-surface ownership flag in `PreviewPanel`; its correctness depends on the existing ordering where `previewId` already matches when the float opens, guaranteed by the `setMiniPlayerRuntime` / `openMiniPlayer` call order and pinned by focused specs.

## Sources

- [Chat float and right-panel handoff](2026-09-24-browser-preview-surface-handoff.en.md)

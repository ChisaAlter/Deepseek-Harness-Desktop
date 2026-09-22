# Agent Note: Approval takeover follows composer resize

Status: implemented

English | [中文](2026-08-20-approval-panel-composer-resize.zh.md)

## Problem

Interface Settings `composerResize` adds top/left/right drag handles to InputBar. `ApprovalPanel` occupies that same composer seat while an approval wait is pending and still used only the shared 14-line cap, so a resized input snapped back to auto-grow and the approval card itself could not be dragged.

## Decision

`ApprovalPanel` injects the same `ComposerSubmissionPolicy.composerResize` store InputBar reads (`ApprovalComposerInjected.hooks.composerResize`). When the field is `true` it paints the shared `ComposerResizeHandles` and `useComposerResizeDrag` writes height onto `[data-approval-scroll]` and width onto `[data-composer-card]`. With a `[data-composer-seat]` ancestor, the drag also publishes `--dsh-composer-resized-height` / `--dsh-composer-resized-width` on that seat and copies the size onto every InputBar / ApprovalPanel body under it, so the overlay-hidden fallback keeps the dragged size and a takeover adopts it on mount. Turning the setting off removes the handles and clears the published size. QuestionComposer is unchanged: its card still uses the viewport cap, not the draft scrollport.

The resting cap remains `--dsh-composer-text-max-height` on `.composerSeat` ([approval text cap](2026-07-30-approval-panel-command-cap.md)). A dragged region raises `max-height` to `70vh`, matching InputBar.

## Alternatives considered

**Leave ApprovalPanel on the 14-line cap.** Rejected: the takeover is a content swap in one seat; a different size is a layout jump, and the product copy already treats the approval card as the input card.

**A session store for width and height.** Rejected: the seat is already the shared ancestor, and `overlay: true` keeps both DOM trees; CSS variables plus fan-out to sibling scrollports is enough.

**Give QuestionComposer the same handles.** Rejected here: that takeover sizes the whole card with `min(60vh, 520px)`, not the draft scrollport this setting resizes.

## Consequences

A user who enlarges the input and then hits an approval keeps that box. They can drag the approval card the same way. Turning `composerResize` off restores auto-grow on both bodies.

## Testing

`approval-panel.client.spec.tsx` pins no handles until `composerResize` is true, a top-edge drag setting `[data-approval-scroll]` height, a side-edge drag setting `[data-composer-card]` width, clearing when the setting turns off, adopting `--dsh-composer-resized-*` from `[data-composer-seat]`, and publishing a drag back onto that seat. Apply wiring pins the approval entry's inject store as the same object as the Interface Settings resize row. InputBar resize cases still pass through the shared handle module.

## Related

[The approval takeover shares the composer's text cap](2026-07-30-approval-panel-command-cap.md). [Interface Settings chrome visibility](../feature/2026-08-19-interface-settings-chrome-visibility.md).

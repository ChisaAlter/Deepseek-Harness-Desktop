# Decision: Deactivate retained exit frames and hand modal focus across layers

Status: implemented

[中文](2026-09-28-modal-focus-and-retained-exit-deactivation.md) | English

## Problem

Two related focus/accessibility gaps on the presence (retained-exit) path:

- Overlays that keep a retained exit frame (`Menu`, `MenuView`, `HoverCard`, `DisclosureRow`, `Tooltip`) stayed in the DOM to play their exit recipe after logical close, but carried no `aria-hidden`/`inert` marker — screen readers and keyboard traversal still treated them as interactive, and focus could land inside a container that was already animating out.
- `useModalLayer` only recorded the direct opener: when nested modals (parent → child) retired in a single commit, the child's retirement ran first and its recorded opener lived inside the parent that was itself leaving, so focus was dragged into a hidden parent instead of the real external opener.
- Focus restoration only checked whether the opener was connected, not whether it sat inside a `hidden`/`aria-hidden`/`inert` container; `shortcuts` and `ui-dockkit` each counted foreground layers with their own `modalSelector`, duplicated and inconsistent.

## Decision

- Every presence-retained exit frame now carries `aria-hidden` + `inert` (via an `inertWhen` helper): on logical close it leaves the a11y tree and Tab order immediately while the exit recipe still plays — the perceived motion is unchanged, the interactive surface shrinks at once.
- `useModalLayer` gains an `outerOpener` hand-off: when a non-top layer retires beneath another, it passes its recorded external opener up the stack, so the topmost restoration prefers the nearest eligible ancestor target and focus is not dragged into a hidden parent.
- Focus eligibility becomes "connected and not inside a `[aria-hidden="true"]`/`[inert]`/`[hidden]` container"; a new `foregroundModalSurfaces(document)` export unifies foreground-layer queries so `shortcuts` and `ui-dockkit/TabMenu` stop assembling their own `modalSelector`.

## Alternatives considered

- **Hide retained frames with CSS `visibility`** — rejected: it blocks paint only; the a11y tree and focus traversal can still reach the frame. `inert` is the correct semantics for interactive deactivation.
- **Restore focus to `document.body`** — rejected: it drops the user out of their modal workflow to the page top, worse than landing in a hidden parent. `outerOpener` preserves the "return to the button that opened me" expectation.
- **Keep `modalSelector` scattered** — rejected: three consumers each maintained the selector, so one edit would silently drift from the rest; a single export is the smallest surface the fork assertion can pin.

## Consequences

Cost: each retained exit frame carries two more attributes and one `lastOpenCrumbs` snapshot; `useModalLayer` carries one `outerOpener` field and an ancestor fallback. Benefit: screen readers and the keyboard no longer treat an exiting animation as interactive, nested modals closing together return focus to the real external opener, foreground-layer queries live in one place, and the `modal-layer` spec grew from 11 to 18 cases covering the three inactivity markers and both parent/child same-commit retirement orders.

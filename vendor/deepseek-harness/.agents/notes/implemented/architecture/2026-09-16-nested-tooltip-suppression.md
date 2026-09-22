# Agent Note: Suppress an enclosing tooltip while a nested one is shown

Status: implemented

English | [中文](2026-09-16-nested-tooltip-suppression.zh.md)

## Problem

The collapsed sidebar renders its update badge through the `sidebar.toggle.badge` slot inside the expand button, and both the button and the badge attach a `Tooltip`. Hovering the badge showed two bubbles at once — the version notice and "Open sidebar" — because the badge is a DOM descendant of the button: the button's hover state stays true for as long as the pointer rests on the badge, and each tooltip correctly follows its own anchor.

## Decision

[Tooltip](../../../../packages/client/ui-primitives/src/Tooltip.tsx) provides a suppression setter through an internal `TooltipSuppression` context wrapped around its cloned anchor and its bubble. A nested tooltip consumes the nearest setter and announces whenever its own bubble becomes visible. An enclosing tooltip that receives a suppression claim keeps its hover/focus triggers and its measured position but does not render its bubble, so the enclosing bubble returns in the same commit that the nested one disappears.

The nested tooltip announces synchronously inside `show()` and through a `visible` effect. The synchronous call keeps a nested pair that becomes visible in one React commit from painting both bubbles for a frame; the effect releases the claim on every other path that hides a bubble, including unmount and a `disabled` flip.

No component in `ui-sidebar` or `ui-settings-general` changed: the badge already renders inside the toggle's anchor, so the shared primitive resolves the overlap for any future nested pair as well.

## Alternatives considered

**Disable the toggle tooltip whenever an update exists.** The simplest guard, and wrong: it removes "Open sidebar" from ordinary rail hovers for the whole time an update is available, including hovers that never touch the badge.

**Disable the toggle tooltip while the pointer is over the badge.** Hover-scoped, but `Tooltip` clears its hover and focus triggers when it is disabled, and no new `mouseenter` fires on the button while the pointer moves from the badge onto the button's own area. The enclosing bubble would stay gone until the pointer left and re-entered the button.

**Stop the badge's `mouseenter` from reaching the button.** It only helps a pointer that enters the badge directly; a pointer that enters the button first and then moves onto the badge already has the enclosing bubble visible, because the enclosing hover never ended.

**Render the badge outside the toggle's anchor.** The slot is declared inside the toggle button, and the badge must sit on the button's corner; moving the anchor out of the button would either detach the bubble from the control or change the slot's declared placement.

## Consequences

The rule is a property of tooltip nesting, not of the update badge: any tooltip whose anchor contains another tooltip now yields the bubble to the innermost visible one. A tooltip with no nested tooltip is unaffected — it consumes a null context and never announces.

The enclosing tooltip's bubble is withdrawn only while a descendant is visible; its trigger state survives, so no re-entry is needed to restore it. Suppression does not change what the anchors do: the button still toggles the sidebar and the badge remains a non-interactive marker.

[Tooltip tests](../../../../packages/client/ui-primitives/tests/tooltip.client.spec.tsx) cover withdrawal, restoration when the nested anchor is left for the enclosing one with a real `relatedTarget`, and release when a shown nested tooltip unmounts. The [sidebar shell test](../../../../packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx) covers the product wiring: the rail badge replaces the toggle bubble after the toggle's own hover delay has already elapsed.

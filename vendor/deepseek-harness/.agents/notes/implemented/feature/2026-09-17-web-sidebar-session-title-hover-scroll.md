# Agent Note: Web sidebar Session title hover scroll

Status: implemented

English | [中文](2026-09-17-web-sidebar-session-title-hover-scroll.zh.md)

## Problem

A Session title wider than its sidebar row is clipped with an ellipsis, so the part that distinguishes two related Sessions is the part that disappears. Fork makes it visible: the child's persisted title is the parent's plus an increment, so a long parent title leaves the `(1)` off the row's right edge. Opening the hover card shows the full title, but the card needs a dwell, covers neighboring rows, and is not the comparison the user is trying to make.

## Decision

A Session row reveals its clipped title in place while the pointer rests on the row. `SessionNodeItem` writes `title.scrollLeft = scrollWidth - clientWidth` on pointer enter and returns it with `scrollTo({ left: 0, behavior: 'instant' })` on pointer leave; the title element keeps `overflow: hidden`, so nothing reflows, no scrollbar appears, and the page never scrolls. Entering glides because the title carries `scroll-behavior: smooth` (the file's reduced-motion block restores `auto`), so the handler owns no timer or animation loop. Returning is deliberately one step: a smooth return would travel under the resting ellipsis and the row's narrowing cell for its whole duration.

While the pointer is on the row, `text-overflow` switches from `ellipsis` to `clip`: a scrolled `overflow: hidden` box still paints the ellipsis at its right edge, which would cover exactly the characters the scroll just revealed (verified in Chromium before the rule was written). That rule sits behind `@media (hover: hover)`, because a touch tap latches `:hover` on the row after the title has already returned, and an unguarded rule would leave the tapped row hard-clipped at its start.

The reveal belongs to the Session row, not to a single cell: entering anywhere on the row starts it, and it ends only when the pointer leaves the row. Workspace rows and search results keep their ellipsis behavior — their titles distinguish nothing by a trailing token — and only the Session title carries the scroll behavior.

The hovered row is also the wider cell: its trailing relative-time label yields to the row menu, so the hovered `clientWidth` is larger than the resting one and the hovered scroll maximum is smaller. A handler that read the resting width would compute a larger delta that the browser clamps to the hovered maximum, reaching the same far edge; the browser scenario therefore polls the live extent instead of the value the handler read.

## Alternatives considered

**A moving inner span or a duplicated-copy marquee.** Rejected: `text-overflow: ellipsis` ellipsizes text directly inside the clipping block, so moving the text requires a nested element whose own clipping (or the duplicate copy) moves with it; the resting ellipsis, the existing DOM, and the accessible text would all change. Scrolling the existing element keeps every one of them.

**A rAF or CSS-loop marquee.** Rejected: a continuous animation keeps moving while the user reads and needs per-row lifetime management. One scroll to the far edge and one back is the whole reveal.

**`scrollTo({ behavior: 'smooth' })` for both moves.** Rejected: it needs a `matchMedia` probe for reduced motion plus a capability branch, and it would keep the return animating under the resting ellipsis. The stylesheet supplies the entering glide, and the leaving move asks for `instant` explicitly.

**A handler-owned clip state cleared on `scrollend`.** Considered for the return transient; rejected because returning in one step removes the transient without a second state, an event listener, or a browser capability the jsdom lane lacks.

**`direction: rtl` on hover.** Rejected: it jumps instead of scrolling and reorders punctuation inside mixed-direction titles.

**Leaving the reveal to the hover card.** Rejected: the card opens only after its dwell and covers neighboring rows, so it cannot support comparing two adjacent rows.

## Consequences

A long title still occupies exactly one row line; the scroll range is measured from the element's own box, so a width change (the sidebar resizing, or the hovered row's own cell change) is picked up on the next pointer enter, and the instant return leaves the resting ellipsis and the text consistent whenever the pointer leaves. Revealing depends on a pointer resting on the row, so touch and keyboard users still rely on the hover card and the Rename dialog for the full title; removing the reveal leaves an ordinary ellipsized row.

## Testing

`packages/client/ui-workspace/tests/rows.client.spec.tsx` pins the scroll position written on pointer enter, the explicit instant return, and that a title that fits stays at its start. `packages/client/ui-workspace/tests/browser-styles.client.spec.ts` pins the stylesheet contract for the hovered row. `apps/web/tests/sidebar-title-hover-scroll.e2e.ts` hovers a seeded clipped row in the assembled application and asserts that the title really overflows, reaches its own live extent under the pointer, stops ellipsizing, returns to its start within one step, and that the computed scroll behavior is `smooth` in the default media state and `auto` under reduced motion.

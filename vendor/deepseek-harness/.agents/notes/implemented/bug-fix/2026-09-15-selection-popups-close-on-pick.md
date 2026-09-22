# Agent Note: Selection popups close on the pick and replay a frozen frame through exit

Status: implemented

English | [中文](2026-09-15-selection-popups-close-on-pick.zh.md)

## Problem

`ModelSelect` kept its card open across the pick's settle. `ModelDirectory.select` publishes `selecting` synchronously, which disabled every row — dimming the list mid-open — and blurred the clicked button, so the card's `onBlur` closed it into the 200ms presence exit. The settled projection then republished `current` mid-fade, and the right-edge placement re-measured against the already-relabeled trigger. One pick replayed dim → un-dim → check-jump → teleport inside the exit and read as a flash. `PopupSelectView` carried the milder form: an applying status row inserted above the list while `onSelect` was in flight, so a fast settle popped the row in and out inside one beat. Every other `Menu` consumer already closes on the pick and settles in the background; the composer pickers were the outliers.

## Decision

`choose`/`chooseEffort` close the card immediately (`close(true)`, focus returns to the trigger) and let the injected `select` promise settle in the background; both a resolved `false` and a thrown rejection route to `settleSelection(false)` and announce through the shared transient Toast — the wiring `index.ts` already exposes `select` as `Promise<boolean>`. While `mounted && !open` the card renders a frozen `openFrame` — state, last action, effective effort, and effort choices captured at the last open render — the last-open-snapshot rule the [motion-system note](../architecture/2026-08-14-web-motion-presence-and-recipes.md) already states for store-driven menus. Placement keeps the last measured origin: the layout effect returns early once `open` is false, so the trigger's relabel cannot re-place a closing card. The trigger stays live; its `FlipText` relabel is the settle feedback. `PopupSelectView` gates the applying row behind `APPLYING_NOTICE_MS` (160ms): a settle inside the beat never inserts the row, a slow one still earns the feedback, and once shown it persists through the frozen exit.

## Alternatives considered

**Keep the card open and freeze only the exit frame.** The card would sit open and dimmed for the whole round trip — a worse affordance than every sibling menu — and the disabled-row blur-close race remains armed on every pick.

**Suppress the `selecting` publish for picker-initiated selects.** That pushes a view concern into the directory's shared state machine and drops the busy signal other consumers read.

**Drop the applying row entirely.** A genuinely slow select would lose its only in-card feedback; the delay keeps it where it is earned.

**Buffer the settled publish until presence unmounts.** That couples store timing to a view animation; the frozen frame is the established presence pattern.

## Consequences

The composer pickers keep the same contract as every other `Menu` consumer: close on the pick, settle in the background, failures on the toast. The in-menu Retry strip is now exclusively the catalog-load surface — a rejected pick has no in-card affordance, which the `ModelSelect` header comment states. The frozen frame also absorbs unrelated mid-exit publishes (a late catalog load cannot repaint a leaving card); nothing reads it because the card is already closing. `select`'s `.then(settleSelection, …)` also closes the previous unhandled-rejection path on a thrown settle. Specs pin both sides: the model suite asserts the closing card replays pre-pick rows un-disabled with the check unmoved, and the commands suite asserts a settle inside the notice beat never mounts the applying row while a slow settle still does.

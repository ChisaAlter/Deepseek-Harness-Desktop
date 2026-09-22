# Agent Note: Stats dock stays while thinking

Status: implemented

English | [中文](2026-08-28-stats-line-running-gap.zh.md)

## Problem

StatsLine sits on `conversation.composer.dock` under the composer card and unmounts when it has no groups: no closed `step/end` and no billed `tokenUsage`. The first in-flight turn of a session is exactly that state — thinking has started, nothing has settled — so the strip and its 24px gap disappear until the step closes. The composer then jumps, and after the turn the figures appear as a new row. A later running turn that already has closed totals keeps those figures; the collapse is the empty-groups path.

## Decision

StatsLine reads `running` from the session snapshot. Idle sessions with no groups still return null. While `running` is true and groups are empty, it keeps a `data-stats-line="pending"` row with `min-height: 24px` (the padding-top plus line-height of a figures row) so the dock does not collapse. The Interface switch still maps onto `hidden` and wins over `pending`. Chunk frames do not select `running`; only the running edge is an extra paint.

## Alternatives considered

**Count the open step in the projection view.** Rejected: `sessionStats` counts closed `step/end` events by design; inventing an in-flight turn/step figure would change the whole-log contract for a layout bug.

**Live-tick LLM duration during thinking.** Rejected here: the report is that the row and its space vanish, not that the timer is stale. A ticking clock is a separate product change.

**Always reserve the dock, including idle empty sessions.** Rejected: a brand-new session with no figures still renders nothing, matching the Interface Settings empty-session rule.

## Consequences

The first thinking wait keeps the strip's height even before any number exists. After the step closes, the same row fills with counts. Idle empty sessions still show no dock. Settled figures on a later running turn stay visible.

## Testing

`chat-stats.client.spec.tsx` pins a running all-zero projection to `[data-stats-line="pending"]`, a running empty session with the Interface switch off to `hidden`, settled figures still showing while `running` is true, and the parent still not re-rendering on chunk frames.

## Related

[Interface Settings chrome visibility](../feature/2026-08-19-interface-settings-chrome-visibility.md) owns the `statsLine` switch that hides figures and keeps the gap. [Composer thinking beam](2026-08-28-composer-beam-pointer-events.md) clips bloom overflow so the filament cannot paint over this dock.

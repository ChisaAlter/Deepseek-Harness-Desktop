# Agent Note: Composer dock rows sync box width with the composer card and center their content

Status: implemented

[English](2026-08-29-composer-row-centering.md) | 中文

## Problem

The [composer peak/valley status decision](2026-08-29-composer-peak-valley-status.md) edge-aligned the dock rows (`StatsLine` and `PeakValleyRow`) with the composer card: both rows tracked `--dsh-composer-resized-width` / `--dsh-composer-card-max-width` and pinned their text to the card's left edge. Product placement then asked for two changes: the box must sync with the input card's width again, and the content must center instead of hugging the left edge.

## Decision

- **Box width syncs with the composer card**: both dock rows resolve `max-width: var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width))` — the seat publishes the resized width exactly while a width drag is committed and removes it on reset, so the boxes track window resizes and width drags with zero measuring code, and their left/right edges stay flush with the card in every state.
- **Content centers on that box**: `text-align: center` on the stats strip (block, so ellipsis still works) and `justify-content: center` on the peak/valley flex row. Pure CSS; no measuring code.
- **The transcript column joins the sync**: `ChatView`'s message column resolves the same variable, so the conversation transcript stays edge-flush with the input box too, and the wide-table breakout plus the to-bottom button's right inset derive from it. Width publishes on the conversation root (`[data-conversation-root]`, the composer card's and the message column's common ancestor) instead of the composer seat, because the seat does not contain the transcript; height publishing stays on the composer seat.

## Alternatives considered

**Message-column cap without card tracking (`--dsh-chat-content-width` only).** Rejected: the box would stop following width drags, which is exactly the sync product placement asked for.

**ResizeObserver-based mirroring.** Rejected: the seat already publishes the committed width as an inheritable custom property; an observer would add a JS round-trip per drag frame and a second source for the same fact.

## Consequences

The alignment contract for both dock rows lives here; the [peak/valley status note](2026-08-29-composer-peak-valley-status.md) links here instead of pinning its own edge-alignment text alignment. The seat's `--dsh-composer-resized-width` reading returns to the dock rows (its other consumers never stopped), now combined with centered content instead of left-aligned text. No test pins the alignment, so the change is CSS-only; the settings copy for the session-cost switch drops its route and independence clauses per product wording, and the price panel keeps full control: any model's three peak inputs are editable (unchecking 使用官方价格) and any user-priced model returns to its official column by re-checking it.

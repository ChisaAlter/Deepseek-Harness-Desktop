# Agent Note: Composer stats width alignment and the official peak/valley status row

Status: implemented

English | [中文](2026-08-29-composer-peak-valley-status.zh.md)

## Problem

The composer-dock session stats strip capped at `--dsh-chat-content-width` while the input card caps at `--dsh-composer-card-max-width` (content + 32px) and can be drag-resized to any width. The strip therefore sat 32px narrower than the card by default and never followed a width drag. Separately, DeepSeek's official peak/valley billing schedule (weekdays 09:00–12:00 and 14:00–18:00 Beijing, every other instant off-peak at its own published idle prices) was invisible in the conversation surface: nothing told a user which window a session's requests fall into, or how long until the next switch.

## Decision

**Width model.** Both dock rows (`StatsLine` and the new `PeakValleyRow`) resolve their cap as `var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width))`. The seat publishes `--dsh-composer-resized-width` exactly while a width drag is committed (`ComposerResizeHandles.applyWidth`) and removes it on reset, and custom properties inherit, so the rows track the card through window resizes and drags with zero measuring code — CSS-only, frame-exact, and identical in both states because both boxes share the bar's flex column and `width: 100%`. (The card-edge alignment decision was later reverted to message-column centering — see [the row centering decision](2026-08-29-composer-row-centering.md), which owns the alignment contract now.)

**Peak/valley row.** `PeakValleyRow` registers on `conversation.composer.dock` at `order: 1` (the stats entry stays at 0), rendering a state-colored dot, the phase label, and a second-aligned countdown to the next switch. The schedule lives in the pure module `peak-valley.ts`: the instant is shifted by the fixed UTC+8 offset (Asia/Shanghai has no DST) and read through UTC accessors; peak is weekday `09:00–12:00 ∪ 14:00–18:00`; the next switch is the first strictly-future weekday boundary among `{09:00, 12:00, 14:00, 18:00}` (every candidate is a genuine transition; weekends contribute none). The component recomputes the whole state every second on a wall-clock-aligned timer, so the boundary flip — color, label, and countdown target — lands on the tick after the boundary with no drift.

**Trigger disjunction.** The row paints while the Host-backed `ui-conversation.officialPeakValley` Interface Settings preference is on (the new `official-peak-valley` row at order 75, directly below the session-stats switch) or while the session's model route is a DeepSeek API provider (`deepseek-official`, the catalog provider `deepseek`, matched by case-insensitive substring). Both triggers disappearing hides the row; a provider fact of `null` (directory not loaded, or no model-selection plugin composed) satisfies neither trigger.

**Provider fact push.** The DeepSeek trigger reads `ctx.conversation.modelFacts` — a second per-session registry beside the composer blocks (`blocks.ts` pattern): ui-model-selection's `ModelDirectoryResolver` publishes `{ provider: current?.provider ?? null }` from the same directory-store subscription that raises and clears composer blocks, and clears the fact on scope disposal. Because every directory change (load, selection, adapters-updated, settings updates, reconnect) republishes, a model switch made in the composer seat or the /model popup repaints the row immediately with no polling, duplicated RPC, or stale cache.

## Alternatives considered

**ResizeObserver mirroring the card width into the rows.** Rejected: the seat already publishes the committed width as an inherited custom property, so CSS resolves the same constraint synchronously; an observer adds a JS round-trip per drag frame and a second source of truth for the same fact.

**ui-conversation fetching `session.models` itself.** Rejected: `selectModel` publishes only through the model directory's own store (no remote broadcast), so a parallel fetcher would keep showing the previous provider until the next adapters/settings event or menu open — violating the live-sync requirement — while duplicating the directory's refresh-trigger set.

**Publishing the provider as a host projection.** Rejected: it adds a wire schema, host unit, and client key for one client consumer, and the model directory is already the authoritative, reactive owner of the route ([the earlier rejection of delivering model facts to the stats line](../architecture/2026-07-29-projected-token-usage-and-request-context.md) was about capacity figures with no live consumer; the peak/valley row is that consumer, and the blocks push is the established direction for ui-model-selection → ui-conversation facts).

**A hardcoded provider allowlist.** Rejected: matching the `deepseek` substring covers both shipped route ids and any future DeepSeek route without enumerating them in the presentation layer.

## Consequences

The rows' alignment contract is owned by [the row centering decision](2026-08-29-composer-row-centering.md): the stats strip and the peak/valley row center on the shared message column axis in every layout state, and the row is the only surface naming the official billing window. `officialPeakValley` joins the durable `ui-conversation` settings schema (default `false` = detection-only), so the row follows the user across ports like the other chrome preferences ([the chrome-visibility decision](2026-08-19-interface-settings-chrome-visibility.md) table gains one row). An assembly without ui-model-selection leaves the DeepSeek trigger permanently off — the preference still works. The row renders only in the docked composer (the hero state renders no dock), matching the stats strip. Unit specs pin the schedule math at fixed UTC epochs (host-timezone independent), the row's trigger disjunction and boundary flip under fake clocks, the settings schema, and the fact push lifecycle. The web a11y goldens now normalize the row's phase label (`{{peakPhase}}`) and its countdown (the existing `{{clock}}` rule), so the replay lane stays stable regardless of which Beijing-time window a run lands in.

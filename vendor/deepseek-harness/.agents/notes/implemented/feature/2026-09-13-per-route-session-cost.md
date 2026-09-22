# Agent Note: Per-route session cost and the one price editor

Status: implemented

English | [中文](2026-09-13-per-route-session-cost.zh.md)

## Problem

The session-cost figure was only ever correct for a conversation that never left its first model. `billedUsage` folded the whole log into one `{peak, offPeak}` pair, and the composer strip priced that pair at the single column resolved from the newest settled assistant node's route. A conversation that switched models was therefore billed end to end at the last model's rates — and when that last model had no price, the strip read 没有设置当前模型价格 over a session whose earlier models were priced, hiding a figure it could have reported. Prices had two editors and two records besides. The harness shipped `PriceSettingsPanel`, opened from the composer strip and from the Interface Settings row; the usage panel shipped its own 计费设置 modal over its own `dsh_usage_panel_billing` storage domain. Two windows therefore edited two records, and a price set in the panel never reached the composer strip.

## Decision

**Pricing is per route, not per model id.** The `billedUsage` fold keeps its session-wide peak and off-peak totals beside one bucket pair per `provider/model` key. It tracks the dispatching route from `request/context` (the registered route) and lets a logged `request/header` override it with the `header.config` actually sent. Route, not bare model id, is the unit because two providers may serve one model id at different prices. A same-`(turn, step)` replacement — a finalized `assistant/message` usage superseding that step's earlier sample — subtracts from the row and the phase the superseded sample was filed under before adding its replacement, because a restatement can be re-attributed as well as re-phased; a row reduced to all-zero buckets is dropped rather than left behind as an empty route. `stateVersion` moves 2 → 3, so the persisted projection-cache row is discarded and every session refolds once.

**`billedCostCents(usage, customPrices)` returns a breakdown, and an unpriceable route is reported, never guessed.** The result is a `SessionCostBreakdown` of `{cents, rows, unpriced, priced}`. Every route's own buckets resolve their own columns through `resolveModelPrice` and the cents are summed; `bucketsCostCents` is the per-row primitive the sum uses. A route the record cannot price contributes nothing to the total and is named in `unpriced`. The strip shows the figure while at least one billed route is priced, appends 部分模型未定价 while any is not, and falls back to 没有设置当前模型价格 only when no billed route has a price — or, before the first sample, when the composer's upcoming route has none either. Its hover title lists one block per billed route: that route's `provider/model` identity, its own cost (`费用 ¥X.XX`, or 没有设置价格 for a route the record cannot name, whose tokens still print), its peak and off-peak consumption, and its price lines when it has a price ([subagent consumption in the session-cost figure](2026-09-13-subagent-cost-folding.md) carries the consumption lines and the delegated descendants folded into the same figure).

**The one price editor is the usage panel's 计费设置 window.** It lives in `vendor/dsh-usage-panel/src/client/BillingSettingsModal.tsx` and opens from 设置 → 消耗统计 → the 设置 button beside the export menu, and from nowhere else. The window's official-price reference table is removed: the published columns are reference material beside an editor whose job is the user's own record, and the table duplicated the price table the harness already owns. `PriceSettingsPanel` and `ModelPriceDialogHost` are deleted, and with them the composer strip's 设置价格 button, the Interface Settings row's 设置模型价格 button, the `conversation.pricing.dialog` slot, the `createModelPriceDialog()` controller, and the `modelPriceDialog` client service. Nothing outside the usage panel opens a price window, because there is no second window to open.

**The one durable price record stays `ui-conversation.sessionCostPrices`.** The composer strip reads that section, so it is the only record a price can be set in and still reach the figure, and the panel's host reads and writes that record through the settings service. The plugin's own `dsh_usage_panel_billing` domain becomes import-only: its record is merged into the conversation section once, the conversation section winning every conflicting key, and the retired record is then cleared. Every price therefore has one home, and every reader names it.

**The strip keeps no price entry of its own.** Its only controls are the session-cost switch on the Interface Settings row and the figure itself. When no billed route is priced it reads 没有设置当前模型价格 and its hover hint names where prices are set — 设置 → 消耗统计 → 计费设置 — so the row reports the gap without pretending to fix it.

## Alternatives considered

**Price the whole session at the newest assistant node's column.** Rejected: this is the reported defect. A conversation that switched models bills every earlier model's tokens at the last model's rates, and when the last model is unpriced it reports 没有设置当前模型价格 for a session whose earlier models were priced.

**Resolve a price per model id, without the provider.** Rejected: two providers may serve the same model id at different real-world prices, so a model-id key cannot name one column. The composite `provider/model` key pins one, which is also why `ModelBilledUsage` carries the provider and why a legacy bare-model price entry stays a fallback rather than the key new records are written under.

**Keep the harness editor as the one window and make the usage panel read-only.** Rejected: the product decision is one window and it belongs to the usage panel, the surface a user opens to read usage and reach for a price. Making the panel read-only keeps two windows over one record — the arrangement that produced the bug — and leaves the editor in a plugin with no other reason to own one.

**Let the harness open the panel's modal through a client service.** Rejected: it inverts the dependency. The harness cannot require a plugin, and a service provided on the panel's side would make a core settings surface depend on an optional plugin being composed, so the strip's entry point would come and go with the installation. Removing the harness editor removes the need for a cross-plugin entry point at all.

## Consequences

A conversation that switches models prices each route's own buckets at that route's own column, and the strip shows the partial sum rather than a wrong total or a blanket missing-price notice. That honesty costs a second axis in the fold's state and a client that renders a breakdown instead of a number. `stateVersion` 3 is a new generation: a persisted row from generation 2 is discarded and its session refolds from the log on first read.

One editor means one place to change a price and one place to look for it, and it is the surface that already ranks sessions by cost. The price of that concentration is a settings page that must resolve the conversation section before it can show a price, and a composer strip that cannot set one: a user who reads 没有设置当前模型价格 has to follow the hover hint out of the conversation. The retired `dsh_usage_panel_billing` record survives only as a one-time import, so prices written by the older panel appear in the record the strip reads after a single carry-over.

The added surfaces are pinned directly. `billed-usage-projection` covers route attribution, a separate row per route across a model switch, two providers serving one model id in their own rows, a superseded sample moving to the route that restated it, the logged header snapshot overriding the context route, and the wire view's per-route rows. `price-calculator` covers per-route resolution at each route's own column, the composite key winning over a legacy bare key, and routes that carry no tokens staying out. The row's specs cover the partial-price marking, the per-route hover title with its unknown-route fallback, and the row rendering no price entry of its own.

## Related

[Session cost figure and the billed-usage projection](2026-08-29-composer-session-cost.md) owns the projection unit, the official price table, the settings record, and the row this work prices per route. [Composer stats width alignment and the official peak/valley status row](2026-08-29-composer-peak-valley-status.md) owns the row's phase half and schedule.

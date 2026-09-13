# Agent Note: Subagent consumption in the session-cost figure

Status: implemented

English | [中文](2026-09-13-subagent-cost-folding.zh.md)

## Problem

A delegated subagent runs in its own Session: its Agent, its log, and its `billedUsage` projection all belong to the child. The composer strip priced `useProjection('billedUsage')` of the current Session alone, so every token a subagent spent was invisible in the conversation's figure — the more the agent delegated, the more the strip understated the conversation's real cost. The per-route hover block had the mirror-image gap: it printed a route's price columns but not what the route cost or consumed, so per-model consumption could only be read on the usage-stats page.

## Decision

**The figure sums the current Session and every delegated descendant.** Delegation is read from the sessions list the standard `useSessions` seat already exposes: a row belongs to the tree when its `origin` is `'subagent'` and its `parentId` is a Session already in the tree, walked recursively from the selected Session because a child may delegate again (`ui-conversation/src/client/chat/subagent-cost.ts`, a pure function). Each descendant is priced from its own `projectionValues.billedUsage` through the same `billedCostCents` and the same durable price record, and the strip's cents, priced, and partial flags are aggregated over every source. One total, one honesty rule: a child route the record cannot name is reported as unpriced exactly like an unpriced route of the current Session, and never re-rated at another route's column.

**The child's usage is already on the client.** `SessionListState.byId[row].projectionValues` carries every current host-computed projection value of every listed Session. The Session Controller's manager maintains that column from three existing sources — each `session.list` row's `projections` hints, the host-wide control baseline, and per-session `projection` frames — so a subagent's `billedUsage` reaches this client without the child ever being opened. A new child sample therefore moves the strip through the same store notification that already drives the list, at the same push latency as the current Session's own figure: no cross-Session subscription, no `ctx.sessions.binding` reach from a component, and no host change.

**No subagent-plugin dependency.** `origin`, `parentId`, `displayTitle`, and `projectionValues` are session-controller row vocabulary, so a program without the subagent plugin simply has no such rows and the fold finds nothing; a mount without the two seats (hand assembly, tests) prices the current Session alone. The rename for a child comes from the parent's loaded catalog label when there is one (`subagentsByParent[parent].entries`), otherwise from the child's own list row display title; a descendant whose `billedUsage` has not arrived contributes nothing rather than a priced zero.

**The detail surface reports consumption.** Each billed route prints its identity, its own cost (`费用 ¥X.XX`, or the no-price notice for a route the record cannot name, whose tokens still print because "this model ran and is not priced" is the fact being reported), its peak and off-peak consumption, and — when it has one — its resolved price columns. Token counts render as compact locale-owned counts (`number.thousand` / `number.million` via the `t` seat); the formatter lives in `price-calculator.ts` because the identical `ui-chat` one is another feature plugin's value that this package may not import. The surface is the click-opened session-cost card; [the session-cost detail card](2026-09-13-session-cost-card.md) owns its rows, and the reversal of this note's earlier per-source blocks.

**A cost row carries its own buckets.** `ModelCostRow` gains that route's `peak` and `offPeak`, so the tooltip reads one route's money and tokens from one value instead of joining `breakdown.rows` to `usage.models` by index — a positional join across two independently-built lists breaks silently the moment either order changes.

## Alternatives considered

**Read the parent's `subagentCatalog` projection for the child list.** Rejected: it is the subagent plugin's projection key, so reading it forces a type edge this package must not take; a catalog is fetched only while a UI observes it (`setSubagentCatalogOpen` / `refreshSubagents`), so the strip would lose children whenever the tree is closed; and the rows carry identity only, while the ids they add are already derivable from `parentId` plus `origin` on the session list.

**Aggregate recursively on the host and publish one tree-wide projection.** Rejected: it is unnecessary work. Every child's finished `billedUsage` is already delivered to this client for the list, so a host unit would add a projection key, a state version, and a cache generation to compute a sum the client can fold from values it holds.

**Subscribe to each child's projection face through `ctx.sessions.binding(childId)`.** Rejected: a binding exists only for a Session in scope (listed or already addressed), so children would drop out silently; and a component reaching the object layer for its data bypasses the props shares the client rules require.

**Price direct children only.** Rejected: delegation nests, and a figure that stops at depth one understates the same way the single-Session figure did.

**Collapse all sessions into one row per `provider/model`.** Reversed: [the session-cost detail card](2026-09-13-session-cost-card.md) merges every source into one route table before pricing, because the card's rows and its total must agree no matter how many children ran a model, and the question of which child billed what is answered by the folded disclosure row instead of by the route rows.

**Keep the tooltip to price columns.** Rejected: the tooltip's job is what each model cost and consumed. The price columns are the rate; the cost and token lines are the answer to the question the strip exists for.

## Consequences

The figure now answers for the whole delegation tree, so a conversation that delegated its work no longer reads cheaper than it was. The cost is a second framework seat in the row (the sessions list), a re-derivation on every list notification, and a structural comparison (`equalSubagentSources`) to keep unrelated list churn from repainting the strip. The fold is honest about what it cannot see: a descendant whose projection value has not arrived, and a mount without the sessions seat, contribute nothing — a visible undercount, never an invented figure — and the detail surface names the children the fold included through its folded disclosure row rather than by prefixing the route rows.

Verification is pinned in the package. `subagent-cost.client.spec.ts` covers direct children, grandchildren, nearest-first order, the exclusion of a sibling branch and of a plain fork, a child with no usage value, the catalog-label preference with its display-title fallback, and a lineage cycle. `session-cost-row.client.spec.tsx` covers the merged row for a model the session and a child both billed, the folded disclosure's default-collapsed summary and its keyboard expansion, an unpriced child route reporting 没有设置价格 without being folded into the subtotal, live repricing when the child reports another sample, and the absent-seat fallback. `price-calculator.client.spec.ts` covers the row carrying each route's own buckets, the fold into one row per model, and the compact token formatter.

## Related

[The session-cost detail card](2026-09-13-session-cost-card.md) owns the click-opened surface, the merge-before-pricing rule, and the folded disclosure that replaced this note's per-source blocks. [Per-route session cost and the one price editor](2026-09-13-per-route-session-cost.md) owns the per-route fold, the breakdown, the price record, and the strip this figure extends. [Session cost figure and the billed-usage projection](2026-08-29-composer-session-cost.md) owns the projection unit and the row's cost half. The session-projection subsystem page (`docs/subsystems/session-projection.md`) owns the projection delivery the list column mirrors.

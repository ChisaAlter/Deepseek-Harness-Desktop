# Agent Note: Cross-session usage calendar for the settings page

Status: implemented

English | [中文](2026-08-17-usage-stats-settings-page.zh.md)

## Problem

The settings surface had no trailing-window view of token spend, human prompts, or model mix. Existing `tokenUsage` and `sessionStats` projections are whole-session totals, so they cannot drive a GitHub-style heatmap or a per-day stacked bar. Pulling every session log through `session.history` from the browser would load the full event stream for every cold session.

## Decision

A host function plugin `@deepseek-ai/dsh-usage-stats` registers the `usageDaily` projection unit and provides `ctx.usageStats`. The fold records timestamped, turn/step-deduped usage samples and human `user/message` times; it does not bucket by local calendar day. `usageStats.summarize({ rangeDays, timeZone })` cuts those samples into a 7- or 30-day DTO using the client's IANA zone.

The wire method is `usage.summary`. Absence of the service is `usage-stats-absent`, never HTTP 500. The web settings section `usage` (order 15) in `@deepseek-ai/dsh-client-ui-settings-usage` renders the DTO: six cards, a Sunday-leading heatmap, stacked daily bars, and a model donut. Charts use `--dsw-alias-chart-1..5` and `--dsw-alias-chart-empty`; the page does not import a chart library.

Live sessions win. Cold sessions use the projection cache, then a fail-soft concurrent `readFrom` restore. Token, message, and heatmap totals include subagent children; `sessionCount` counts only root sessions that have a human prompt in the window. The DTO reports tokens, not currency.

## Alternatives considered

**Reuse `tokenUsage` / `sessionStats` as the page source** — rejected. Those units are whole-log sums without day or model axes, so they cannot produce the heatmap or stacked bars.

**Fold the calendar in the browser from `session.history`** — rejected. A settings open would parse every cold log on the client and stall the panel.

**Bucket the projection by UTC day** — rejected. A later America/Los_Angeles cut would assign late-UTC samples to the wrong civil day.

**A sidebar-owned full page** — rejected for this change. The settings slot already hosts feature pages; a new shell route would widen the information architecture without unlocking data the RPC cannot serve.

**Estimated spend from a built-in price table** — deferred. The repository has no model prices, and the requested UI is token volume.

## Consequences

The web-app bundle mounts both the host plugin and the settings section. Assemblies without `usage-stats` keep working: the RPC refuses with `usage-stats-absent`, and the page shows the load failure. Cold sessions without a cache row pay a bounded `readFrom`; a failed read counts that session as empty. Adapters that omit usage contribute 0 tokens while still counting prompts. A later year-long heatmap can reuse the same timestamped samples without a fold change.

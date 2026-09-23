# Decision: Compact usage calendar and repair session identity

Status: implemented

[中文](2026-09-23-usage-calendar-repair.md) | English

## Problem

At a Settings content width of about 520px, the old heatmap used weeks as flexible columns and weekdays as rows. A 31-day month stretched individual days to roughly 90px squares and pushed the card below the viewport. Month arrows could not select a date range.

The repair RPC limited scan-reported session IDs to hexadecimal characters and hyphens, although desktop sessions also use IDs such as `session-whale-<uuid>`. It rejected those requests as `invalid session id` before locating an artifact.

## Decision

- Use a calendar with fixed 24px day cells, weekdays as columns, and weeks as rows. Select a month with the existing SettingsSelect atom and UTC start/end dates with Input. Show token and active-day totals for selected dates. The filter applies only to this calendar; all-time KPIs, session rankings, and the separate daily chart retain their existing scopes.
- Let repair RPC accept safe single-path IDs explicitly reported as failed by the current scan, without assuming hexadecimal IDs. Artifact discovery prefers the exact persisted ID and retains the legacy bare-UUID-to-`session-` lookup.
- Repair only listed failures. Keep the backup, highest canonical generation, and atomic replacement contracts.

## Alternatives considered

- Keep flexible week columns and cap the card height: day cells would still swell, while scrolling would hide date context.
- Keep only month arrows: users still could not select actual dates.
- Maintain an allowlist of session ID prefixes: the next plugin prefix would repeat the failure.

## Consequences

The filter covers only the heatmap's 182-day data, preserving the scopes of other totals. Repair is tied to a real scan identity, so arbitrary RPC IDs cannot reach log artifacts. The calendar needs narrow-panel and dark-theme checks.

## Verification

`session-whale-<uuid>` and bare UUID artifacts resolve. RPC IDs absent from the failure list or containing path separators are rejected. The calendar has no oversized day cells or horizontal overflow in a narrow Settings panel. Date controls stay within the latest 182 UTC days and update the month summary.

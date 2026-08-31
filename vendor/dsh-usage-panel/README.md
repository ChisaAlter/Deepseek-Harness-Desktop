<div align="center">

# dsh-usage-panel

Token usage statistics for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), shown as a page under **Settings → Usage** in the web GUI. The plugin aggregates persisted session logs (incrementally, via the session-projection mechanism) and never writes anything back.

[简体中文](README.zh-CN.md) · [![npm](https://img.shields.io/npm/v/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![npm downloads](https://img.shields.io/npm/dm/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![CI](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml) [![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin) [![Mentioned in Awesome DeepSeek Harness](https://awesome.re/mentioned-badge.svg)](https://github.com/0xsline/awesome-deepseek-harness)

<img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/demo.gif" width="620" alt="dsh-usage-panel v0.2 demo: loading, KPI count-up, heatmap entrance wipe, hover tooltips and range switching" />

</div>

## What it shows

- **Cumulative totals (all time)** — billed input / output tokens, session count (with the grand total of session records and the main/subagent usage split beneath it), and the most-used model with its share.
- **Cache hit rate** — `cache read ÷ (uncached input + cache read + cache write)`, with the read/write magnitudes.
- **Estimated cost (all time)** — a per-model priced estimate with a peak/off-peak split; see [Costs and pricing](#costs-and-pricing).
- **Activity heatmap** — one UTC calendar month at a time (GitHub-contribution layout: weeks as columns, weekdays as rows), with ‹ › to pick any month inside the last-six-months data window. Days are colored by quartile over that month's non-zero usage.
- **Daily stacked bars** — per-model token usage, switchable between the last 7, 14, or 30 days.
- **Top sessions** — the 10 most token-hungry sessions with their folded titles, each tagged **main** or **subagent** by delegation depth and carrying an estimated cost column.
- **Providers** — per-provider token totals as horizontal bars (shown when more than one provider route is in use).
- **Model donut** — all-time share per model, with the top 5 listed beside it; each row carries a per-model **cache hit rate** column, color-coded to its segment.
- **Export** — full JSON, daily CSV and per-model CSV (formula-injection guarded, RFC 4180, UTF-8 BOM; cost columns in integer cents).
- **Composer cost strip** — under the chat input box: the current peak/off-peak phase, the countdown to the next switch, and the current session's estimated cost (hover shows the current model's price row). Width follows the composer card's drag-resize (`composerResize`, falling back to the resting card cap). Toggleable from the usage panel's **Settings** button.
- **Billing settings** — a modal next to Export: strip visibility, the global peak/valley switch, and per-model custom prices (model list synced from the host provider directory + usage).

Hovering a bar, heatmap cell, or donut segment shows the exact breakdown:

| Bar tooltip | Overview (KPI + heatmap) | Sessions & providers |
| --- | --- | --- |
| <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-hover-bar.png" width="200" alt="Bar hover tooltip" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-overview.png" width="200" alt="KPI cards and heatmap overview" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-sessions.png" width="200" alt="Session ranking and provider breakdown" /> |

## Install

The plugin ships as a bundle: `dsh plugin add` appends it to the profile's bundle list, and the patch row activates the host half.

```sh
# from npm (recommended)
dsh plugin --profile web add dsh-usage-panel

# or from GitHub
dsh plugin --profile web add github:AlfredChaos/dsh-usage-panel

# or from a local checkout
dsh plugin --profile web add ./dsh-usage-panel
```

Restart `dsh --profile web` and open **Settings → Usage**. The npm package ships prebuilt JavaScript under `lib/` with no install scripts; GitHub installs need no pnpm build allowance either, because the same files are committed to the repository. To remove it:

```sh
dsh plugin --profile web remove dsh-usage-panel
```

## Where the numbers come from

The host half aggregates persisted session logs:

- **Primary path (incremental)**: a session projection (registered through `ctx.sessionProjections`, `stateVersion`-checked) folds every committed event into four disjoint buckets — uncached input, output, cache read, cache write — plus per-model, per-provider and per-day (UTC) maps. Checkpoints are durable, so restarts and keep-warm passes cost almost no replay.
- **Fallback path (full rescan)**: when the projection services are unavailable, the same reducer replays every session log through the read-only `sessionQuery` service.

Accounting rules: `request/header` and `request/context` events record the model (context base, header override); the step's `assistant/message` usage replaces streamed provisional usage (a retried same-step message never double-counts); `llm/retry` events are counted as retries, not tokens; `compaction/summary` usage is attributed to its own model and reported separately (and never enters the cost buckets); reasoning tokens are already inside output and are never added again.

**Fork dedup**: events that precede the last `session/end-seed` marker (fork/resume/replay seed history) are never counted, so forked sessions do not double-bill their parents' usage.

**Timezone declaration**: day buckets and exports use **UTC** calendar days (`YYYY-MM-DD`); the heatmap subtitle declares the selected month and UTC (e.g. "Aug 2026 · UTC"). Billing phases use **Beijing wall time** (UTC+8, DST-free) — see [Costs and pricing](#costs-and-pricing).

Because nothing is written back, statistics survive restarts and cover sessions from before the plugin was installed.

## Costs and pricing

All money figures are **estimates, never a bill** — the plugin has no access to the DeepSeek billing system, and the numbers are computed locally from your usage.

- **Periods (official)**: peak = Monday–Friday 09:00–12:00 and 14:00–18:00 Beijing; every other instant (weekends, evenings, nights, the noon break) is off-peak at the official idle rate. Off-peak prices are published as half of the peak rate.
- **Official price table**: data file with `asOf 2026-08-17` and the source link (DeepSeek API docs), pinned by unit tests. Models: `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`; hit / miss / output × peak / off-peak.
- **Per-step classification**: a whole request (step) bills at its `step/start` instant — a step straddling a phase boundary is charged entirely at its start phase. Compaction never enters cost buckets.
- **Pricing**: per-model, applied client-side from the period buckets — changing a price recomputes every figure instantly and never refolds logs. Resolver order: your custom price (provider-scoped key first, bare-model legacy fallback) → the official column → **not priced**. An unpriced model shows "set a price" / an em dash, never a guessed figure; non-DeepSeek models need a custom price before any cost appears.
- **Custom prices**: edited in the usage panel's Settings modal (per model: cache-hit, cache-miss, output; optional explicit off-peak column; optional per-model "peak/valley off"). Persisted in a **plugin-owned JSON record** (storage-domain slot `dsh_usage_panel_billing`), never in session logs.
- **Peak/valley switch**: global — off bills both periods at the peak column.
- **Math**: integer micro-yuan with a single rounding to whole cents; cost columns in CSV exports are integer cents (empty when a row is unpriced).

**Upgrade note (v0.3)**: the projection state version moved to 2; your first start after upgrading refolds each session's log once (in paced batches that keep the host responsive — a huge corpus is not a freeze, the page shows "updating in background"), and afterwards reads stay incremental.

## Loading behavior

The first scan starts as soon as the plugin loads, so the page usually renders straight from cache. A payload is considered fresh for 10 minutes; older ones are returned immediately with a `stale` flag (the page shows "updating in background") while a rescan refreshes the cache. A keep-warm timer rescans every 10 minutes, and the refresh button always forces a synchronous scan. The browser additionally keeps the last successful payload in `localStorage` (versioned and structure-validated), so a page refresh renders instantly; a failed refresh keeps the cached numbers and says so instead of faking freshness.

## Units

zh interface: integers below 10⁵; `万` from 10⁵; `亿` from 10⁸. en interface: K / M / B.

## Implementation

Source is TypeScript (strict) in `src/`, built with esbuild; the `lib/` outputs are committed so installs need no build step.

| File | Role |
| --- | --- |
| `src/host/index.ts` → `lib/index.js` | Host half (Cordis plugin): projection registration, aggregation, cached RPC with warm-up, fail-soft fallback, billing RPC endpoints |
| `src/host/projection.ts` | Pure per-session projection reducer (four buckets + period buckets, fork dedup, retry/compaction semantics, UTC days, step/start phase) |
| `src/host/aggregate.ts` | Cross-session merge → overview payload (cost maps included) |
| `src/host/billing-store.ts` | Durable billing preferences (plugin-owned JSON via storageDomain; fail-soft memory) |
| `src/client/*` → `lib/client.js` | Client half (`./client` export, `__ModuleLoader__` bundle): settings-page UI, settings modal, composer cost strip in TSX, `--dsw-*` tokens, zh/en i18n |
| `src/shared/contract.ts` | Host↔client wire contract (single source of truth) |
| `src/shared/pricing.ts` | Official price table (asOf + source), resolver, price parsing |
| `src/shared/billing.ts` | Peak/valley window math + countdown |
| `src/shared/cost.ts` | Integer cost math (micro-yuan → cents) |
| `cordis.patch.yml` | Bundle patch: inserts the `usage-stats` row into the profile composition |

The host serves an `overview` endpoint through `ctx.connection.rpc.handle('/usage-stats', …, { authority: 'loopback' })`; the browser calls it via `rpc.call('/usage-stats', 'overview', …)`. The overview carries `coverage` (session-record totals and the main/subagent usage split, shown beneath the sessions KPI), `topSessions`, `providers`, plus the v0.1.0-shaped `days` / `totals` / `byModel` / `allTime`. Developed against DeepSeek Harness `0.1.0-rc.6`. Tests run on the Node built-in test runner (`npm test`); CI runs typecheck + build + test + the pack gate.

## License

[MIT](LICENSE)

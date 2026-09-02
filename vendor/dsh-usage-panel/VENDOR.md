# Vendored dsh-usage-panel

Desktop snapshot of the MIT plugin used for Settings → 用量统计.

- Source: https://github.com/AlfredChaos/dsh-usage-panel
- Upstream commit: `12ac109bc6213bdbca539e3199e7338fcac020ed`
- npm version: `0.2.0`
- License: MIT (`LICENSE`)

Runtime dependency: `zod` (installed into this package's `node_modules`).

## Local modifications

- Client esbuild `external`: `react` and `@deepseek-ai/dsh-client-ui-primitives`. `apply` skips section registration when `Button` / `Menu` are missing (`missingPrimitives`).
- Nav label is 「用量统计」 / `Usage stats`.
- Heatmap ramps, chart `PALETTE`, provider bars, and subagent tags use `--dsw-alias-*` / `--dsw-static-deepseek-*` / `color-mix` only. No `[data-ds-dark-theme]` in feature CSS.
- Refresh and export use host `Button` / `Menu`. Pointer-follow chart tips stay self-drawn and tokenized (official `Tooltip` is an anchored string bubble).
- Type 16/24, 14/22, 12/18; weights 500/600/700; spacing multiples of 4; shadows `lv1`–`lv3`. Motion is opacity/transform.
- `scripts/build.mjs`, `wrap-client.mjs`, and `run-tests.mjs` use `fileURLToPath` so Windows can rebuild `lib/` and run tests.
- Day buckets stay UTC (`stateVersion` unchanged).
- Projection unit uses current `stateSchema` + `wire` (not host-only `schema`/`view`); `inject` waits for `sessionProjections` / `sessionQuery` / `sessionProjectionCache` before `register`. Missing `usagePanel` cells stay pending — no jsonl replay.
- zh `fmtTokens` stays integer until 10万; empty UI only when billed `sessionCount` is 0 and `sessionsFailed` is 0 (blank-only sessions included; scan failures still show the dashboard).
- Heatmap h0 uses tokenized `color-mix` plus inset `border-l2` so empty cells are visible in light theme; legend includes the empty level.
- **v0.3 billing (local features)**: projection `stateVersion` 2 with period buckets (`costTotals`/`costByModel`/`costByDay`/`costByProvider` + `modelProviders`) — the desktop harness's projection cache discards v1 rows, so the upgrade refolds each session once (paced). Billing RPC: `session.cost` reads the live registry via a local structural cast (`stateOf` is missing from the npm rc.6 type face), `billing.get/set` persist a plugin-owned JSON record through `ctx.storageDomain` (domain `dsh_usage_panel_billing`, `UNIT_NAME_RE`-conform); the store starts in memory and attaches post-open (never awaits in `apply`). Client registers a settings Modal (`ui-primitives` shim extended) from the toolbar's 设置 button; `costCentsFor` gained a `peakValley` switch. The v0.3 composer cost strip (a second `conversation.composer.dock` entry) was removed on 2026-09-02: the harness's own `ui-conversation` `PeakValleyRow` already paints the same phase/countdown/session-cost line, and both mounted together after the pr-76/pr-79 merge. The billing record schema keeps `stripVisible`/`peakHintVisible` as optional legacy fields so v0.3 records still parse; the client no longer reads or writes them. The official `@deepseek-ai/dsh-billing-shared` package is NOT used (absent from this harness snapshot) — its price/phase math lives in `src/shared/{pricing,billing,cost}.ts` with parity-locked unit tests.
- **Session-log auto-repair (desktop-only)**: `repair.session` rewrites ONE damaged artifact the framework flagged (decode all rows via runtime `decodeStorageRecord`, 0-based continuous renumbering, re-pack chunk runs, zstd header+event frames, atomic replace after a timestamped backup). No runtime import at module load: the harness codec is imported dynamically inside the repair path, so the standalone npm package degrades gracefully. The zstd frame scanner is a port of the persistence backend's (MIT) because that package does not re-export its helpers.
- **Paged rankings**: `sessions.more` / `projects.more` slice a full in-memory session index (ranked by tokens or by cost with the user's current prices); `projects` groups by session `cwd`.
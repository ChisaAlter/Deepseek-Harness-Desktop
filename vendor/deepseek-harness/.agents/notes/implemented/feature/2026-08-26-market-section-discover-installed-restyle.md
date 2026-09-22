# Agent Note: Market section Discover/Installed restyle

Status: implemented

English | [中文](2026-08-26-market-section-discover-installed-restyle.zh.md)

## Problem

The first slice of the desktop-owned market section ([2026-08-25](2026-08-25-desktop-owned-market-section.md)) shipped a single flat page: hand-rolled search input and category chips, a bare two-column card list with no owner identity, no homepage link, no deprecated marker, and no installed-management view. Users coming from the retired `dshmarket` plugin read it as a downgrade — the original market had a Discover/Installed tab pair, owner avatars, star counts, and category tags. The desktop QA walk (`release-ui-walk.js` steps `market.discover` / `market.installed`) still asserts that tabbed structure, so the flat page also failed the desktop `qa:source` gate.

## Decision

Restyle `ui-settings-market` to the official settings language at the original market's UX density, without restoring the plugin:

- **Structure**: a 16/24 section heading with intro line and a 28px refresh icon action (the `McpSection` pattern, `aria-label` + matching `title` for hover text; disabled and relabeled 刷新中… while a reload is in flight), then a `Pill` tab pair — 发现 (Discover) and 已安装 (Installed, label suffixed with the installed count). The tabs carry stable ids (`market-tab-discover` / `market-tab-installed`) with `aria-controls` pointing at the single rendered pane, which is a `role="tabpanel"` with a matching `market-panel-*` id and `aria-labelledby` back to its tab. Panes swap under the official `data-dsh-motion="swap"` recipe keyed by tab.
- **Discover**: `Input` primitive search (replacing the hand-rolled box), `Pill` category chips (keeping the `radiogroup`/`radio` semantics, with their own 分类 group label), a warning banner with `IconWarningOutline16`, a result-count line (`data-market-count` retained), and an auto-fill 280px card grid. Each card shows the owner's GitHub avatar (`https://github.com/<owner>.png`, browser-cached, initial-letter fallback on error — the upstream dsh-market approach), repo name, ★ star count, two-line clamped description, localized category tag, a deprecated badge from the catalog's `deprecated` flag, and a homepage link the desktop window handler routes to the external browser. Installed rows show a success-colored marker plus ghost Uninstall (also when the row is deprecated); other rows show a primary Install only when installable — deprecated rows and rows whose engine resolved an empty `installSpec` offer no install path from the card, matching the main-process install gate (`installMarketplacePlugin` rejects deprecated rows and unresolvable specs before the CLI). Installed↔catalog matching prefers an exact `packageName` hit and otherwise uses `spec-match.ts`'s boundary-safe owner/repo segment match, so `github:acme/demo-extra` no longer false-matches catalog `acme/demo`.
- **Installed**: profile rows grouped by catalog category in catalog order, uncatalogued rows under 未分组/Ungrouped last, hairline row list (border-l1 top/bottom, interactive hover token) with name, spec in code face, a 已退役 badge on `DROPPED` rows, and per-row uninstall. Empty state points back to Discover with the upstream copy the QA walk keys on.
- **Tokens only**: every color is a `--dsw-alias-*` token; the two references to the nonexistent `--dsw-alias-state-warning-primary` (silently falling through to their fallbacks) were corrected to `--dsw-alias-state-warn-primary`.
- **Failure retention**: a catalog reload that throws keeps the catalog already on screen and renders a retryable `role="alert"` row above the tabs (the marketplace failure convention); only the very first load lands on the bare error state.

The inject face, IPC channels, and install/uninstall/allow-builds/progress flows are unchanged; deferred v1 features (theme shop, backup, diagnostics, hot update, multi-registry, trial) stay cut.

## Alternatives considered

- **Keep the flat page and patch the QA walk instead** — rejected: the walk encodes the product's expectation (discover/installed) and the flat page was the complaint.
- **Port the dshmarket pager/detail dialog/screenshot strip** — not needed at curated-catalog scale; screenshots stay available on the item type if a detail view lands later.
- **A custom underline tab bar like upstream dshmarket** — rejected for the `Pill` primitive; the design language forbids a second tab skin.

## Consequences

Settings → 市场 now reads as an official settings page with the original market's information density. The desktop QA walk's `market.discover` / `market.installed` steps match the section again (Discover tab label, Installed tab with count suffix, `installedEmpty` / 未分组 copy). Avatar images are the only new network fetches, load lazily from `github.com`, and degrade to a local initial tile.

## Testing

`packages/client/ui-settings-market` vitest: 4 files, 40 tests passed — `market-section.client.spec.tsx` 27 (tab pair and count suffix, tab/tabpanel ARIA linkage, per-card owner/stars/category/homepage, avatar error fallback, deprecated and dropped badges, install gating for deprecated and empty-`installSpec` rows, installed-deprecated uninstall, refresh label/title, in-flight refresh disable/relabel, refresh-failure catalog retention with retry, allow-builds cancel, boundary spec-match behavior through the installed marker and grouping, warning + result count, installed grouping order, installed-tab uninstall, and the empty-installed copy, alongside the search/filter/install/allow-builds/progress/failure specs), `spec-match.client.spec.ts` 8 pure-function cases, plus the browser-plugin (4) and invariant (1) suites. The desktop-side deprecated install rejection is pinned by `src/main/marketplace-install.test.js`. The desktop `qa:source` release walk ran green end-to-end against the restyled section (`market.section` / `market.discover` / `market.installed` PASS, Linux xvfb source run).

# @deepseek-ai/dsh-client-ui-settings-market

English | [中文](README.zh.md)

Desktop-owned **plugin marketplace** settings section (id `market`, nav label **市场** / **Marketplace**). The browser plugin registers a `settings.section` contribution only when Electron `window.shell` exposes `listMarketplace`, `listInstalledPlugins`, `installMarketplacePlugin`, `uninstallPlugin`, and `onPluginProgress`. A plain `dsh web` browser has no section. The section splits into a **Discover** tab and an **Installed** tab (its label carries the installed count). Discover renders the curated catalog the desktop main process fetches from plugins.json (with cache/snapshot fallback and its `warning` line shown as-is), a search box, category chips, a result count, and one card per row: the owner's GitHub avatar (initial-letter fallback, no API call), repo name, star count, two-line description, localized category tag, a deprecated badge, a homepage link (the desktop window handler routes it to the external browser), and an Install action or an installed marker plus Uninstall — deprecated rows and rows whose engine resolved no install spec offer no Install button (the desktop engine rejects those installs too). Installed groups the profile's plugin rows by catalog category — uncatalogued rows land under 未分组/Ungrouped — showing each row's install spec, a retired badge on `DROPPED` rows, and per-row Uninstall; when nothing is installed it points back to Discover. Install passes only the registry `owner/name` id to the desktop engine, which resolves and validates the CLI spec, writes into the desktop `dsh-home/profiles/web`, and restarts Harness; progress lines from `shell:plugin-progress` stream into a bounded log. A `needsAllowBuilds` result opens an inline approval (`role="alertdialog"`) listing the exact allowBuilds keys before retrying. Failures render as `role="alert"` text — including the profile-written-but-Harness-down case — never silently. A failed catalog reload keeps the catalog already on screen and shows a retryable alert; only the very first load may land on the bare error state, and the refresh control is disabled and relabeled while a reload is in flight.

This section replaces the third-party `dshmarket` plugin the desktop used to preset-install: the marketplace UI and engine are both desktop-owned now, and the desktop keeps `dshmarket` out of its mounted composition so two `market` sections cannot register. The section reads and writes only through the injected desktop callbacks and imports no other UI plugin's values.

## Model Experience

None, as this package only manages plugin installation from a curated catalog and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Marketplace is desktop-only** — the catalog fetch, install lock, and CLI live in the Electron main process.
- **First slice of the desktop-owned market** — upstream dshmarket's theme shop, backup/Gist, diagnostics, hot updates, and multi-source management are not ported; the deferred list lives on the desktop feature card `marketplace-settings`.
- **Installed detection is name/spec based** — an exact `packageName` hit wins; otherwise the stored spec is matched as a whole `owner/repo` path segment (`spec-match.ts`), so a renamed github install still matches while longer repo names (`owner/repo-extra`) do not.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.

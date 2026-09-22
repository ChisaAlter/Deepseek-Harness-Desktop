# Agent Note: Desktop presets dshmarket

Status: implemented — **reversed by [Desktop-owned marketplace section](2026-08-25-desktop-owned-market-section.md)**; the desktop no longer preset-installs dshmarket.

English | [中文](2026-08-19-desktop-dshmarket-preset.zh.md)

## Problem

The desktop clone of the marketplace (`settings.plugins.tab` id `marketplace`) was not [dsh-market](https://github.com/dsh-market/dsh-market). A first-boot `dsh plugin add dshmarket` still needs the npm registry and fails closed for offline users.

## Decision

**Deepseek-Harness-Desktop ships the published `dshmarket` 1.14.0 package source in `vendor/dshmarket`.** electron-builder `extraResources` copies it with `{ from: "vendor", to: "vendor", filter: ["dshmarket/**"] }` so the plugin's `node_modules` is not the copy root (a copy rooted at `vendor/dshmarket` drops that directory's `node_modules`). Packaged runtime dependencies come from `afterPack`, not from a git-complete `node_modules`: if the packaged plugin is missing a declared dependency or that dependency's `exports` / `module` / `main` file, `afterPack` copies `vendor/dshmarket/node_modules` from the project tree when present, then wipes the packaged `node_modules` and runs `npm install --omit=dev --ignore-scripts` (`npm ci` when `package-lock.json` is present). Pack fails unless those entry files exist. `setup:harness` runs the same install into `vendor/dshmarket` when that tree is incomplete. Before `dsh.start()`, `ensureDshMarketPlugin` copies that tree into the web profile `desktop-plugins/dshmarket`, junctions `node_modules/dshmarket` at the copy when that path is not already a real directory, and upserts a managed `cordis.patch.yml` insert (`id: dsh-market`, `name: dshmarket`). It does not run `dsh plugin add`. A missing bundled `package.json`, declared dependency, or dependency export file is logged, strips the managed insert, and does not abort Harness start or overwrite an existing profile copy. If the profile already lists `dshmarket` in `dsh.profile.bundles`, the copy still refreshes `desktop-plugins` and the managed insert is stripped so the Loader does not see two `dsh-market` rows.

**There is no cloned marketplace tab.** `ui-settings-plugin-inventory` registers only the Plugin list tab (`id: 'all'`). The market UI is `dshmarket`'s `settings.section` with id `market` (`MarketSection` plus `/dsh-market/*` on the Harness origin).

**Tray and menu `openMarketplace()` jump to that section.** They show the main window and run `openHarnessSettings('market')`. When Harness is not loaded, the call records a pending jump and never creates a marketplace `BrowserWindow`.

Main-process catalog fetch and `installMarketplacePlugin(id)` stay for Host `install_dsh_plugin` and IPC callers; they are not the Settings marketplace UI. That Host path remains [Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.md).

## Alternatives considered

- **Copy `MarketSection.tsx` into `ui-settings-plugin-inventory` and keep the Plugins tab** — still a fork of their UI, and client per-file coverage would own a 100k-line third-party page.
- **Keep the clone tab beside `dshmarket`'s section** — two markets in Settings.
- **First-boot `dsh plugin add dshmarket`** — needs npm, and a failed add leaves Settings without a market.
- **Add `dshmarket` to the official web profile template** — only stock bundle lists would gain it; user-owned lists would not.
- **Copy extraResources from `vendor/dshmarket`** — electron-builder treats that directory's `node_modules` as a copy-root `node_modules` and omits it, so packaged `lib/net.js` cannot `import 'undici'`.
- **Ship git-tracked `vendor/dshmarket/node_modules` as the packaged runtime** — the repo `dist/` ignore re-ignores `js-yaml`'s `exports.import` file `dist/js-yaml.mjs` after the `node_modules` exception, and asserting only `node_modules/<dep>/package.json` accepts that tree.

## Consequences

Settings → 插件市场 is the bundled plugin, as its own nav row, not a tab under 插件. Unofficial `dshmarket` CSS ships with that package. App updates refresh the profile copy. A pnpm-installed `node_modules/dshmarket` directory is left in place. `--skip-user-plugins` recovery omits the user patch insert until a full plugin start.

## Testing

`src/main/dshmarket-preset.test.js` pins copy plus managed insert, refresh of the copy, skip/strip insert when `dsh.profile.bundles` already lists `dshmarket`, leave a real `node_modules/dshmarket` directory, fail closed on a missing bundled `package.json`, missing runtime `node_modules/<dep>`, or missing dependency export file, copy of bundled `node_modules`, nested `extraResources` from `vendor` with `dshmarket/**`, the vendored 1.14.0 package source, and that `.gitignore` does not ignore `vendor/dshmarket/node_modules/**/dist`. `src/main/after-pack.test.js` pins restoring dropped plugin `node_modules`, rejecting a packaged tree that lacks a dependency or its export file, accepting a hoisted nested dependency, `npm install` when those files are missing, and skip when they exist. `src/main/harness-controller.test.js` pins the preset after the desktop install plugin and before `dsh.start()`, and a failed preset that still starts Harness. `src/main/window-marketplace.test.js` pins `openMarketplace` injecting `settings.section` id `market` and never loading `marketplace/index.html`. `ui-settings-plugin-inventory` `browser-plugin.client.spec.tsx` pins no `marketplace` tab when `window.shell` is present.

## Related

- Reversed by: [Desktop-owned marketplace section](2026-08-25-desktop-owned-market-section.md)
- [Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.md)

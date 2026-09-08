# Agent Note: Desktop-owned marketplace section

Status: implemented

English | [中文](2026-08-25-desktop-owned-market-section.zh.md)

## Problem

[Desktop presets dshmarket](2026-08-19-desktop-dshmarket-preset.md) shipped the third-party `dshmarket` 1.14.0 package as a desktop preset: copied into `desktop-plugins/dshmarket` before every start, registered through a managed `cordis.patch.yml` insert, packaged via `extraResources` plus an `afterPack` npm install. The desktop product owner decided the marketplace should be **desktop-owned code detached from that upstream**: no default-installed third-party plugin, no live dependency on the `dshmarket` package.

## Decision

**This reverses the 2026-08-19 preset decision.** The Settings marketplace is desktop-owned on both sides:

- **UI**: `packages/client/ui-settings-market` (`@deepseek-ai/dsh-client-ui-settings-market`), a desktop fork package registered in the web-app bundle (patch row `ui-settings-market`, dependency, `tsconfig.client.json` reference) and pinned by the desktop's `harness-desktop-forks.js` registry. It registers `settings.section` id `market` only when the desktop preload exposes the catalog, installed-list, update-check, install, update, uninstall, and progress methods; a plain `dsh web` browser has no section. The section provides catalog browse/search/category chips, install by registry id with progress lines and inline `needsAllowBuilds` approval, version/commit updates, uninstall, and loud failures (including profile-written-but-Harness-down).
- **Engine**: the desktop main-process curated catalog, update detector, and shared mutation lock (`marketplace-catalog.js` / `marketplace-updates.js` / `marketplace-install.js`) are the single install and update path; Harness restart stays with HarnessController through `restartAfterProfileWrite`. The later [Desktop marketplace version updates](2026-09-07-desktop-marketplace-version-updates.md) decision restores version/commit updates without restoring the third-party runtime or HMR system.
- **Preset teardown**: `ensureDshMarketPlugin` is gone. Every start runs `removeDshMarketPreset` (managed patch block, `desktop-plugins/dshmarket` copy, preset symlink; user installs stay on disk). `dshmarket` joins the desktop `DROPPED` list so the Loader never mounts it — including a user's old copy — which is what guarantees a single `market` section; the catalog hides it and installs of it are rejected. Packaging drops the `extraResources` filter, the `afterPack` dshmarket steps, and the `setup:harness` install; the tracked `vendor/dshmarket/node_modules` is deleted and `vendor/dshmarket` stays only as a marked MIT reference tree (`DESKTOP-FORK.md`).

## Alternatives considered

- **Keep preset-installing dshmarket** — the previous decision; leaves the product's main extension surface owned by a third-party package the desktop cannot edit.
- **Port the whole dshmarket client (5.8k lines) in one step** — theme shop, backup/Gist, diagnostics, hot updates, and multi-source management have no desktop engine backing yet; the deferred list lives on the desktop feature card `marketplace-settings`.
- **Leave user-installed dshmarket mounted beside the new section** — two `market` `settings.section` registrations; rejected in favor of `DROPPED` (files stay, composition does not mount it).

## Consequences

Settings → 市场 renders the desktop-owned section on desktop only. Old dshmarket installs stop loading but keep their files. The marketplace UI now follows the official settings token/primitives language instead of the third-party CSS. `dshmarket` cannot be installed from the catalog.

## Testing

Desktop repo: `src/main/dshmarket-preset.test.js` pins removal semantics, the `DROPPED` row, packaging exclusion, and the marked reference tree; `harness-controller.test.js` pins cleanup order (after desktop-install, before start) in normal and skip-user-plugins starts; `harness-desktop-forks.test.js` pins the new package, its composition row, and the bundle registration against the real vendor tree. This repo: `ui-settings-market` client specs pin desktop-gated registration, catalog rendering, search/category filters, install/uninstall flows, allowBuilds retry, and progress streaming.

## Related

- Reverses: [Desktop presets dshmarket](2026-08-19-desktop-dshmarket-preset.md)
- Engine: [Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.md)
- Partial reversal: [Desktop marketplace version updates](2026-09-07-desktop-marketplace-version-updates.md)

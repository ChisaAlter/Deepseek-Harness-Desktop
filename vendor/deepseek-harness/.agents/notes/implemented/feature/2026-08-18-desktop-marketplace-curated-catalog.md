# Agent Note: Desktop marketplace curated catalog

Status: implemented

English | [中文](2026-08-18-desktop-marketplace-curated-catalog.zh.md)

## Problem

Host `installPlugin` accepts only `github:owner/repo[#ref]`. The awesome-dsh-plugin registry includes npm and `#path:` rows that cannot go through that Host channel. Desktop therefore keeps a curated catalog fetch and an `installMarketplacePlugin(id)` whitelist for Host / IPC callers, separate from the product Settings market UI.

## Decision

**Product marketplace UI is not this tab.** Settings → 插件市场 is the preset `dshmarket` plugin (`settings.section` id `market`), owned by [Desktop presets dshmarket](2026-08-19-desktop-dshmarket-preset.md). This note owns the main-process curated catalog and the Host / IPC install whitelist. There is no `settings.plugins.tab` with id `marketplace`. Tray and menu `openMarketplace()` still never create a marketplace `BrowserWindow`.

**The catalog is `https://awesome-dsh-plugin.com/plugins.json`.** The main process fetches it (`DSHD_MARKETPLACE_REGISTRY_URL` in tests). Timeout is 4 seconds. A success body is an object with a non-empty `plugins` array. `listMarketplace({ refresh?, locale? })` locale is `zh` | `en` (default `zh`; `zh*` maps to `zh`). Disk cache lives under `app.getPath('userData')` with `CACHE_VERSION` 3 and a 1-hour TTL. Fallback order is memory, then disk, then the packaged snapshot `src/main/marketplace-registry-snapshot.json`. `source` is `live` | `cache` | `snapshot`; non-live carries `warning`. Empty at every layer returns `ok: false`, `items: []`, and a visible warning. There is no GitHub topic search.

`installSpec` matches dsh-market `installTargetFor`: a valid registry `npm` name; otherwise `github:owner/repo` or `github:owner/repo#path:/<posix>` from the GitHub `url` (`/tree/<ref>/<posix>`). The last whitespace token of `install` is used only when `isAllowedMarketplaceSpec` accepts it: a last-token npm name must equal the row `npm` field (`npm: null` maps to empty `installSpec`). Tarball, git, and file URLs never become `installSpec`. Catalog `id` is `owner/name` (the name may contain `#`).

**Install paths stay split.** `installMarketplacePlugin(id)` looks up that id in the current catalog (memory, else disk, else snapshot). Only that row's `installSpec` may reach `dsh plugin --profile web add`. Allowed specs: a registry npm name that passes `isValidPackageName`; `github:owner/repo` or `github:owner/repo#<gitRef>` that pass `isValidGithubSpec` and match the row's GitHub URL; `github:owner/repo#path:/<posix>` where the posix path has no `..`, `:`, or backslash, and owner/repo matches the row URL (`isValidMarketplacePathSpec`). Rejected before the CLI: `file:`, `link:`, tarball or git URLs, unknown ids, `DROPPED` packages, invalid `allowBuilds`. A stored desktop GitHub token may pin a SHA; without a token the install uses a floating ref.

`installPlugin(spec)` remains github-only (`isValidGithubSpec`) for the Host `install_dsh_plugin` control channel.

Add and remove share one in-flight mutex. Installed names come from new profile keys, new `node_modules` directories, or an existing profile spec that matches the github identity. A successful add with no loadable dsh entry (boolean `dsh.bundle.patch: true` is not enough) or a duplicate inserted loader id is removed immediately and reported as failure. `ok: false` does not call `startHarness()`. If add, Host `install-plugin`, or uninstall succeeded and `startHarness()` throws, IPC returns `ok: true` with `harnessStarted: false`. Add copy says the plugin is already in the web profile; uninstall copy says it is already out. `needsAllowBuilds` confirms once and retries with the allow list, including ndjson-escaped prepare-not-allowed names and `name@git+https://github.com/owner/repo.git` keys.

## Alternatives considered

**Preinstall or vendor `dshmarket` as the Settings marketplace UI.** Owned by [Desktop presets dshmarket](2026-08-19-desktop-dshmarket-preset.md). This note keeps catalog fetch and the Host github-only `installPlugin` path out of that plugin.

**Keep a second Electron marketplace window (`src/renderer/marketplace/`).** Rejected: a second `file:` document needs a parallel palette, a marketplace IPC role, and navigation pins onto `marketplace/index.html`. Tray and menu `openMarketplace()` open Settings instead.

**Validate `#path:` specs with `isValidGithubSpec`.** Rejected: Host `installPlugin` must stay github-only (`github:owner/repo[#ref]`). `#path:` is a marketplace catalog token. Widening `isValidGithubSpec` would let the Host control channel accept monorepo paths. Marketplace path specs use `isValidMarketplacePathSpec`.

## Consequences

There is no standalone marketplace window, no `IPC_ROLES.MARKETPLACE`, and no `shell:seed-install-draft`. Privileged navigation pins boot `file:` to packaged `boot.html` only. IPC marketplace install still goes through catalog id. Host `install_dsh_plugin` remains github-only. Offline catalog uses cache then snapshot; it does not search GitHub.

## Testing

`src/main/marketplace-catalog.test.js` pins locale mapping, npm / github / `#path:` specs from `installTargetFor` (including Release tarball `install` commands that still resolve to `github:`), last-token fallback that is not allow-listed becoming empty `installSpec`, last-token npm with no registry `npm` becoming empty, `DROPPED` filtering, TTL expiry, 4s abort, and live → cache → snapshot fallback. `src/main/marketplace-install.test.js` pins `installMarketplacePlugin(id)` lookup, unknown id, `DROPPED`, invalid `allowBuilds`, catalog `#path:` allowed while `installPlugin` rejects it, path `..` / backslash / colon rejection on GitHub blob homepages so owner/repo matches, owner/repo URL mismatch, tarball `install` commands installing `github:`, SHA pin only when a token is stored, the add/remove mutex, node_modules-only and already-present rollback, boolean `patch: true` rejection, and duplicate loader-id rollback. `src/main/ipc.test.js` pins `startHarness()` throw after a successful add, Host `install-plugin`, or uninstall returning `ok: true` / `harnessStarted: false`. `src/main/window-marketplace.test.js` pins `openMarketplace` with no `marketplace/index.html` window. `src/main/ipc-authorization.test.js` pins the absence of a `MARKETPLACE` role. `src/main/local-url.test.js` pins the absence of `isMarketplaceNavigationUrl`.

## Related

- [Right-panel and terminal work loops](2026-08-16-surfaces-terminal-work-loops.md)
- [Host install_dsh_plugin control channel](2026-08-15-marketplace-draft-install.md)
- [Desktop presets dshmarket](2026-08-19-desktop-dshmarket-preset.md)

# Standards-axis review

Range: `e2b83922c864778e7d7908e1ac15b3e8e1218cf0...ecf69ec7f0bba153f98cbf8f30b0997835375679`  
Worktree: `C:\Ai\Deepseek-Harness-Desktop\.worktrees\marketplace-parity` (HEAD `ecf69ec7`).  
Axis: coding standards and smells only. Not product completeness vs dsh-market.  
Skipped: anything a formatter, linter, coverage gate, or `verify-*` script would catch (trailing newline, hex-in-CSS if a token linter exists, bilingual pairing hashes).

Legend: **HARD** = documented repo standard. **Judgement** = smell baseline (always a judgement call); a documented standard wins if it endorses the pattern.

---

## HARD — documented standard breaches

### 1. Unnamed empty `catch` (touched + new)

**Standard:** `vendor/deepseek-harness/AGENTS.md` Conventions: *“An empty `catch` names what it swallows and why nothing else can reach it; keep the `try` to one statement.”*

Same change names the swallow in `marketplace-install.js` (`readJsonFile`, `isExistingFile`) and leaves catalog I/O silent.

`src/main/marketplace-catalog.js` — rewritten `readDiskCache` (`try` is parse + version/registry checks, not one statement):

```148:157:src/main/marketplace-catalog.js
function readDiskCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (!cache || cache.version !== CACHE_VERSION || !isValidRegistry(cache.registry)) {
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}
```

New `readSnapshot`:

```171:177:src/main/marketplace-catalog.js
function readSnapshot() {
  try {
    const registry = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    return isValidRegistry(registry) ? registry : null;
  } catch {
    return null;
  }
}
```

Contrast (same diff, rule followed):

```292:298:src/main/marketplace-install.js
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Missing files and invalid JSON are unread, not fatal.
    return null;
  }
}
```

### 2. JSDoc documents a caller option the function no longer honors

**Standard:** `vendor/deepseek-harness/docs/AGENTS.md` Writing rules: *“Comments and JSDoc state complete contracts, not reasoning transcripts.”*  
**Standard:** `vendor/deepseek-harness/.agents/skills/dsh-prose-standard/SKILL.md` — Public JSDoc must cover caller-visible distinctions.  
IPC no longer forwards a GitHub token into `listMarketplace` (`src/main/ipc.js` 124–129). The catalog JSDoc still advertises `token?: string`; the body never reads `options.token`.

```255:260:src/main/marketplace-catalog.js
/**
 * List curated marketplace plugins from plugins.json.
 * @param {{ token?: string, refresh?: boolean, locale?: string }} options
 */
async function listMarketplace(options = {}) {
```

### 3. Public install JSDoc omits caller-visible return fields

**Standard:** same JSDoc/contract rules as (2).  
`installMarketplacePlugin` returns `needsAllowBuilds`, `allowBuilds`, `log`, `installed`, and `spec` on real paths (see `loadableInstallFailure`, `addPluginSpec`, mutex busy). The published `@returns` lists only `ok` / `error` / `spec`.

```454:460:src/main/marketplace-install.js
/**
 * Install a curated marketplace plugin by catalog id.
 * The CLI only receives that row's installSpec after marketplace validation.
 * @param {string} id - registry `owner/name` id.
 * @param {{ allowBuilds?: string[], token?: string, onProgress?: Function }} [options]
 * @returns {Promise<{ ok: boolean, error?: string, spec?: string }>}
 */
```

### 4. Module comment still says the plugin is read-only

**Standard:** `vendor/deepseek-harness/docs/AGENTS.md` — comments/JSDoc state complete contracts.  
**Standard:** `vendor/deepseek-harness/packages/AGENTS.md` — *“A package's README and JSDoc are part of the change.”*  
README was updated to one-click Modal install. The `/client` module comment and locale-map JSDoc were not.

```1:1:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/index.ts
/** Read-only Host plugin inventory registered into Web Settings. */
```

```16:18:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/index.ts
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
```

`apply` now registers `installMarketplacePlugin` (lines 52–72). The comment is a false contract.

### 5. Menu trigger labels change after pick without `FlipText`

**Standard:** `vendor/deepseek-harness/packages/client/AGENTS.md` Styling: *“New dialogs and menus use `usePresence` plus a `motion.css` recipe; a trigger label that changes after a pick uses `FlipText`.”*  
**Standard:** `vendor/deepseek-harness/docs/web-styling.md` Motion: *“`FlipText` plays the 400ms flip recipe … when a permission, model, or effort trigger label changes.”* and *“New dialogs, menus, and in-place swaps reuse a primitive or the same hook and recipe.”*  
In-tree precedent: `ui-model-selection` / `ui-conversation` PermissionSelect wrap the changing Menu trigger in `FlipText`.

This diff *introduces* two Menu anchors whose visible label is the selected option (`statusLabel`, `sortLabel`):

```327:339:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.tsx
              <Button
                size="sm"
                variant="outline"
                aria-label={t('marketStatus')}
                aria-haspopup="menu"
                aria-expanded={statusOpen}
                onClick={() => {
                  setStatusOpen(current => !current)
                  setSortOpen(false)
                }}
              >
                {statusLabel}
              </Button>
```

(Same pattern for sort at the following `Menu`.) Using `Menu`/`Modal` satisfies the overlay half (primitives own Presence). The changing trigger text does not.

### 6. Component spec asserts effect/call-count internals, not user-visible behavior

**Standard:** `vendor/deepseek-harness/packages/client/AGENTS.md` Testing: *“Component specs render with realistic props or a driven fixture runtime and assert user-visible behavior, not class names, hook internals, or render counts.”*

```401:411:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/tests/marketplace.client.spec.tsx
  it('reloads the catalog when t changes', async () => {
    const listMarketplace = vi.fn(async () => ({
      items: [ITEM],
      categories: [{ id: 'all', label: 'All', count: 1 }],
    }))
    const { props, rerender } = renderTab({ listMarketplace })
    await waitFor(() => { expect(screen.getByText('dsh-loop')).toBeTruthy() })
    expect(listMarketplace).toHaveBeenCalledTimes(1)
    const nextT = ((key: PluginInventoryLocaleKey): string => en[key]) as MarketplaceSettingsTabProps['t']
    rerender(<MarketplaceSettingsTab {...props} t={nextT} />)
    await waitFor(() => { expect(listMarketplace).toHaveBeenCalledTimes(2) })
  })
```

This pins `useEffect` dependencies / fetch arity after replacing `t` with an equivalent `en` binder. No visible string, dialog, or catalog row changes.

### 7. Unexplained asymmetry on parallel IPC values

**Standard:** `vendor/deepseek-harness/AGENTS.md` Conventions: *“Prefer symmetry for parallel values; unexplained asymmetry usually signals a missed extraction.”*

Locale forwarding — `list-marketplace` passes `options?.locale` through (undefined → catalog `resolveLocale`); `refresh-marketplace` forces `'zh'`:

```124:136:src/main/ipc.js
  handle('shell:list-marketplace', HARNESS_ONLY, async (_event, options = {}) => {
    return listMarketplace({
      refresh: Boolean(options && options.refresh),
      locale: options?.locale,
    });
  });

  handle('shell:refresh-marketplace', HARNESS_ONLY, async (_event, options = {}) => {
    return listMarketplace({
      refresh: true,
      locale: options?.locale || 'zh',
    });
  });
```

Restart predicate — `install-plugin` uses truthy `result.ok`; the new sibling uses `result.ok === true`:

```147:161:src/main/ipc.js
    if (result.ok && typeof startHarness === 'function') {
      sendPluginProgress(event, { phase: 'restart', line: '正在重启 Harness' });
      await startHarness();
    }
    return result;
  });

  handle('shell:install-marketplace-plugin', HARNESS_ONLY, async (event, id, options = {}) => {
    ...
    if (result.ok === true && typeof startHarness === 'function') {
```

### 8. Hand-rolled category tab buttons next to `Button` / `Menu` / `Modal`

**Standard:** `docs/design-language.md` 强制规则 1: *“先复用，再绘制。按钮、输入、菜单、对话框、Tooltip、开关行，用 `ui-primitives`。”*  
Self-check in the same file: *“有现成原语却手写了按钮 / 菜单 / 对话框？”*

Search, refresh, status/sort, dialogs, and footer actions moved to primitives. Category chips remain a custom `<button className={css.tab}>` with underline-via-`::after` chrome:

```289:301:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.tsx
            {(categories ?? []).map(row => (
              <button
                key={row.id}
                type="button"
                role="tab"
                className={css.tab}
                aria-selected={category === row.id}
                data-active={category === row.id ? 'true' : undefined}
                onClick={() => { setCategory(row.id) }}
              >
                {row.label}
                <span>{row.count}</span>
              </button>
```

(If the authors claim there is no Tab primitive, that is a rebuttal — the surrounding controls still show they knew to reach for `Button`.)

---

## Judgement — smell baseline

Baseline smells are never hard. Repo standards above win where they already required a fix.

### Mysterious Name — `isBundle: !deprecated`

Catalog mapping no longer probes `package.json` `dsh.bundle.patch`. It inverts `deprecated`:

```77:90:src/main/marketplace-catalog.js
  const npm = typeof plugin.npm === 'string' && plugin.npm ? plugin.npm : null;
  const deprecated = plugin.deprecated === true;
  return {
    id: `${owner}/${name}`,
    ...
    isBundle: !deprecated,
    ...
    deprecated: plugin.deprecated,
```

UI still treats the flag as “bundle vs 非 bundle” and as the install-enable gate:

```396:396:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.tsx
                        <span>{item.isBundle ? t('marketBundle') : t('marketNotBundle')}</span>
```

```422:422:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.tsx
            {detail.isBundle && !detailName ? (
```

The honest field is `deprecated` (already on the mapped object). `isBundle` no longer names the fact.

### Duplicated Code — locale mapping (with a behavior fork)

Main:

```40:46:src/main/marketplace-catalog.js
function resolveLocale(locale) {
  const raw = String(locale || 'zh').trim();
  if (!raw || raw.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}
```

Client:

```91:92:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/desktop-shell.ts
export function catalogLocale(active: string): 'zh' | 'en' {
  return active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
```

Empty string → `zh` in main, `en` in the client helper. Same idea, two implementations, two empty-input answers.

### Duplicated Code — fallback warning suffix

```228:250:src/main/marketplace-catalog.js
  if (memoryRegistry) {
    return toPayload(memoryRegistry, locale, {
      source: 'cache',
      fetchedAt: memoryFetchedAt,
      warning: `${failed}，已使用本地缓存。`,
    });
  }
  const disk = readDiskCache();
  if (disk) {
    remember(disk.registry, disk.fetchedAt);
    return toPayload(disk.registry, locale, {
      source: 'cache',
      fetchedAt: disk.fetchedAt,
      warning: `${failed}，已使用本地缓存。`,
    });
  }
```

(`All` / `全部` is similarly duplicated in `buildCategories` vs `emptyPayload`.)

### Duplicated Code — status/sort `Menu` blocks

`MarketplaceSettingsTab.tsx` ~314–368: two near-identical `Menu` + `Button` + mutual-exclusion `onClick` copies. Extract would also be the natural `FlipText` site (HARD #5).

### Repeated Switches — `ActionDialog.kind`

Three functions switch the same discriminant (`actionTitle` 494–509, `actionDescription` 512–527, `actionFooter` 529+). Baseline: one table / one renderer.

### Feature Envy / presentation-layer business logic

**Standard (judgement because the helpers are file-local, not another object’s guts):** `packages/client/AGENTS.md` Layering: *“Presentation components … Business logic must not leak into them.”*

`installedName` walks installed specs for `#path:` vs owner/repo matching (lines 55–74). That is install-identity policy sitting in the tab component, next to masonry pagination.

### Divergent Change — `marketplace-install.js`

One module now owns: Host github-only `installPlugin`, catalog-id whitelist (`isAllowedMarketplaceSpec` / `#path:`), CLI add/remove, in-flight mutex, and `package.json` export/`dsh.client`/`dsh.bundle` loadability. Unrelated reasons to edit the same file.

### Unnamed swallow via `.catch(() => false)`

Not an empty `catch` block, so not HARD #1, but the same contract gap:

```436:436:src/main/window.js
    return contents.executeJavaScript(MARKETPLACE_TAB_SCRIPT).catch(() => false);
```

`consumePendingMarketplaceJump` then `void`s the promise after clearing the pending flag (440–448), so a failed jump is silent and not retried.

### Primitive Obsession / hardcoded locale on lookup

```297:309:src/main/marketplace-catalog.js
function getMarketplacePlugin(id) {
  ...
  const locale = resolveLocale('zh');
  ...
  return plugin ? mapPlugin(plugin, locale) : null;
}
```

Install only needs `installSpec` / `npm` / `homepage`; `mapPlugin` still runs the zh copy path. Parallel to `listMarketplace({ locale })` with no shared lookup type.

### DROPPED matching is not the same on the two install entry points

`installPlugin` (kept): `DROPPED.includes(name) || DROPPED.some((item) => name.includes(item))` (substring).  
New `isDroppedInstall`: exact `plugin.id` / `packageName` / spec. Unexplained fork on the same `DROPPED` list (symmetry standard would make this HARD if treated as parallel values; here the functions are intentionally split, so judgement).

### Publish-before-commit (desktop analog)

**Standard cited analogously, not as a harness-package HARD:** `packages/AGENTS.md` *“Publish state only at its commit point.”*

```280:285:src/main/marketplace-catalog.js
    const registry = await fetchRegistry();
    const fetchedAt = Date.now();
    remember(registry, fetchedAt);
    writeDiskCache(registry, fetchedAt);
    return toPayload(registry, locale, { source: 'live', fetchedAt });
```

If `writeDiskCache` throws, `memoryRegistry` is already live and the `catch` reports a fetch failure via `fallbackPayload`.

---

## Inspected and not flagged (standard wins or out of axis)

- **Modal/Menu without a local `usePresence` call.** `docs/web-styling.md`: new overlays *reuse a primitive or* the hook. Design-language “先复用” wins over inventing a second Presence wrapper.
- **Deleting `src/renderer/marketplace/` and the parallel-palette warning** in `AGENTS.md` / `docs/design-language.md`. Matches “do not copy those hex values” by removing the sheet.
- **No `test:web` snapshot.** Package README: marketplace tab is absent in a plain browser. `docs/testing.md` assembled-transcript rule does not attach to a desktop-only Settings inject.
- **`githubHeaders` left in `marketplace-catalog.js`.** Still used by `resolveCommitSha` (pin path). Not dead.
- **`DesktopShell` still has `installPlugin` / `saveConfig` / `refreshMarketplace`.** Those methods remain on harness preload; not speculative API for this tab.
- **Agent Note `2026-08-18-desktop-marketplace-curated-catalog.md`.** Present-tense Decision/Consequences; Testing section is required evidence under implemented-note rules, not a slop inventory.
- **CSS tokens.** Feature CSS uses `--dsw-alias-*`; no new `#hex` / `rgb()` in the Settings module.

---

## Counts

| Axis | Count | Worst |
| --- | --- | --- |
| HARD documented-standard | 8 | Unnamed empty `catch` on new snapshot/cache I/O, plus lying “Read-only” / `token` JSDoc |
| Judgement smells | 10 | `isBundle: !deprecated` driving install CTA and “bundle” copy |

No spec/product-completeness findings (out of scope).

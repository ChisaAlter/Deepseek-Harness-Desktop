# SPEC-axis review — marketplace parity Phase 1

Slice: `e2b83922c864778e7d7908e1ac15b3e8e1218cf0...ecf69ec7f0bba153f98cbf8f30b0997835375679` (`ecf69ec7f0`)
Binding contract: `docs/superpowers/specs/2026-08-18-marketplace-parity-design.md`
Implementation argument: `docs/superpowers/plans/2026-08-18-marketplace-parity.md` (adversarial rulings override conflicting spec sentences)
Scope: Phase 1 only (curated catalog, one-click install by catalog id, retire standalone window). Phase 2–4 not treated as missing.

Stance: assume the implementer will claim “done”. Findings below are the cheapest places they could have shipped less, plus places they shipped the wrong behaviour.

Verdict: Phase 1 is **not** done. Catalog/window/IPC wiring is largely present, but (1) the written spec still contradicts the plan on three binding sentences, (2) github loadable-entry rollback and post-add `startHarness` failure do not match the written contract, (3) several plan-critical gates are implemented but unproven (TTL, 4s abort, owner/repo URL match, last-token-over-npm on the install path).

---

## (a) Missing or partial vs Phase 1 spec/plan

### A1. Profile add succeeded, `startHarness()` failed — required failure UX is missing

**Class:** Missing (implementation is Wrong relative to the failure contract)

**Spec (失败):**
> profile 已经改成功但 `startHarness()` 失败：界面说明插件已在 profile 里、Harness 没起来，并给出已有的重启入口。不自动再跑一遍 add。

**Plan (Global Constraints):**
> `ok: false` 时 IPC 不得 `startHarness()`。

IPC does the success restart with no isolation:

```161:165:src/main/ipc.js
    if (result.ok === true && typeof startHarness === 'function') {
      sendPluginProgress(event, { phase: 'restart', line: '正在重启 Harness' });
      await startHarness();
    }
    return result;
```

If `startHarness()` throws after `installMarketplacePlugin` returned `{ ok: true }`:

- the IPC handler rejects; the renderer never receives `{ ok: true }`
- `MarketplaceSettingsTab.runInstall` `catch` treats it as a generic install failure (`failAction(messageOf(error))`)
- the client suite **locks that in**: `shows a dismissible failure Modal when installMarketplacePlugin rejects` uses thrown `'Harness did not start'` as the failure body (`marketplace.client.spec.tsx` ~239–250)

Nothing tells the user the plugin is already in the web profile. Nothing points at the existing 重启 Harness entry (menu/tray). The fail Modal’s primary action is dismiss, after which Install is still available, so the user can run `add` again.

`=== true` for the *call* is correct. The *failure mode after a successful add* is not implemented. No IPC test makes `startHarness` throw.

### A2. GitHub / `#path:` loadable-entry check does not use installed `package.json` `name`; empty profile delta skips `remove`

**Class:** Wrong (also Test weaker)

**Plan Task 2.8:**
> 包名：npm spec 用 spec；github 用安装后 `package.json` 的 `name`，若读不到则失败并 remove。

**Spec:**
> add 成功但新包没有可加载的 dsh 入口：当场卸掉并返回失败，避免下次启动卡死。

What shipped:

```360:366:src/main/marketplace-install.js
function resolveInstalledNames(spec, before, after) {
  const names = namesAddedByInstall(before, after);
  if (names.length > 0) {
    return names;
  }
  return isValidPackageName(spec) ? [spec] : [];
}
```

```482:495:src/main/marketplace-install.js
    const names = resolveInstalledNames(added.spec, before, added.installed);
    if (names.length === 0) {
      return loadableInstallFailure(added);
    }
    if (names.every(hasLoadableEntry)) {
      return added;
    }
    const runner = pluginCommand(options);
    for (const name of names) {
      if (!hasLoadableEntry(name) && isValidPackageName(name)) {
        await runner(['remove', name], options.onProgress);
      }
    }
    return loadableInstallFailure(added);
```

`hasLoadableEntry` reads `node_modules/<name>/package.json` but never uses `pkg.name`. GitHub names come only from a *new* key in the profile `dependencies` map.

Cheap misses this allows:

1. **Reinstall / no new profile key:** `dsh plugin add` succeeds, profile already had the name → `namesAddedByInstall` is `[]` → github/`#path:` spec is not a package name → `names.length === 0` → `{ ok: false, error: '该包不是可加载的 dsh 插件' }` **without `remove`**, and IPC will **not** `startHarness()`. A successful add is reported as “not loadable”.
2. **Add wrote `node_modules` but profile list did not grow:** same path: fail, leave the tree, no `remove`.
3. npm-only rollback works without a profile delta because `isValidPackageName(spec)` falls back to the spec. GitHub does not. The npm “no entry → remove” test (`marketplace-install.test.js` ~325–331) therefore does not prove the github path.

The github/`#path:` rollback tests always `writeProfileDep(...)` in the `onAdd` hook (`marketplace-install.test.js` ~240–261, 333–356). There is no test where add succeeds and the profile name is missing or unchanged. There is no test that reads `package.json` `name`.

### A3. `openMarketplace()` does not create a main window

**Class:** Partial (spec vs plan: plan wins for the jump; spec “打开主窗口” is still incomplete if `showMain()` is null)

**Spec:**
> `openMarketplace()` 打开主窗口，跳到设置 → 插件 → 插件市场

**Plan Task 4:**
> `openMarketplace()`：`showMain()`；若 Harness 已就绪…若未就绪：只显示主窗，记下 pending 标志

```387:398:src/main/window.js
function showMain() {
  const win = getMainWindow();
  if (!win) {
    return null;
  }
  ...
}
```

```451:458:src/main/window.js
function openMarketplace() {
  const win = showMain();
  if (!win || !isHarnessLoaded(win)) {
    pendingMarketplaceJump = true;
    return win || null;
  }
  return jumpToMarketplaceTab(win);
}
```

Production close usually hides or quits rather than destroying the window (`src/main/index.js` 489–499), so this is often latent. The unit test **documents** the gap: `openMarketplace does not create a window when the main window is missing` (`window-marketplace.test.js` 213–221). Tray/menu still call `openMarketplace()` (`tray.js` 25, `menu.js` 45). Pending is set even when `win` is null; nothing is shown.

### A4. Catalog 4s timeout, 1h TTL, and AbortError fallback are implemented but not proven

**Class:** Test weaker than the claimed requirement

**Spec / Plan:**
> 超时 4 秒（AbortController）。
> 磁盘缓存 `CACHE_VERSION` 3，TTL **1 小时**。
> fetch 超时/抛错且无缓存时用快照

Shipped: `FETCH_TIMEOUT_MS = 4000` + `AbortController` (`marketplace-catalog.js` 9, 197–199); `CACHE_TTL_MS = 60 * 60 * 1000` (`marketplace-catalog.js` 8, 144–146); AbortError copy at `marketplace-catalog.js` 225–227.

Catalog tests never:

- abort a hung fetch or assert `AbortError` / 4s
- write a version-3 cache with `fetchedAt` older than 1 hour and assert a refetch
- distinguish “TTL still valid” from “refresh: true”

The test named `memory and disk cache beat the snapshot; refresh skips TTL` (`marketplace-catalog.test.js` 286) only proves `refresh: true` refetches a *current* cache. `CACHE_TTL_MS` could be 24h or 1ms and the suite would still pass. `FETCH_TIMEOUT_MS` could be 40s and the suite would still pass (tests `throw` immediately).

This is the cheapest silent under-ship on Task 1.

### A5. GitHub owner/repo must match the row URL — implemented, not proven

**Class:** Test weaker than the claimed requirement

**Plan Task 2.3:**
> `github:owner/repo` 或 `github:owner/repo#<gitRef>` 且 `isValidGithubSpec(spec)`，且 owner/repo 与该行 `url` 的 `github.com/<owner>/<repo>` 一致
> `github:owner/repo#path:/<posix>`：…；owner/repo 与 url 一致

`ownerRepoMatches` exists (`marketplace-install.js` 245–248, 259, 274). Every successful github/`#path:` fixture uses a matching GitHub URL. There is no test where `install` token is `github:acme/spec-mismatch` and `url` is `https://github.com/other/repo` (or the reverse). Deleting `ownerRepoMatches` would not redden `marketplace-install.test.js`.

`#path:` colon rejection (`posix.includes(':')`, `marketplace-install.js` 256) is also untested; only `..` and backslash are (`marketplace-install.test.js` 263–286). Deleting the `:` check would not redden the suite.

### A6. “installSpec = last token, not npm-else-github” is proven on list mapping, not on install

**Class:** Test weaker than the claimed requirement

**Plan ruling:**
> spec 字段表写「有 npm 用 npm 包名，否则解析 github」过粗：**installSpec = `install` 最后一个 token**（含 `#path:`）。

Catalog live mapping *does* assert `acme/spec-mismatch` keeps `installSpec === 'github:acme/spec-mismatch'` while `npm === 'npm-name-not-used'` (`marketplace-catalog.test.js` 224–227). `getMarketplacePlugin` / `installMarketplacePlugin` never install that id.

All install successes use rows where `npm` equals the last token, or `npm` is null. A quiet `const spec = plugin.npm || plugin.installSpec` inside `installMarketplacePlugin` would still pass `marketplace-install.test.js`. The protection is only the shared `mapPlugin` + the list test — easy to split later.

### A7. SHA pin for GitHub marketplace installs is unproven; `#path:` not-pinned is unproven

**Class:** Test weaker than the claimed requirement

**Spec:**
> 装 GitHub 源时若桌面其它功能已存 Token，仍可用来钉 SHA；没有 Token 就装浮动 ref。

**Plan Task 2.6:**
> GitHub 无 `#path:` 的规格仍可走现有 `pinInstallSpec`（SHA）。`#path:` **不要** pin

`addPluginSpec` always calls `pinInstallSpec` (`marketplace-install.js` 407). `#path:` survives because `parseGithubSpec` → `isValidGithubSpec` fails and the function returns the original spec (`marketplace-install.js` 379–388). Install tests set `globalThis.fetch = async () => { throw ... }` (`marketplace-install.test.js` 23–26), so `resolveCommitSha` never succeeds. Every github add is asserted as the *unpinned* token. A regression that pins `#path:` to `github:owner/repo#<sha>` (dropping `path:/`) would not fail this file while fetch is disabled.

### A8. DROPPED-by-id is not independently proven

**Class:** Test weaker than the claimed requirement

**Plan:**
> `DROPPED` 对 id 和算出的包名都要比。
> 裁定：list 过滤；getMarketplacePlugin 返回原始映射行（含 dropped）

`DROPPED` is only package names (`plugins.js` 7–10). The only dropped fixture is `omdsh-dev/dsh-genui` / `@dsh-external/dsh-genui`. List hide can be explained entirely by `packageName`. `isDropped`’s `DROPPED.includes(item.id)` (`marketplace-catalog.js` 98–100) could be deleted without reddening tests. There is no row whose **id** is in `DROPPED` while `packageName` is not.

`getMarketplacePlugin` returning the dropped row **is** proven (`marketplace-catalog.test.js` 379–392). Install reject of that id **is** proven (`marketplace-install.test.js` 214–220).

### A9. `needsAllowBuilds` must not `startHarness()` — implemented, weakly proven

**Class:** Test weaker than the claimed requirement

**User/plan ruling:** `startHarness()` only when `result.ok === true`.

Marketplace IPC uses `result.ok === true` (`ipc.js` 161). The IPC test covers `{ ok: false, error: '未收录该插件' }` (`ipc.test.js` 305–318), not `{ ok: false, needsAllowBuilds: true, allowBuilds: [...] }`. A handler written `if (result.ok || result.needsAllowBuilds)` is not what shipped, but the dangerous payload is not in the suite. Host `shell:install-plugin` / uninstall still use truthy `if (result.ok &&` (`ipc.js` 147, 172).

### A10. Empty-every-layer catalog payload is unproven

**Class:** Test weaker than the claimed requirement

**Spec / Plan:**
> 每一层都空：返回 `ok: false`、`items: []` 和可见警告。

`emptyPayload` exists (`marketplace-catalog.js` 133–142). Tests always have a valid packaged snapshot, so they never hit it. `source: ''` on that payload is also unasserted (`source` 为 `live | cache | snapshot` in the spec; empty is unspecified).

---

## (b) Behaviour in the diff that Phase 1 did not ask for

Phase 2–4 UI (screenshot fetch, in-tab themes, updates, backup, diagnostics) is **not** in the client tab. `screenshots` is mapped as a catalog field (spec table) and not loaded. That is in-scope mapping, not Phase 2.

### B1. Renderer keeps the previous catalog when `listMarketplace` returns `items: []`

**Class:** scope creep (and can contradict A10)

**Spec:**
> 每一层都空：返回 `ok: false`、`items: []` 和可见警告。
> 有缓存或快照就展示卡片并带警告；只有每一层都失败才空列表。

That fallback is a **main-process** duty. The tab additionally refuses to replace state when the payload is empty:

```157:163:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.tsx
      const next = dedupeItems(catalog.items ?? [])
      if (next.length > 0) {
        setItems(next)
        setCategories(catalog.categories ?? [])
        setDetail(current => current ? next.find(item => item.id === current.id) ?? current : null)
      }
```

The client test `keeps the current catalog when a refresh returns no items` (`marketplace.client.spec.tsx` 281–291) locks this in. Not in spec or Task 5. If the main process ever returns empty+warning, the UI shows **stale cards** plus the new warning, not an empty list.

### B2. Category “展开” is always rendered, not only when chips exceed ~two rows

**Class:** scope creep (minor)

**Plan Task 5:**
> 分类芯片：超过约两行（用 CSS 默认 max 两行 +「展开」按钮）

CSS clip is `max-height: 76px` (`MarketplaceSettingsTab.module.css` 30–44). The Expand button is unconditional (`MarketplaceSettingsTab.tsx` 304–310). Harmless extra chrome.

### B3. GitHub-era detail fields still rendered (`license` / `topics` / `keywords` / `pushed` / `updated`)

**Class:** scope creep / leftover (minor)

Spec `MarketplaceItem` table does not include these. `mapPlugin` does not set them (`marketplace-catalog.js` 71–95). The tab still displays them when present (`MarketplaceSettingsTab.tsx` 262–263, 452–465). Not a new Phase-2 feature; leftover surface area.

### B4. `DesktopShell` still types Token / `saveConfig` / Host `installPlugin`

**Class:** leftover types, not shipped UI

Task 5: 去掉对 `sessions` / `seedInstallDraft` / Token 的依赖. Registration no longer injects them (`index.ts` 52–63, `browser-plugin.client.spec.tsx` 119–121). `desktop-shell.ts` 77–82 still declares `saveConfig` / `getConfig` / `githubToken` / `installPlugin`. Not user-visible.

Not counted as creep: `#path:` card↔installed matching (`installedName` + last commit). Phase 1 installs those rows and requires list/filter/uninstall; without path matching, `#path:` cards cannot show Installed or uninstall. That is finishing Task 5, not Phase 2.

---

## (c) Looks implemented, but the implementation is wrong

### C1. Installed matching is a substring of `owner/repo`

**Class:** Wrong

```66:74:vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.tsx
function installedName(item: MarketplaceItem, installed: Map<string, string>): string {
  if (item.packageName && installed.has(item.packageName)) return item.packageName
  const ownerRepo = `${item.owner}/${githubRepoName(item.repo)}`
  const pathSuffix = marketplacePathSuffix(item.installSpec)
  for (const [name, spec] of installed) {
    if (!spec.includes(ownerRepo)) continue
    if (pathSuffix ? spec.includes(pathSuffix) : !spec.includes('#path:/')) return name
  }
  return ''
}
```

`spec.includes('owner/dsh-loop')` is true for `github:owner/dsh-loop-extra#abc`. A shorter catalog id can steal Installed / Uninstall from a longer repo. `#path:` sibling distinction is tested (`marketplace.client.spec.tsx` 321–361); prefix collision is not.

### C2. Pending marketplace jump is cleared before the jump succeeds; consume only runs on `revealHarnessView`

**Class:** Partial / Wrong (edge)

**Plan Task 4:**
> 若未就绪：只显示主窗，记下 pending 标志；在 Harness 第一次就绪（`showHarness` 成功加载或现有 `isHarnessLoaded` 变真的那条路径）后执行一次同样的设置跳转，然后清标志。

```440:448:src/main/window.js
function consumePendingMarketplaceJump(win) {
  if (!pendingMarketplaceJump) {
    return;
  }
  if (!win || !isHarnessLoaded(win)) {
    return;
  }
  pendingMarketplaceJump = false;
  void jumpToMarketplaceTab(win);
}
```

`pendingMarketplaceJump` is cleared **before** `jumpToMarketplaceTab` finishes. If settings JS fails, the one queued jump is spent. `consumePendingMarketplaceJump` is only called from `revealHarnessView` (`window.js` 239). If `isHarnessLoaded` is false at that moment (URL/origin not yet harness), the function returns **without** clearing pending — good — but nothing retries until the next `showHarness`. The happy path is tested (`window-marketplace.test.js` 242–263). The failed-`isHarnessLoaded`-at-reveal path is not.

Happy path itself matches the plan override (queue one jump). See D1 for the spec still saying otherwise.

### C3. TTL-fresh catalog is `source: 'cache'` with “无法在线更新”

**Class:** Wrong copy vs the cause (spec-compliant letter, misleading product)

**Spec:**
> `source` 为 `live | cache | snapshot`。非 live 必须带 `warning`。

TTL hit does not fetch, then returns `WARNING_CACHE` = `插件目录无法在线更新，已使用本地缓存。` (`marketplace-catalog.js` 12, 261–267). The directory did not fail; it was skipped because it is less than an hour old. Letter of the spec is satisfied. Opening the tab within TTL always shows a failure banner. Not asked to lie about an online failure.

### C4. GitHub reinstall / missing profile delta reported as “不是可加载的 dsh 插件”

Covered under A2. Restating because an implementer will point at the github rollback tests and call Task 2.8 done. Those tests only cover “new profile name + bare package.json → remove”. They do not cover the plan’s specified name source (`package.json` `name`) or the fail-closed `remove` when that name cannot be read.

---

## (d) Spec-vs-plan conflicts still in the committed spec (docs lie)

Plan §对抗性审查覆盖 spec 的句子 is the override. The spec file was committed in this slice and **still contains the overruled sentences**, plus an internal contradiction the plan already settled.

### D1. `openMarketplace` while Harness is booting

**Spec 主界面:**
> 若 Harness 尚未加载，该调用只显示主窗口，不再打开市场 `BrowserWindow`。

**Plan ruling:**
> spec 写 Harness 未就绪只显示主窗：**记下待跳转，Harness 第一次就绪后再跳设置 → 插件市场**。

Code implements the plan (`pendingMarketplaceJump`, `consumePendingMarketplaceJump`). The spec still omits the queued jump. Anyone reading only the spec will mark the pending jump as extra.

### D2. Allowed install forms omit `#path:` while the field table includes it

**Spec 安装 / 允许算出的规格:**
> - 通过 `isValidPackageName` 的 registry `npm` 包名
> - 通过 `isValidGithubSpec`、且与该行 GitHub URL 一致的 `github:owner/repo` 或 `github:owner/repo#ref`

**Spec 字段映射 (already updated):**
> `installSpec` | `install` 命令最后一个空白分词 token（含 `#path:`）

**Plan:**
> 允许的市场规格仅：… `github:owner/repo#path:/<posix>` …

The committed spec still lists Host-shaped github specs as the *only* allowed calculated forms. Phase 1 `#path:` install would look like spec violation if you ignore the plan. The mapping row and the allow-list disagree **inside the spec**.

### D3. Test plan still says “npm 优先、github 回退”

**Spec 测试:**
> 目录映射 fixture：中英简介、**npm 优先、github 回退**、退役条目 `isBundle: false`、官方分类标签。

**Plan ruling:**
> **installSpec = `install` 最后一个 token**（含 `#path:`）。禁止用 `isValidGithubSpec` 去验证 `#path:` 规格。

The mapping table in the same spec already uses last token. The test section was not updated. A later agent can “fix” mapping back to npm-else-github and claim spec tests.

---

## What actually matches (so “done” is not a total fiction)

These Phase 1 items are present and, unless noted above, proven:

| Requirement | Evidence |
| --- | --- |
| Curated `plugins.json`, not GitHub topic search | `marketplace-catalog.js` `DEFAULT_REGISTRY_URL`; tests assert URL is not `api.github.com/search` |
| `installSpec` last whitespace token in `mapPlugin` | `lastInstallToken`; live mapping test including `spec-mismatch` |
| `CACHE_VERSION` 3; v2 disk ignored | `marketplace-catalog.js` 7, 151; test `CACHE_VERSION 2 disk files are ignored` |
| locale `zh` / `en`, default `zh`, `zh*` → `zh` | `resolveLocale`; catalog locale test; `catalogLocale` + inject |
| list hides DROPPED; `getMarketplacePlugin` returns dropped | catalog test 379–392 |
| Host `installPlugin` / `isValidGithubSpec` still github-only, no `#path:` | `install-dsh-plugin-client.js` unchanged; install tests reject `file:` and `#path:` |
| Marketplace `#path:` allowed without `isValidGithubSpec` | `isValidMarketplacePathSpec`; path install test |
| Shared in-flight mutex | `withPluginLock`; test covers marketplace install vs uninstall vs `installPlugin` |
| IPC constructs `{ allowBuilds, token, onProgress }`, does not spread renderer options | `ipc.js` 154–160; `ipc.test.js` 276–293, 321–337 |
| `startHarness` on marketplace install only if `result.ok === true` | `ipc.js` 161; fail test does not restart |
| `shell:seed-install-draft` gone; marketplace preload role gone | `ipc.test.js` 267–274; `shell-api.test.js` 79–84, 96–101 |
| Standalone `src/renderer/marketplace/` gone; no `IPC_ROLES.MARKETPLACE` | `window-marketplace.test.js` 181–183; `ipc-authorization.js` 6–9 |
| Pending settings jump after first harness reveal | `window-marketplace.test.js` 242–263 |
| Settings tab: primitives, no Token, install by id, confirm shows spec, 60+60, Menu not combobox, `t` reload | `marketplace.client.spec.tsx` |
| Inject adds locale; no `seedInstallDraft` | `index.ts` 52–63; `browser-plugin.client.spec.tsx` 106–167 |
| `marketplace-categories.js` deleted | files absent |
| Agent Note + README + design-language marketplace.css warning | committed in slice; surfaces note now pins boot.html not `marketplace/index.html` |
| No dshmarket, no npm↔repo anti-squat, no apiproxy drive-by | grep-clean in this diff |

`isValidGithubSpec` still rejects `#path:` because the ref `path:/...` contains `:` (`install-dsh-plugin-client.js` 22–42). Host was not widened.

---

## Cheapest “we shipped less” checklist (for the implementer)

If the claim is “Phase 1 done”, these are the lowest-cost lies the suite would still bless:

1. `CACHE_TTL_MS = 86400000` or `FETCH_TIMEOUT_MS = 40000` — **no test would fail**.
2. Drop `ownerRepoMatches` — **no test would fail**.
3. Drop `#path:` `:` rejection — **no test would fail**.
4. `installMarketplacePlugin` uses `plugin.npm || plugin.installSpec` — **install tests would still pass**.
5. Drop `DROPPED.includes(item.id)` — **list test still passes** via packageName.
6. Skip `remove` when github profile delta is empty — **already shipped**, tests still green.
7. `startHarness()` throw after ok add — **already shipped** as generic Modal; client test treats that as success.
8. Spec file still teaches npm-else-github and “boot only, no queued jump”.

---

## Recommended fix order (spec-axis, not a new design)

1. Rewrite spec sentences D1–D3 so the committed product contract matches the plan rulings (or the code will be “wrong” depending on which document the next reviewer binds).
2. Fix A2: github/`#path:` name from installed `package.json` `name`; if unreadable, `remove` whatever profile names appeared (or fail closed with rollback), including empty delta / reinstall.
3. Fix A1: IPC must return the install result even if `startHarness()` throws; UI copy must say profile has the plugin / Harness did not start / use existing restart; do not invite a second `add`.
4. Add tests that would have caught 1–3: TTL expiry, AbortController timeout, URL mismatch, `#path:` colon, `acme/spec-mismatch` install, github add without new profile key, `startHarness` throw, `needsAllowBuilds` does not restart.
5. Tighten `installedName` (C1) and stop renderer-side catalog retention from contradicting empty-all-layers (B1), or document B1 as an explicit plan amendment.

Until 1–4, “Phase 1 done” is an overclaim.

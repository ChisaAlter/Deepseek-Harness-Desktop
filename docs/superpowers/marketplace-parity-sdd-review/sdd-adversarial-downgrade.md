# Adversarial audit: marketplace Phase-1 requirement downgrade

Worktree: `.worktrees/marketplace-parity`  
HEAD: `ecf69ec7f0` (`Match #path: marketplace cards as installed and sort 最新 by catalog added.`)  
Base: `e2b83922c864778e7d7908e1ac15b3e8e1218cf0`  
Live catalog sampled 2026-08-18: `https://awesome-dsh-plugin.com/plugins.json` (1367 plugins).  
dsh-market live `main`: `src/sources.ts` `installTargetFor`, `src/install.ts` `retargetCollections` / `validateAddedPlugins` / `withHoistRecovery`.

Layers: **0** original ask (对齐 dsh-market) · **1** user-approved architecture · **2** committed spec · **3** plan + SDD rulings · **4** shipped HEAD.

---

### Verdict

**Partial.** Phase-1 did ship the approved product shape: Settings-only tab, no `dshmarket` / no `MarketSection`, curated `plugins.json`, renderer sends only catalog `id`, Host `installPlugin` stays github-only, standalone Electron window is gone, `CACHE_VERSION` 3, no GitHub topic search, official `ui-primitives` / `--dsw-alias-*`. The downgrade is not “the whole market was gutted.” It is concentrated in **install safety vs dsh-market** (no `hasDshManifest` + duplicate loader-id check, no collection-repo retarget), **the spec’s startHarness-failure banner** (add can succeed, restart fail, UI lies), and a **silent mapping rewrite** (Layer 1 npm-first → last-token) that does **not** currently abandon npm tarballs (0 live rows have npm plus a github/`#path:` last token) but **does** leave **16 live catalog cards** with GitHub-release `.tgz` last tokens that dsh-market would install via `url`→`github:` and desktop refuses as `安装规格不受支持`. Hoist / release-age / fetchTimeout retries were **explicitly deferred** in Layer 1/2 — report them as a Phase-1 gap vs dsh-market, not a stealth rewrite. Passing tests encode several of the weaker contracts (`dsh.bundle.patch: true` is “loadable”; fixture `acme/spec-mismatch` locks last-token over npm; thrown `"Harness did not start"` is a generic fail Modal).

---

### SDD rulings (upgrade vs silent rewrite vs justified correction)

| Ruling | Class |
| --- | --- |
| (1) `installSpec` = last token of `install`, including `#path:` | **Justified correction** for monorepo `#path:` (Layer 1’s “否则解析 `github:owner/repo`” would drop `#path:`). **Silent spec rewrite** of Layer 1 “优先 npm”. **Not** a live npm-tarball abandonment (506/506 npm rows: last token === `npm`). **Weaker than dsh-market** on 16 release-tarball `install` commands. |
| (2) `openMarketplace` queues a settings jump while Harness boots | **Upgrade** vs spec Layer 2 “只显示主窗口”. Shipped (`pendingMarketplaceJump`). |
| (3) Host `isValidGithubSpec` stays github-only | **Justified correction** (security). `#path:` would match `isValidGithubSpec`’s `#ref` slot except `:` fails the ref charset — still rejected. Marketplace uses `isValidMarketplacePathSpec`. |
| (4) `getMarketplacePlugin` returns DROPPED; list hides them | **Justified correction**. Shipped. |
| (5) Shared install mutex | **Upgrade**. Shipped. |
| (6) No npm↔repo anti-squat this phase | **Explicit approved deferral** (plan Global Constraints: “本轮不做 npm registry 反查”). dsh-market still prefers registry-verified npm names in `installTargetFor`. |

---

### Downgrade map

- **Claimed requirement:** Layer 1 — “Mapping: `installSpec` 优先 npm，否则解析 `install` 里的 `github:owner/repo`”; “有 npm 就走 tarball，没有才走 GitHub”. Spec testing still says “npm 优先、github 回退” (`docs/superpowers/specs/2026-08-18-marketplace-parity-design.md:189`).
  **What shipped:** `lastInstallToken` → `installSpec` (`src/main/marketplace-catalog.js:61-87`). Plan overruled the spec field-table coarseness (`docs/superpowers/plans/2026-08-18-marketplace-parity.md:14,30,61`). Catalog fixture **asserts** last-token wins when npm differs (`src/main/marketplace-catalog.test.js:63-75,224-227`, id `acme/spec-mismatch`). dsh-market does **not** read `install`: `installTargetFor` uses `entry.npm` if it is an npm name, else `github:repo` or `github:repo#path:/` from the GitHub **URL** (`dsh-market/src/sources.ts`). Live catalog 2026-08-18: **0** rows with npm plus a github/`#path:` last token; **506** npm rows where last token === npm; **59** `#path:` tokens (all have `/tree/` URLs); **16** last tokens are quoted GitHub-release `.tgz` URLs (no npm) — desktop `isAllowedMarketplaceSpec` rejects `https?:` / non-package (`marketplace-install.js:262-280`). Two of those 16 have `/tree/` URLs (`TianYa-DAO/dsh-wallpaper-engine#plugin`, `qimidandapigu/…小汤圆`), which dsh-market would install as `#path:`.
  **Class:** Silent spec rewrite (Layer 1 → last-token) + Justified correction (`#path:`) + Docs still lie (spec §测试 still “npm 优先”) + Test theater (`spec-mismatch` locks the rewrite). Not current npm-tarball abandonment.
  **User-visible cost if wrong:** Today, npm cards still `pnpm add <name>` (registry tarball). If the catalog later lists npm **and** a github/`#path:` last token, desktop skips the npm tarball dsh-market uses. Today, 16 cards still show **安装**, then fail with `安装规格不受支持`; dsh-market would `github:` from `url`.
  **Severity:** Important (16 dead cards vs dsh-market; latent mapping fork). Not Blocker for “npm abandoned.”

- **Claimed requirement:** Layer 2 spec:181 — “add 成功但新包没有可加载的 dsh 入口：当场卸掉”; dsh-market `validateAddedPlugins`: `hasDshManifest` **AND** `hasLoadableEntry`, plus `conflictingEntryIds` (duplicate loader ids brick next boot, #122). Layer 1/2/3 never deferred the conflict or manifest check. Plan Task 2:8 is already weaker: `dsh.bundle.patch` **or** `dsh.client` **or** `main`/`exports` file exists.
  **What shipped:** `hasLoadableEntry` (`marketplace-install.js:329-349`) returns true if `pkg.dsh?.bundle?.patch` is **any truthy value** (boolean `true` counts), or a client/main/exports **file** exists — **no** `manifest.dsh` requirement, **no** patch-file parse, **no** `conflictingEntryIds`. Tests encode the weak contract: `writeBundlePlugin` uses `{ dsh: { bundle: { patch: true } } }` (`marketplace-install.test.js:76-78,230-237`); `#path:` success uses `writeExportsPlugin` with **no `dsh` field** (`87-91,250-260`). dsh-market would treat `patch: true` and main-only packages as broken/carriers-without-targets.
  **Class:** Implementation shortfall vs dsh-market Phase-1 equivalent install safety. Plan quietly lowered the bar vs spec “可加载的 dsh 入口.” Test theater.
  **User-visible cost if wrong:** A TUI bundle that inserts `id: storage` (or any id the web profile already owns) can pass desktop validation, `startHarness()` then **cannot boot**; the marketplace tab is unreachable. A collection root with a dummy `main` stays installed as junk. A `dsh.bundle.patch: true` with no patch file counts as success.
  **Severity:** Blocker (duplicate loader id is a known brick; dsh-market added this after #122 specifically because the market page becomes unreachable).

- **Claimed requirement:** dsh-market `retargetCollections`: `github:` collection repo with no dsh manifest at root → remove junk, re-add each plugin subdirectory via `#path:`. Not named in Layer 1, spec, or plan — **not clearly deferred**.
  **What shipped:** No retarget. Failed loadable-entry → `remove` that name only (`marketplace-install.js:482-495`). Catalog already splits many collections into `#path:` rows (59). Remaining risk: a `github:owner/repo` row whose checkout is a workspace root.
  **Class:** Implementation shortfall vs dsh-market (Phase-1 equivalent). Not a silent rewrite of approved desktop text.
  **User-visible cost if wrong:** One-click on a collection-root GitHub card either fails (“不是可加载的 dsh 插件”) with no subdirectory recovery, or keeps a junk root if `package.json`+`main` exist. User must know to install sibling `#path:` rows instead.
  **Severity:** Important.

- **Claimed requirement:** Layer 1/2 — “第一轮不搬 dsh-market 的 hoist / release-age / fetchTimeout 重试” (`spec:118`). dsh-market `withHoistRecovery`: pnpm-major hoist rebuild, `minimumReleaseAge=0`, transient network retry, `fetchTimeout=600000`.
  **What shipped:** Single `dsh plugin add` (`marketplace-install.js:399-416`). No recovery.
  **Class:** Explicit approved deferral. Still an **explicit Phase-1 gap vs dsh-market**.
  **User-visible cost if wrong:** GitHub/`#path:` installs fetch the whole repo tarball; pnpm’s 60s fetch timeout and pnpm-major drift fail with generic `安装失败`. Same class of failures dsh-market papers over.
  **Severity:** Parked-but-real (approved miss vs dsh-market; user-visible on slow/GitHub installs).

- **Claimed requirement:** Layer 2 spec:86-87 — “装 GitHub 源时若桌面其它功能已存 Token，仍可用来钉 SHA；没有 Token 就装浮动 ref.” Agent Note repeats this.
  **What shipped:** IPC passes `token: config.githubToken` and **does not** take renderer `token` (`src/main/ipc.js:154-159`; test `ipc.test.js:276-292`). `pinInstallSpec` (`marketplace-install.js:379-388`) calls `resolveCommitSha`. `#path:` is not pinned (`parseGithubSpec` uses `isValidGithubSpec`, which rejects `:` in the ref). Install tests disable `fetch` globally, so pin always falls through to the floating spec (`marketplace-install.test.js:23-26,240-247` asserts `['add', GITHUB_SPEC]` unpinned).
  **Class:** Implementation present. Test theater (token plumbing proven; SHA rewrite not proven).
  **User-visible cost if wrong:** If pin never runs in production, GitHub installs track a moving `HEAD`. If it runs, matches spec.
  **Severity:** Parked-but-real (unproven pin). Not a spec rewrite.

- **Claimed requirement:** Layer 2 spec:181 — “profile 已经改成功但 `startHarness()` 失败：界面说明插件已在 profile 里、Harness 没起来，并给出已有的重启入口。不自动再跑一遍 add。”
  **What shipped:** On `result.ok === true`, IPC `await startHarness()` then **returns the install result unchanged** (`ipc.js:161-165`). No try/catch, no `installed: true, harness: false` payload, no dedicated copy. UI `runInstall` treats `ok` as success; thrown errors go to generic `marketFailTitle` (`MarketplaceSettingsTab.tsx:204-225`). Client test **encodes** that: `throw new Error('Harness did not start')` → dismissible fail Modal with that string (`marketplace.client.spec.tsx:239-248`) — not the spec banner.
  **Class:** Implementation shortfall + Test theater + Docs still lie (spec/plan/Agent Note: Agent Note is silent; spec still claims the banner).
  **User-visible cost if wrong:** Plugin is in the profile; Harness is down. User sees either a fake success (restart failed without throw) or “操作失败 / Harness did not start” and may retry **add** (spec forbids automatic re-add; UI does not explain “already installed, use Restart”).
  **Severity:** Important.

- **Claimed requirement:** Layer 2 spec:179 — “`needsAllowBuilds`：再确认一次，然后带名单重试一次.” dsh-market also `parsePrepareNotAllowed` (git-hosted package not yet in `node_modules`, including ndjson-escaped quotes) and `gitAllowBuildsKey` (`name@git+https://github.com/owner/repo.git`) because a bare `name: true` does not authorize git-hosted builds (#68).
  **What shipped:** UI confirm + retry with `allowBuilds` (`MarketplaceSettingsTab.tsx:211-213,554-564`; client spec:143-161). `parseAllowBuilds` (`marketplace-allowbuilds.js:8-29`) matches plaintext `Ignored build scripts:` and YAML-ish keys; **no** `parsePrepareNotAllowed`, **no** ndjson `\"` unescape, **no** git allowBuilds key. `allowBuildsInWorkspace` writes the extracted names as YAML keys.
  **Class:** Partial implementation. Implementation shortfall vs dsh-market (and vs “带名单”). Test theater (happy path with a pre-filled `allowBuilds` array; no ndjson / prepare-not-allowed fixture).
  **User-visible cost if wrong:** Git-hosted plugin needs a build: dialog shows empty `{packages}`, retry with `[]` fails again. Or retry writes a bare name that pnpm ignores; user loops on `需要允许该插件在本机执行构建脚本`.
  **Severity:** Important.

- **Claimed requirement:** Layer 1/2 — catalog timeout 4s actually aborting. Spec:45; plan:44 (`AbortController`). dsh-market: `AbortSignal.timeout(4000)`.
  **What shipped:** `FETCH_TIMEOUT_MS = 4000` + `controller.abort()` (`marketplace-catalog.js:9,197-221`). Fallback treats `AbortError` as `插件目录请求超时` (`225-227`). Tests cover throw/empty/non-object → snapshot (`marketplace-catalog.test.js:267-377`). **No test** advances fake timers or asserts `signal.aborted` / `AbortError`.
  **Class:** Implementation present. Test theater for the abort itself.
  **User-visible cost if wrong:** If abort were a dead constant, a hung `awesome-dsh-plugin.com` would stall the Settings tab past 4s (refresh stays busy). Same 4s budget as dsh-market if the abort is live.
  **Severity:** Parked-but-real.

- **Claimed requirement:** Layer 1/2 — `CACHE_VERSION` 3 / no GitHub topic fallback. Spec:50-55.
  **What shipped:** `CACHE_VERSION = 3` (`marketplace-catalog.js:7,148-157,163-164`). v2 disk ignored (`marketplace-catalog.test.js:406-425`). Fetch URL is `plugins.json`, not `api.github.com/search` (`397-404`). `marketplace-categories.js` deleted. `src/renderer/marketplace/` deleted.
  **Class:** Shipped as approved. Not a downgrade.
  **User-visible cost if wrong:** n/a.
  **Severity:** (none — control)

- **Claimed requirement:** Layer 2 Phase 2 — screenshots only after opening the detail dialog; host allowlist. Phase 1 stores `screenshots` on the item (spec field table:79).
  **What shipped:** Mapped (`marketplace-catalog.js:93`; snapshot skins row has a raw.githubusercontent URL). Settings tab **never reads** `item.screenshots`.
  **Class:** Explicit approved deferral (Phase 2). Do not inflate.
  **User-visible cost if wrong:** Cards/detail have no gallery. Expected for Phase 1.
  **Severity:** Parked-but-real (only if someone claims Phase 1 includes screenshots).

- **Claimed requirement:** (not in Layer 1; HEAD commit) “最新” sort by catalog `added`. Detail dt is `marketUpdated` / “最近更新”.
  **What shipped:** `activityTime` = `Date.parse(item.added || item.pushed || item.updated)` (`MarketplaceSettingsTab.tsx:101-120`). Catalog maps `added` only (`marketplace-catalog.js:90`) — no `pushed`/`updated` from GitHub. Detail shows `formatDay(detail?.added || …)` under **最近更新** (`262,453`). Client spec:165-176.
  **Class:** Extra vs Layer 1. UX label **Docs still lie** if read as repo last-push (old topic search had `pushed`). Behavior matches catalog listing date.
  **User-visible cost if wrong:** “最新” ≠ last commit; a plugin listed yesterday sorts above one listed last month even if the old one shipped today.
  **Severity:** Parked-but-real.

- **Claimed requirement:** `#path:` installed matching (HEAD + plan id `owner/name` with `#` in name). Sibling subpackages of one repo must not all show 已安装.
  **What shipped:** `installedName` + `marketplacePathSuffix` (`MarketplaceSettingsTab.tsx:60-75`). Client spec:321-360 distinguishes `dsh-aionui-panel` vs `dsh-skins`.
  **Class:** Shipped (fix/upgrade on this branch). Not a downgrade.
  **User-visible cost if wrong:** n/a at HEAD.
  **Severity:** (none — control)

- **Claimed requirement:** Renderer cannot invent specs / inject `runPlugin`; IPC must not spread options (adversarial install hook).
  **What shipped:** IPC builds `{ token: config.githubToken, allowBuilds: Array.isArray(...) ? ... : [], onProgress }` only (`ipc.js:154-159,140-146`). Tests: `runPlugin` from renderer is dropped (`ipc.test.js:276-337`).
  **Class:** Justified correction / hardening. Shipped.
  **User-visible cost if wrong:** n/a.
  **Severity:** (none — control)

- **Claimed requirement:** Layer 1/2/3 — Host `installPlugin` github-only; marketplace may send `#path:`. Plan:13-15.
  **What shipped:** `installPlugin` `isValidGithubSpec` (`marketplace-install.js:418-426`). Marketplace path regex `github:owner/repo#path:/…` (`204,250-260`). Host tests never list `#path:`; marketplace tests do (`186-192,250-261`). `isValidGithubSpec('github:o/r#path:/x')` is false because `:` is not in the ref charset (`install-dsh-plugin-client.js:22-42`).
  **Class:** Justified correction. Shipped.
  **User-visible cost if wrong:** If someone widened Host, composer/control-channel could install arbitrary `#path:`. They did not.
  **Severity:** (none — control)

- **Claimed requirement:** Layer 1 frontend official dsh web; spec install errors “活人能懂”. Plan unknown-id error 中文. Vendor client AGENTS: 产品文案中文; locale pair still has `en`.
  **What shipped:** UI chrome is bilingual (`locales.ts`). Main-process catalog warnings and install errors are **Chinese-only** (`WARNING_CACHE` `marketplace-catalog.js:12-13`; `未收录该插件` / `安装规格不受支持` / `该包不是可加载的 dsh 插件` / `安装失败`). English UI still displays those strings as Modal body. `listMarketplace({ locale: 'en' })` localizes description/category only.
  **Class:** Justified under 产品文案中文. Parked inconsistency for `locale === 'en'`.
  **User-visible cost if wrong:** English Settings chrome + Chinese error/warning body.
  **Severity:** Parked-but-real.

- **Claimed requirement:** Plan:22-23 — filter results >60 render 60, “显示更多” +60; category chips clip ~two rows + 展开; gap/padding 8/12/16/24.
  **What shipped:** `PAGE_SIZE = 60` (`MarketplaceSettingsTab.tsx:21,197,407-412`); client spec:363-388. CSS `.tabs { max-height: 76px }` + `data-expanded` (`MarketplaceSettingsTab.module.css:30-44`); tokens not hex. Expand button **always** shown even with three chips (spec:391-398).
  **Class:** Shipped. Minor extra expand control is not a downgrade.
  **User-visible cost if wrong:** n/a.
  **Severity:** (none — control)

- **Claimed requirement:** Spec testing section still describing “npm 优先、github 回退” if that text remains.
  **What shipped:** Spec `:189` still that sentence. Field table `:73` and plan `:61` say last-token. Code and Agent Note follow last-token. Tests follow last-token (`spec-mismatch`).
  **Class:** Docs still lie.
  **User-visible cost if wrong:** Next implementer “fixes” mapping back to npm-first **or** believes tests prove npm-first. Reviewers cannot tell which contract won.
  **Severity:** Important (process/docs). Not a runtime Blocker.

- **Claimed requirement:** Spec:206 / plan Task 6 — Agent Note records reject dshmarket, reject window, reject wrapping `#path:` in `isValidGithubSpec`. Agent Note must match code.
  **What shipped:** `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-18-desktop-marketplace-curated-catalog.md` matches last-token, pending jump, mutex, `#path:` validator, token pin **claim**, `ok: false` skips `startHarness`. It does **not** claim hoist, retarget, conflicting ids, or the startHarness-failure banner. Testing section does not mention SHA pin, 4s abort, or restart-fail UX. Surfaces note updated: boot `file:` pin, no `marketplace/index.html`.
  **Class:** Agent Note vs code: mostly honest. Omits the gaps. Spec still over-claims restart-fail UX. Not “Agent Note invented hoist.”
  **User-visible cost if wrong:** Future agents treat the note as “install is as safe as dsh-market.”
  **Severity:** Parked-but-real (note silence) + Important (spec banner lie).

---

### What is **not** a downgrade (control)

- Settings tab is the only marketplace UI; `src/renderer/marketplace/` gone; `IPC_ROLES.MARKETPLACE` gone; `shell:seed-install-draft` gone (`ipc-authorization.js:7-9`, `window-marketplace.test.js:181-183`, `ipc.test.js:267-274`).
- No first-run `dshmarket`; no copied `MarketSection`.
- Catalog URL, snapshot fallback, `DSHD_MARKETPLACE_REGISTRY_URL` test-only.
- Renderer install IPC is catalog `id` only.
- After successful add, restart is existing `startHarness()` / Harness controller, not a second Electron (the **failure copy** is the gap, not the restart mechanism).
- Official primitives / `--dsw-alias-*` on the tab; `marketplace.css` parallel-palette warnings removed from `AGENTS.md`.
- Pending marketplace jump after boot (**upgrade** vs original spec sentence).
- DROPPED hidden in list, returned from `getMarketplacePlugin`, install rejected.
- Shared mutex.
- `#path:` card matching at HEAD.
- IPC does not spread `runPlugin`.

---

### Phase-1 gaps vs dsh-market (explicit vs silent)

| dsh-market behavior | Desktop HEAD | Approved? |
| --- | --- | --- |
| `installTargetFor`: npm field else URL→github/`#path:` | last token of `install` | Layer 1 said npm-first; plan said last-token |
| `withHoistRecovery` (hoist / release-age / network / fetchTimeout) | none | **Explicit deferral** |
| `retargetCollections` | none | **Not deferred** |
| `validateAddedPlugins`: manifest + loadable + **conflictingEntryIds** | weaker `hasLoadableEntry` only | **Not deferred**; plan already weaker |
| `parsePrepareNotAllowed` + git allowBuilds key + ndjson unescape | plaintext ignored-builds only | Not deferred |
| `restoreManifestDeps` ghost-dep rollback (#65) | none | Not in Layer 1; related brick |
| npm registry anti-squat | none | **Explicit deferral** |
| 4s registry abort, TTL 1h, snapshot | yes | Aligned |

---

### Strongest next fixes (auditor, not a plan)

1. Port `conflictingEntryIds` + `hasDshManifest` (and stop treating `dsh.bundle.patch: true` as loadable). Delete/replace the `writeBundlePlugin` / exports-only success tests.
2. Implement spec:181 restart-fail payload + copy; stop treating `startHarness` throw as “install failed, try add again.”
3. Either map tarball-`install` rows like dsh-market (`url`→`github:` / `#path:`) **or** hide/disable 安装 on rejected specs so 16 live cards are not traps. Decide last-token vs npm-first in the spec testing section so it stops lying.
4. `parsePrepareNotAllowed` + git allowBuilds key if GitHub installs are a supported Phase-1 path.
5. Keep hoist/release-age/fetchTimeout parked only if product accepts slow-network GitHub `#path:` failures.

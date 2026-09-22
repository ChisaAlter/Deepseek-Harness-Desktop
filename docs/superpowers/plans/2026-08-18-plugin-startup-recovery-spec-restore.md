# Plugin Startup Recovery Spec Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD. Do **not** commit unless the user asks.

**Goal:** Restore the approved recovery spec where the implementation (and some review-fix tests) silently used a weaker contract.

**Architecture:** Keep the existing two-spawn FSM, sticky `pluginRecovery`, and `--skip-user-plugins`. Replace heuristic stand-ins with the spec’s Loader-equivalent heal, mandatory overlay `--patch`, template load that does not write the manifest, and tests that fail on the weaker behavior.

**Tech Stack:** Electron main `node:test`; vendored app-boot / CLI vitest; marketplace tab vitest/jsdom.

**Spec:** [docs/superpowers/specs/2026-08-18-plugin-startup-recovery-design.md](../specs/2026-08-18-plugin-startup-recovery-design.md)

## Global Constraints

- Restore the spec. Do not amend the spec to match the weaker code.
- Do not auto-disable loader ids; no quarantine JSON; no second port; no temp `$DSH_HOME`; no boot uninstall.
- One Loader per `$DSH_HOME`. Ready means the `dsh web:` line.
- Product copy Chinese; comments English. Boot page stays the instrument canvas with one Retry.
- Heal must **not** run `reconcileBundleLayers`.
- Do not import `@deepseek-ai/dsh-app-boot` into Electron main (CJS + `electron` in `paths.js`). Replicate `resolveBundleDir`’s two-anchor `createRequire` walk in `plugins.js`.
- Do not commit unless asked.
- Do not edit `.cursor/plans/plugin_startup_recovery_d1ae9b0d.plan.md`.
- Out of scope: wallpaper, terminal, git, titlebar, appearance.

## File map

- `src/main/plugins.js` + `plugins.test.js` — two-anchor heal; `addedPluginName`.
- `src/main/plugin-tree-failure.js` + `.test.js` — tighten `client-modules:`.
- `src/main/harness-controller.js` + `.test.js` — always `--patch`; fail-loud ensure; `retryFullPlugins`; production exit-string classification.
- `src/main/index.js` + `src/main/ipc.js` — pass `installAnchor` / `addedSpec`; Retry via controller.
- `vendor/deepseek-harness/packages/boot/app-boot/src/profile.ts` + `tests/profile.spec.ts` — skip `normalizeShippedProfile` on `bundles: 'template'`.
- Agent Note triplet `2026-08-18-skip-user-plugins-recovery-boot`.
- `MarketplaceSettingsTab.module.css` — stop restyling `Button`.

---

### Task 1: Heal with Loader-equivalent resolution

**Files:**
- Modify: `src/main/plugins.js` (`bundlePackageDirs` / `bundleResolves` / `healDanglingBundles`)
- Modify: `src/main/index.js` (pass `installAnchor`)
- Test: `src/main/plugins.test.js`

**Spec:** 用户 bundle 名：目录或 `resolveBundleDir` 失败则从 `dsh.profile.bundles` 去掉；官方模板名永不因解析不到被删。

Vendor `resolveBundleDir` (`profile.ts:352-362`): installation anchor first (`apps/cli/package.json`), then `profileDir/package.json`, via `createRequire(anchor).resolve.paths` + `existsSync(join(candidate, 'package.json'))`.

- [ ] **Step 1: Write failing tests**

Keep the existing ghost-missing test. Add:

```js
const { createRequire } = require('module');
const Module = require('module');

test('healDanglingBundles keeps a non-template name resolvable from the install anchor', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-install-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    const installPkg = path.join(install, 'apps', 'cli', 'package.json');
    fs.mkdirSync(path.dirname(installPkg), { recursive: true });
    fs.writeFileSync(installPkg, '{}\n');
    const kept = path.join(install, 'apps', 'cli', 'node_modules', 'from-install');
    fs.mkdirSync(kept, { recursive: true });
    fs.writeFileSync(path.join(kept, 'package.json'), '{"name":"from-install"}\n');
    fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { 'from-install': '1.0.0', ghost: '1.0.0' },
      dsh: { profile: { bundles: [...WEB_TEMPLATE_BUNDLES, 'from-install', 'ghost'] } },
    }, null, 2)}\n`);
    const result = healDanglingBundles({ profileDir, installAnchor: installPkg });
    assert.equal(result.ok, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.dsh.profile.bundles, [...WEB_TEMPLATE_BUNDLES, 'from-install']);
    assert.equal(manifest.dependencies.ghost, '1.0.0');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
  }
});
```

If `createRequire(installPkg).resolve.paths('from-install')` does not include `apps/cli/node_modules` on this Node, put the package at the first path that `resolve.paths` actually returns (assert that layout in the test, do not hard-code a path the resolver ignores).

- [ ] **Step 2: Run** `node --test src/main/plugins.test.js`  
  Expected: FAIL — current heal only looks at `profile/node_modules` and `profiles/node_modules`, so `from-install` is dropped.

- [ ] **Step 3: Implement**

In `plugins.js`:

```js
const { createRequire } = require('module');

function packageDirFromAnchor(anchor, packageName) {
  if (!anchor || !fs.existsSync(anchor)) return undefined;
  let search;
  try {
    search = createRequire(anchor).resolve.paths(packageName);
  } catch {
    // Invalid anchor path; treat as unresolved.
    return undefined;
  }
  for (const searchPath of search || []) {
    const candidate = path.join(searchPath, packageName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return undefined;
}

function bundleResolves(packageName, profileDir, installAnchor) {
  const anchors = [installAnchor, path.join(profileDir, 'package.json')].filter(Boolean);
  return anchors.some((anchor) => packageDirFromAnchor(anchor, packageName));
}
```

`healDanglingBundles(options)` reads `options.installAnchor`. Template names still never drop. Delete `bundlePackageDirs`.

`index.js` HarnessController:

```js
healDanglingBundles: () => healDanglingBundles({
  installAnchor: path.join(harnessRoot(), 'apps', 'cli', 'package.json'),
}),
```

Do not `require('./paths')` from `plugins.js` at load time (electron). Tests always pass `installAnchor`.

- [ ] **Step 4: Re-run** `node --test src/main/plugins.test.js` — PASS. Existing template-name and ghost tests still pass.

---

### Task 2: Recovery always `--patch` overlay; ensure fail-loud

**Files:**
- Modify: `src/main/harness-controller.js` (`dshStartOptions`, `prepareProfile`, constructor `overlayExists`)
- Modify: `src/main/harness-controller.test.js`
- Modify: `src/main/plugins.js` only if `ensureDesktopInstallPlugin` should throw instead of `{ ok: false }` — prefer controller fail-loud so CLI-less tests keep `{ ok: false }`.

**Spec:** 恢复启动必须 `--patch` overlay。缺文件走 vendor `loadOverlayPatches` fail-loud，不是省略旗标。

- [ ] **Step 1: Replace the omit test**

Delete `recovery omits overlay --patch when the overlay file is missing`.

Add:

```js
test('prepareProfile fails loud when desktop-install overlay cannot be written', async () => {
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: false, reason: 'missing-source:install-dsh-plugin.mjs' }),
  });
  await assert.rejects(() => f.controller.start(), /桌面安装插件/);
  assert.equal(f.dsh.startCalls, 0);
  assert.equal(f.controller.snapshot().pluginRecovery.skipUserPlugins, false);
});
```

Keep `full plugin-tree failure retries once…` asserting `patchFiles: ['C:/overlay.yml']` on the skip spawn.

- [ ] **Step 2: Run** `node --test src/main/harness-controller.test.js`  
  Expected: FAIL — omit test gone; new test currently logs ensure failure and still starts.

- [ ] **Step 3: Implement**

`dshStartOptions`: if skip, always `options.patchFiles = [overlay]` when `overlay` is non-empty. Remove `overlayExists`.

`prepareProfile`:

```js
const ensured = this.ensureDesktopInstallPlugin();
if (ensured && ensured.ok === false) {
  throw new Error(`桌面安装插件写入失败：${ensured.reason || 'unknown'}`);
}
```

Do **not** catch this in `prepareProfile`. `performStart` treats it as other startup failure: no skip write, no recovery spawn.

Fixture `ensureDesktopInstallPlugin` default `() => ({ ok: true })`. Remove `overlayExists: () => true` from fixture.

- [ ] **Step 4: Re-run** controller tests — PASS. Skip spawn still receives `patchFiles`.

---

### Task 3: `bundles: 'template'` must not write the manifest

**Files:**
- Modify: `vendor/deepseek-harness/packages/boot/app-boot/src/profile.ts`
- Test: `packages/boot/app-boot/tests/profile.spec.ts`
- Docs: Agent Note triplet + `LoadProfileOptions` JSDoc (already claims never writes — make it true)

**Spec:** `template` 用 `PROFILE_TEMPLATES[name]`，不调用 `writeProfileManifest`。

- [ ] **Step 1: Failing tests**

Headless installation-owned 3-tuple currently writes on any `loadProfile`:

```ts
it('template load does not rewrite an installation-owned headless tuple', () => {
  const anchor = stageInstallation({
    '@deepseek-ai/dsh-base': { patch: '[]\n' },
    '@deepseek-ai/dsh-headless': { patch: '[]\n' },
  })
  const home = tmp()
  const dir = resolveProfileDir('headless', home)
  const owned = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless']
  initProfile(dir, owned)
  const before = readFileSync(join(dir, 'package.json'), 'utf8')
  loadProfile('t', 'headless', anchor, home, { bundles: 'template', userLayer: false })
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
})

it('template load with no PROFILE_TEMPLATES entry uses DEFAULT_PROFILE_BUNDLES', () => {
  const anchor = stageInstallation({ '@deepseek-ai/dsh-base': { patch: '[]\n' } })
  const home = tmp()
  const dir = resolveProfileDir('custom', home)
  initProfile(dir, ['@deepseek-ai/dsh-base', 'ghost-bundle'])
  const profile = loadProfile('t', 'custom', anchor, home, { bundles: 'template', userLayer: false })
  expect(profile.layers.map(layer => layer.packageName)).toEqual([...DEFAULT_PROFILE_BUNDLES])
})
```

Use the same `stageInstallation` / `initProfile` helpers as the existing web template test. If `initProfile` for `custom` is illegal, write the profile `package.json` the same way other tests create a bare profile.

- [ ] **Step 2: Run** from `vendor/deepseek-harness`:  
  `pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts`  
  Expected: FAIL — `normalizeShippedProfile` rewrites headless; `DEFAULT_PROFILE_BUNDLES` branch untested or unused.

- [ ] **Step 3: Implement**

In `loadProfile`, after the missing-profile `initProfile` branch:

```ts
const recorded = readProfileManifest(binName, dir)
const manifest = options.bundles === 'template'
  ? recorded
  : normalizeShippedProfile(name, dir, recorded)
```

Do not call `normalizeShippedProfile` when `bundles === 'template'`.

- [ ] **Step 4: Re-run** profile.spec.ts — PASS.

- [ ] **Step 5: Agent Note** — Decision already says it never writes `dsh.profile.bundles`. Keep that sentence. If any line implies normalize still runs on skip, rewrite to: template load reads the on-disk manifest only to leave it untouched, then resolves `PROFILE_TEMPLATES` / `DEFAULT_PROFILE_BUNDLES`. Re-record the i18n sidecar (`pnpm run verify-translation-pairing --write` on the note pair). Note files must stay LF.

---

### Task 4: Classify this spawn like production; tighten `client-modules:`

**Files:**
- Modify: `src/main/plugin-tree-failure.js` + `.test.js`
- Modify: `src/main/harness-controller.test.js` (FakeDsh full-fail path)
- Keep: per-spawn `this.logs = []` in `dsh.js` `_start` / FakeDsh `start`

**Spec:** plugin-tree 包括 stderr / 退出信息中的 listed markers；`client-modules:` 是**组合失败**（含 `ClientPackageCompositionError`）。HTTP 已通随后 tree fail exit 1 不得 `ready`、不得 `beginRuntimeRecovery`。

Production `_onChildExit` message is `dsh 进程结束（code …）`. Classification must use **this spawn’s** logs, not the throw message.

- [ ] **Step 1: Failing tests**

`plugin-tree-failure.test.js`:

```js
assert.equal(isPluginTreeFailure('client-modules: ClientPackageCompositionError'), true);
assert.equal(isPluginTreeFailure('client-modules: composition failed'), true);
assert.equal(isPluginTreeFailure('client-modules: bundle route'), false);
```

Controller: change `full plugin-tree failure retries once with skip-user-plugins` so FakeDsh on error does:

```js
this.log('plugin tree failed to load');
this.setState('error', {
  error: 'dsh 进程结束（code 1, signal none）',
  failure: { phase: 'startup', message: 'dsh 进程结束（code 1, signal none）' },
});
throw new Error('dsh 进程结束（code 1, signal none）');
```

Do this in FakeDsh.start for every `Error` result (mirrors production), **after** `this.logs = []`. The recovery path must still classify via the log line. Runtime `crash('plugin tree failed to load')` stays as the explicit runtime-marker case.

Keep `dsh.test.js` `HTTP 200 is not ready until the dsh web: line` and `plugin-tree stderr without dsh web: never becomes ready`. Do not assert `beginRuntimeRecovery` inside DshManager; controller covers cancel-auto-restart.

- [ ] **Step 2: Run** plugin-tree-failure + harness-controller tests.  
  Expected: FAIL on `bundle route` (today `includes('client-modules:')` is true). Full-fail skip spawn may still pass because logs are scanned — that is desired. If it fails, the classifier is not looking at this spawn’s logs.

- [ ] **Step 3: Implement**

```js
const PLUGIN_TREE_MARKERS = [
  'plugin tree failed to load',
  'cannot resolve profile bundle',
  'failed to apply loader entry',
  'entries did not activate',
];

function isPluginTreeFailure(text) {
  const blob = String(text || '').toLowerCase();
  if (!blob) return false;
  if (PLUGIN_TREE_MARKERS.some((marker) => blob.includes(marker))) return true;
  if (!blob.includes('client-modules:')) return false;
  return blob.includes('clientpackagecompositionerror')
    || blob.includes('composition failed')
    || blob.includes('组合失败');
}
```

Keep scanning `error + failure.message + snapshot.logs` in `looksLikePluginTree`. Logs are already this spawn only.

- [ ] **Step 4: Re-run** both suites — PASS.

---

### Task 5: Retry-full and skip-uninstall on the controller

**Files:**
- Modify: `src/main/harness-controller.js` (add `retryFullPlugins`)
- Modify: `src/main/ipc.js` (`shell:restart` / `shell:retry-full-plugins` / uninstall success)
- Test: `src/main/harness-controller.test.js`

**Spec:** 启动页「重试」清 skip 再完整启动。skip 模式卸载：清 skip 并完整启动。Tray `restartWithCleanup` is **not** the boot Retry; leave it on `restart()` without clearing skip.

- [ ] **Step 1: Failing tests**

```js
test('retryFullPlugins clears sticky skip and spawns a full composition', async () => {
  const f = fixture();
  f.setConfig({
    pluginRecovery: {
      skipUserPlugins: true, reason: 'previous', at: '', appVersion: '1.2.3',
    },
  });
  await f.controller.start();
  assert.equal(f.dsh.startOptions.at(-1).skipUserPlugins, true);
  await f.controller.retryFullPlugins();
  assert.equal(f.controller.snapshot().pluginRecovery.skipUserPlugins, false);
  assert.equal(Boolean(f.dsh.startOptions.at(-1).skipUserPlugins), false);
});
```

Uninstall-equivalent: same as retry-full after skip (IPC clears then `startHarness`). One test is enough if ipc calls `harness.retryFullPlugins()` for both boot Retry and skip-uninstall success.

- [ ] **Step 2: Run** — FAIL (`retryFullPlugins` missing).

- [ ] **Step 3: Implement**

```js
retryFullPlugins() {
  this.clearPluginRecovery();
  return this.restart({ allowPluginRecovery: true });
}
```

`ipc.js`:

```js
handle('shell:restart', BOOT_ONLY, async () => {
  await (harness ? harness.retryFullPlugins() : startHarness());
  return harness ? harness.snapshot() : dsh.snapshot();
});
handle('shell:retry-full-plugins', [IPC_ROLES.HARNESS, IPC_ROLES.BOOT], async () => {
  await (harness ? harness.retryFullPlugins() : startHarness());
  return harness ? harness.snapshot() : dsh.snapshot();
});
```

Uninstall success: `await harness.retryFullPlugins()` instead of `saveConfig(emptyPluginRecovery())` + `startHarness()`, so skip is cleared through one owner. Failed uninstall after `beforeMutate` still `startHarness()` **without** clearing skip.

When `harness` is missing, keep `saveConfig({ pluginRecovery: emptyPluginRecovery() })` then `startHarness()`.

- [ ] **Step 4: Re-run** controller tests — PASS.

---

### Task 6: Rollback the added package, not the first new dependency name

**Files:**
- Modify: `src/main/plugins.js` (`addedPluginName`)
- Modify: `src/main/harness-controller.js` (`restartAfterInstall`)
- Modify: `src/main/index.js` / `src/main/ipc.js` (pass `addedSpec: result.spec`)
- Test: `src/main/plugins.test.js`, `src/main/harness-controller.test.js`

**Spec:** remove 刚加的那个包。`installPlugin` already returns `spec` (pinned github string). `listInstalledPlugins` rows have `{ name, spec }`.

- [ ] **Step 1: Failing tests**

```js
test('addedPluginName prefers the row whose spec matches the install pin', () => {
  assert.equal(addedPluginName(
    { plugins: [] },
    { plugins: [
      { name: 'transitive', spec: '1.0.0' },
      { name: 'loop', spec: 'github:owner/dsh-loop#abc' },
    ] },
    'github:owner/dsh-loop#abc',
  ), 'loop');
});
```

Controller rollback test: `after` has two new names; pass `addedSpec: 'github:owner/ghost#sha'`; assert `removed` is `ghost` not `transitive`. Keep the existing “full start succeeds after remove” test (one plugin-tree error). Keep the two-error test as “if that full start also tree-fails, FSM skip applies”.

- [ ] **Step 2: Run** — FAIL (`addedPluginName` missing).

- [ ] **Step 3: Implement**

```js
function addedPluginName(before, after, addedSpec = '') {
  const spec = String(addedSpec || '');
  if (spec) {
    const hit = (after?.plugins || []).find((row) => row?.spec === spec);
    if (hit?.name) return hit.name;
  }
  return firstAddedPluginName(before, after);
}
```

Keep spec-change detection in `firstAddedPluginName` as fallback when `addedSpec` is empty (upgrade of an existing name).

`restartAfterInstall({ before, after, addedSpec, uninstallPlugin })` uses `addedPluginName(before, after, addedSpec)`.

```js
function restartAfterInstall(before, after, addedSpec) {
  cleanupDesktopResources();
  return harness.restartAfterInstall({ before, after, addedSpec, uninstallPlugin });
}
```

IPC: `restartAfterInstall(before, result.installed, result.spec)`.  
`index.js` pending install: store `addedSpec: result.spec` and pass it through.

- [ ] **Step 4: Re-run** plugins + controller tests — PASS.

---

### Task 7: Marketplace notice must not restyle `Button`

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.module.css`
- Keep: notice as first child; `Button variant="ghost" size="sm"`; copy 第三方插件已跳过 / 重试完整启动
- Test: existing `places the skip notice above the marketplace toolbar` still passes

**Spec:** 市场 Tab 顶上用 `ui-primitives` 做告示. There is no general Notice primitive (`ConnectionBanner` is connection-loss only). Do **not** invent a second banner atom. Use `Button` at stock `sm` geometry.

- [ ] **Step 1:** Remove `.skipNotice button` / `:hover` rules that set `height: 32px`, `border-radius: 8px`, and color-only hover. Compose `.skipNotice` from `.banner` (shared fill/padding) plus `display: flex` / `justify-content: space-between` / `gap`. Do not force button height.

- [ ] **Step 2:** Run from `vendor/deepseek-harness`:  
  `pnpm exec vitest run packages/client/ui-settings-plugin-inventory/tests/marketplace.client.spec.tsx packages/client/ui-settings-plugin-inventory/tests/browser-plugin.client.spec.tsx`  
  Expected: PASS (behavior unchanged). If a test queried a class name, fix the test to keep role/text assertions.

---

### Task 8: Single `pluginRecovery` owner + named catch

**Files:**
- Modify: `src/main/harness-controller.js` (`writePluginSkip` slice; `finishReady` catch)
- Optional: import `emptyPluginRecovery` from `config.js` **only if** controller tests still load without electron. Prefer keep `EMPTY_PLUGIN_RECOVERY` duplicate rather than `require('./config')` (config.js requires electron). Document that `saveConfig` / `normalizePluginRecovery` is the persistence owner (`reason` max 500).

- [ ] **Step 1:** `writePluginSkip` — stop `.slice(0, 300)`; persist full string; `normalizePluginRecovery` already slices to 500 on save.

- [ ] **Step 2:** Name the `finishReady` catch:

```js
await this.ensureBootVisible().catch(() => {
  // Window already gone or boot navigation failed after a runtime abort.
});
```

- [ ] **Step 3:** Run `node --test src/main/harness-controller.test.js src/main/config.test.js` — PASS.

---

## Verification (after all tasks)

Desktop:

```
node --test src/main/plugins.test.js src/main/plugin-tree-failure.test.js src/main/dsh.test.js src/main/harness-controller.test.js src/main/config.test.js src/main/desktop-install-control.test.js src/main/marketplace-install.test.js src/main/ipc-authorization.test.js src/preload/shell-api.test.js
```

Vendor:

```
pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts apps/cli/tests/args.spec.ts apps/cli/tests/profile-boot.spec.ts apps/cli/tests/dump-config.spec.ts packages/client/ui-settings-plugin-inventory/tests/marketplace.client.spec.tsx packages/client/ui-settings-plugin-inventory/tests/browser-plugin.client.spec.tsx
```

from `vendor/deepseek-harness`.

Agent Note pairing: `pnpm run verify-translation-pairing -- packages/boot/app-boot/README.md` only if README changed; for the note: `pnpm run verify-translation-pairing -- .agents/notes/implemented/architecture/2026-08-18-skip-user-plugins-recovery-boot.md` after `--write`.

## Spec coverage

| Spec item | Task |
|---|---|
| Heal = directory or `resolveBundleDir` | 1 |
| Overlay `--patch` mandatory; missing overlay fail-loud | 2 |
| `bundles: 'template'` does not write the manifest | 3 |
| `DEFAULT_PROFILE_BUNDLES` fallback | 3 |
| Ready = `dsh web:`; HTTP then tree fail never ready | 4 + existing dsh tests |
| Cancel runtime auto-restart; this-spawn logs | 4 |
| `client-modules:` = composition failure | 4 |
| Boot Retry / market retry-full clears skip | 5 |
| Skip uninstall clears skip and full-starts | 5 |
| Remove the package just added | 6 |
| Market notice uses primitive Button geometry | 7 |
| Official template name not healed away | already Task 1 existing test; start-fail is Loader (`cannot resolve profile bundle`) |
| No disable-by-id / second port / boot uninstall | unchanged |

## Self-review

- Overlay omit test is deleted, not kept as a “valid weaker path”.
- Heal does not `require('./paths')` at module load.
- Tray restart still does not clear skip (spec names the boot Retry only).
- Two-error install test remains the “second full start also tree-fails → skip FSM” case; the one-error test remains “再完整启动成功”.

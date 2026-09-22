# Plugin Startup Recovery Delivery Restore Implementation Plan

> **For agentic workers:** Use executing-plans (or subagent-driven-development) task-by-task. TDD. Do **not** commit unless the user asks. Work on the current checkout (uncommitted recovery + prior spec-restore).

**Goal:** Close every remaining spec hole so production and tests match the approved recovery spec — no missing listed tests, no weaker substitute locked in.

**Architecture:** Keep the two-spawn FSM, sticky `pluginRecovery`, and `--skip-user-plugins`. Make heal byte-equivalent to vendor `packageDirFromAnchor`, classify Chinese 组合失败, use a primitive **primary** Button as the market notice CTA, and add tests that fail if those contracts weaken.

**Tech Stack:** Electron main `node:test`; vendored vitest/jsdom for marketplace; no `dsh-app-boot` import into Electron.

**Spec:** [docs/superpowers/specs/2026-08-18-plugin-startup-recovery-design.md](../specs/2026-08-18-plugin-startup-recovery-design.md)

## Global Constraints

- Restore the spec. Do not amend the spec to match weaker code or tests.
- Do not auto-disable loader ids; no quarantine JSON; no second port; no temp `$DSH_HOME`; no boot uninstall.
- One Loader per `$DSH_HOME`. Ready means the `dsh web:` line.
- Product copy Chinese; comments English. Boot page stays the instrument canvas with one Retry (label 「重试」, not 「安全模式」).
- Heal must **not** run `reconcileBundleLayers`.
- Do not import `@deepseek-ai/dsh-app-boot` into Electron main. Heal must still match `resolveBundleDir` / `packageDirFromAnchor`.
- Do not commit unless asked.
- Do not edit `.cursor/plans/plugin_startup_recovery_d1ae9b0d.plan.md`.
- Out of scope: wallpaper, terminal, git, titlebar, appearance. Do not mix those into this change set beyond files this plan names.

## Completeness lock (do not drop a row)

Every spec obligation maps to a task or to an **already-proven** existing test. Executors must not skip a row because “production already looks right.”

| Spec obligation | Status now | This plan |
|---|---|---|
| Recovery does not rewrite user profile except heal | Proven (`profile.spec.ts` template load) | Keep |
| One Loader; no second port | Proven (controller one extra spawn) | Keep |
| No `disabled: true` / JSON ledger | Proven (`config.test.js`) | Keep |
| Ready = `dsh web:`; HTTP alone is not ready | Proven (`dsh.test.js`) | Keep |
| `--skip-user-plugins` flag order, dump mutex, skip dump tree | Proven (CLI specs) | Keep |
| Template load does not write manifest | Proven | Keep |
| Skip profile/home patch; `--patch` kept | Proven | Keep |
| Overlay `--patch` always on recovery | Proven (controller `patchFiles`) | Keep |
| Sticky skip + version clear | Proven | Keep |
| Install rollback by `addedSpec`; skip-install does not remove | Proven | Keep |
| `stripDroppedPlugins` toggles vs desktop-install | Proven | Keep |
| `pluginBoot.failed` recover vs skip official fault | Proven | Keep |
| Rejected designs absent | Proven | Keep |
| Heal = `resolveBundleDir` even if CLI `package.json` missing | **Production weaker** | Task 1 |
| Heal on `performStart` (not only unit) | **Unproven** | Task 4 |
| Official template name not healed; start fails | **Unproven on start path** | Task 4 |
| HTTP + tree exit 1 never `beginRuntimeRecovery` | **Unproven** | Task 5 |
| `client-modules:` **组合失败** | **Wrong token `组成失败`** | Task 2 |
| Skip uninstall clears skip + full start | Production yes, **IPC untested** | Task 6 |
| Boot Retry clears skip | Production yes, **untested** | Task 6 |
| Boot copy + log filter | Production mostly, **untested**; error line uses 「Harness 启动失败」 | Task 7 |
| Market 告示 **主按钮** 「重试完整启动」 | Ghost/sm stand-in | Task 3 |
| `watchUserPatches` not hung on skip | Helper proven; keep | Task 8 comment only |
| Install non-tree failure must not remove / not extra skip spawn | Catch-all second restart | Task 8 |
| Named swallow on plugin-tree runtime `allSettled` | Unnamed | Task 8 |
| `reason` max 500 | Owner exists, **untested** | Task 8 |

## File map

- `src/main/plugins.js` + `plugins.test.js` — heal without `existsSync(anchor)`.
- `src/main/plugin-tree-failure.js` + `.test.js` — `组合失败`.
- `src/main/plugin-recovery-actions.js` + `.test.js` — IPC retry/uninstall without electron.
- `src/main/ipc.js` — call those actions.
- `src/main/harness-controller.js` + `.test.js` — heal-on-start, official-template fail, `beginRuntimeRecovery` spy, install non-tree, named catch.
- `src/main/dsh.test.js` — HTTP+tree never ready (keep) + phase startup pin.
- `src/main/config.test.js` — reason 500.
- `src/renderer/boot-recovery.js` + `.test.js` — copy + log filter; `boot.js` consumes it.
- Marketplace tab TSX — `Button variant="primary"`.

---

### Task 1: Heal matches vendor when the anchor file is missing

**Files:**
- Modify: `src/main/plugins.js` `packageDirFromAnchor`
- Test: `src/main/plugins.test.js`

**Interfaces:**
- Consumes: existing `healDanglingBundles({ profileDir, installAnchor })`
- Produces: same signature; `packageDirFromAnchor` does **not** `existsSync(anchor)` before `createRequire`

Vendor `packageDirFromAnchor` (`profile.ts:330-336`) calls `createRequire(anchor).resolve.paths` with no file existence check.

- [ ] **Step 1: Write the failing test**

```js
test('healDanglingBundles keeps a name resolvable when the install anchor file is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-install-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    const installPkg = path.join(install, 'apps', 'cli', 'package.json');
    fs.mkdirSync(path.dirname(installPkg), { recursive: true });
    // Do not write installPkg — Loader still walks resolve.paths from that path.
    const search = createRequire(installPkg).resolve.paths('from-install') || [];
    const searchDir = search[0];
    assert.ok(searchDir);
    const kept = path.join(searchDir, 'from-install');
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

- [ ] **Step 2: Run** `node --test src/main/plugins.test.js`  
  Expected: FAIL — current `existsSync(anchor)` returns undefined and drops `from-install`.

- [ ] **Step 3: Implement**

```js
function packageDirFromAnchor(anchor, packageName) {
  if (!anchor) return undefined;
  let search;
  try {
    search = createRequire(anchor).resolve.paths(packageName);
  } catch {
    // Invalid anchor string; treat as unresolved (Loader would throw on the same path).
    return undefined;
  }
  for (const searchPath of search || []) {
    const candidate = path.join(searchPath, packageName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return undefined;
}
```

Keep template-name protection and “do not touch dependencies.”

- [ ] **Step 4: Re-run** `node --test src/main/plugins.test.js` — PASS including the existing real-file install-anchor test.

---

### Task 2: Classify `client-modules:` 组合失败

**Files:**
- Modify: `src/main/plugin-tree-failure.js`
- Test: `src/main/plugin-tree-failure.test.js`

**Interfaces:**
- Consumes: `isPluginTreeFailure(text)`
- Produces: same; Chinese arm is `组合失败` (spec). Keep `failed to compose` (vendor English).

- [ ] **Step 1: Failing asserts** inside the existing composition test:

```js
assert.equal(isPluginTreeFailure('client-modules: 组合失败'), true);
assert.equal(isPluginTreeFailure('client-modules: 组成失败'), false);
```

- [ ] **Step 2: Run** `node --test src/main/plugin-tree-failure.test.js`  
  Expected: FAIL (`组成失败` is true today; `组合失败` is false).

- [ ] **Step 3:** Replace `组成失败` with `组合失败`. Keep `ClientPackageCompositionError`, `composition failed`, `failed to compose`. Keep `bundle route` → false.

- [ ] **Step 4: Re-run** — PASS.

---

### Task 3: Market notice uses the primitive main Button

**Files:**
- Modify: `MarketplaceSettingsTab.tsx`
- Test: `marketplace.client.spec.tsx` (and browser-plugin spec if it asserts variant)

**Spec:** 市场 Tab 顶上用 `ui-primitives` 做告示；**主按钮**「重试完整启动」。Do not invent a Notice atom. `Button` default variant is `ghost`; **main** in this atom set is `variant="primary"`. Keep `size="sm"` so the strip still fits (do not add height/radius CSS on the button).

- [ ] **Step 1:** In `marketplace.client.spec.tsx` after finding the retry button, assert it is the notice’s action and uses the primary class from the primitive (the module class contains `primary`, not a custom 32px rule):

```tsx
const retry = screen.getByRole('button', { name: en.marketRetryFull })
expect(retry.className).toMatch(/primary/)
expect(retry.className).not.toMatch(/ghost/)
```

If CSS modules hash the name, match `/primary/` still works (local name is `primary`).

- [ ] **Step 2: Run** from `vendor/deepseek-harness`:  
  `pnpm exec vitest run packages/client/ui-settings-plugin-inventory/tests/marketplace.client.spec.tsx`  
  Expected: FAIL (current `ghost`).

- [ ] **Step 3:**

```tsx
<Button type="button" variant="primary" size="sm" onClick={() => { void retryFullPlugins() }}>
  {t('marketRetryFull')}
</Button>
```

No `.skipNotice button` geometry. Keep grouped `.banner, .skipNotice` fill. Copy unchanged: `第三方插件已跳过` / `重试完整启动`. First child of the section.

- [ ] **Step 4: Re-run** marketplace + browser-plugin specs — PASS.

---

### Task 4: `performStart` heal + official template start-fail

**Files:**
- Modify: `src/main/harness-controller.test.js` only (production already calls heal)

**Interfaces:**
- Consumes: `healDanglingBundles` from `./plugins`, `WEB_TEMPLATE_BUNDLES`
- Fixture still stubs heal by default so other tests stay isolated.

- [ ] **Step 1: Failing tests**

Use a temp profile + real `healDanglingBundles`. Controller `healDanglingBundles` override calls the real function.

```js
const { healDanglingBundles, WEB_TEMPLATE_BUNDLES } = require('./plugins');

test('performStart heals a dangling non-template name and keeps dependencies', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const profileDir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  const file = path.join(profileDir, 'package.json');
  fs.writeFileSync(file, `${JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { ghost: '1.0.0' },
    dsh: { profile: { bundles: [...WEB_TEMPLATE_BUNDLES, 'ghost'] } },
  }, null, 2)}\n`);
  try {
    const f = fixture({
      healDanglingBundles: () => healDanglingBundles({ profileDir }),
    });
    await f.controller.start();
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(manifest.dsh.profile.bundles, [...WEB_TEMPLATE_BUNDLES]);
    assert.equal(manifest.dependencies.ghost, '1.0.0');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an unresolvable official template name is not healed away and start fails', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const profileDir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  const file = path.join(profileDir, 'package.json');
  fs.writeFileSync(file, `${JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: {},
    dsh: { profile: { bundles: [...WEB_TEMPLATE_BUNDLES] } },
  }, null, 2)}\n`);
  try {
    const f = fixture({
      healDanglingBundles: () => healDanglingBundles({ profileDir }),
    });
    f.dsh.startResults.push(
      new Error('cannot resolve profile bundle "@deepseek-ai/dsh-web-app"'),
      new Error('cannot resolve profile bundle "@deepseek-ai/dsh-web-app"'),
    );
    await assert.rejects(() => f.controller.start());
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(manifest.dsh.profile.bundles, [...WEB_TEMPLATE_BUNDLES]);
    assert.equal(f.dsh.startCalls, 2); // full then one recovery; no third
    assert.equal(f.controller.snapshot().pluginRecovery.skipUserPlugins, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
```

If FakeDsh Error path logs the message then throws `dsh 进程结束…`, classification still uses logs — keep that.

- [ ] **Step 2: Run** `node --test src/main/harness-controller.test.js`  
  Expected: FAIL on the new tests until wired (first test may PASS already if start calls heal — that is OK; the official-template test must FAIL if heal drops names or a third spawn happens). If the first test already PASSES, keep it as the spec pin.

- [ ] **Step 3:** Production already heals in `prepareProfile`. Only add tests unless something fails.

- [ ] **Step 4: Re-run** — PASS.

---

### Task 5: Plugin-tree must not `beginRuntimeRecovery`

**Files:**
- Modify: `src/main/harness-controller.test.js`
- Modify: `src/main/dsh.test.js` only if the HTTP+tree test does not already assert `failure.phase === 'startup'` (it does — add an explicit “not ready” + startup pin comment is not enough; add controller spy).

- [ ] **Step 1:**

```js
test('plugin-tree startup failure does not beginRuntimeRecovery', async () => {
  const f = fixture();
  let began = 0;
  const original = f.controller.beginRuntimeRecovery.bind(f.controller);
  f.controller.beginRuntimeRecovery = async (...args) => {
    began += 1;
    return original(...args);
  };
  f.dsh.startResults.push(new Error('plugin tree failed to load'));
  f.dsh.startResults.push(new Error('plugin tree failed to load'));
  await assert.rejects(() => f.controller.start());
  assert.equal(began, 0);
});
```

Keep existing `plugin-tree runtime crash returns to boot without scheduling auto-restart`. Keep `dsh.test.js` `plugin-tree stderr without dsh web: never becomes ready` (`failure.phase === 'startup'`).

- [ ] **Step 2: Run** controller tests — FAIL if `began > 0`.

- [ ] **Step 3:** If it already PASSES, keep the test as the spec pin. If it fails, production must not call `beginRuntimeRecovery` on startup-phase tree fail (already the `phase === 'runtime'` guard).

- [ ] **Step 4: Re-run** `node --test src/main/harness-controller.test.js src/main/dsh.test.js` — PASS.

---

### Task 6: Boot Retry and skip-uninstall share one tested owner

**Files:**
- Create: `src/main/plugin-recovery-actions.js`
- Create: `src/main/plugin-recovery-actions.test.js`
- Modify: `src/main/ipc.js` (`retryFull` / uninstall success / `shell:restart`)

**Interfaces:**
- Produces:

```js
async function retryFullPluginsFromIpc({
  harness,
  startHarness,
  saveConfig,
  emptyPluginRecovery,
  cleanup,
}) {
  if (harness) {
    if (typeof cleanup === 'function') cleanup();
    return harness.retryFullPlugins();
  }
  saveConfig({ pluginRecovery: emptyPluginRecovery() });
  await startHarness();
  return undefined;
}

async function restartAfterPluginUninstall({
  ok,
  stopped,
  retryFull,
  startHarness,
}) {
  if (ok) return retryFull();
  if (stopped) return startHarness(); // do not clear skip
  return undefined;
}
```

- [ ] **Step 1: Failing tests** in `plugin-recovery-actions.test.js`

```js
test('retryFullPluginsFromIpc clears skip through harness.retryFullPlugins', async () => {
  const calls = [];
  await retryFullPluginsFromIpc({
    harness: {
      retryFullPlugins: async () => {
        calls.push('retry');
        return { pluginRecovery: { skipUserPlugins: false } };
      },
    },
    cleanup: () => calls.push('cleanup'),
    startHarness: async () => calls.push('start'),
    saveConfig: () => calls.push('save'),
    emptyPluginRecovery: () => ({ skipUserPlugins: false }),
  });
  assert.deepEqual(calls, ['cleanup', 'retry']);
});

test('retryFullPluginsFromIpc without harness saves empty recovery then starts', async () => {
  const calls = [];
  await retryFullPluginsFromIpc({
    harness: null,
    startHarness: async () => calls.push('start'),
    saveConfig: (patch) => calls.push(`save:${patch.pluginRecovery.skipUserPlugins}`),
    emptyPluginRecovery: () => ({ skipUserPlugins: false }),
  });
  assert.deepEqual(calls, ['save:false', 'start']);
});

test('successful skip uninstall retries full; failed uninstall after stop does not', async () => {
  const calls = [];
  await restartAfterPluginUninstall({
    ok: true,
    stopped: true,
    retryFull: async () => calls.push('retry'),
    startHarness: async () => calls.push('start'),
  });
  await restartAfterPluginUninstall({
    ok: false,
    stopped: true,
    retryFull: async () => calls.push('retry'),
    startHarness: async () => calls.push('start'),
  });
  assert.deepEqual(calls, ['retry', 'start']);
});
```

- [ ] **Step 2: Run** `node --test src/main/plugin-recovery-actions.test.js` — FAIL (module missing).

- [ ] **Step 3:** Implement the module. `ipc.js`: `retryFull` becomes `retryFullPluginsFromIpc(...)`. Uninstall uses `restartAfterPluginUninstall`. `shell:restart` and `shell:retry-full-plugins` both call `retryFull` (spec: boot Retry clears skip).

- [ ] **Step 4: Re-run** actions tests + `ipc-authorization.test.js` — PASS.

---

### Task 7: Boot copy and log filter are tested; error title is spec 「启动失败」

**Files:**
- Create: `src/renderer/boot-recovery.js`
- Create: `src/renderer/boot-recovery.test.js`
- Modify: `src/renderer/boot.js` to import helpers (keep DOM wiring in `boot.js`)

**Spec copy:** skip starting 「正在以官方组合启动」 / 「第三方插件导致上次启动失败，已暂时跳过」. Recovery-fail 「启动失败」+ 日志. Retry label 「重试」. Filter keeps `plugin tree failed to load`, `cannot get property`, `cannot resolve profile bundle`.

- [ ] **Step 1:**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  skipStartingCopy,
  startupErrorLabel,
  retryActionLabel,
  isImportantBootLog,
} = require('./boot-recovery');

test('skip starting copy matches the spec', () => {
  assert.deepEqual(skipStartingCopy(), {
    status: '正在以官方组合启动',
    hint: '第三方插件导致上次启动失败，已暂时跳过',
  });
});

test('recovery-fail label is 启动失败 and retry stays 重试', () => {
  assert.equal(startupErrorLabel(), '启动失败');
  assert.equal(retryActionLabel(false), '重试');
  assert.equal(retryActionLabel(true), '立即重启');
});

test('boot log filter keeps plugin-tree lines', () => {
  assert.equal(isImportantBootLog('plugin tree failed to load'), true);
  assert.equal(isImportantBootLog('cannot get property "tools" without inject'), true);
  assert.equal(isImportantBootLog('cannot resolve profile bundle "ghost"'), true);
  assert.equal(isImportantBootLog('listening on 127.0.0.1'), false);
});
```

- [ ] **Step 2: Run** `node --test src/renderer/boot-recovery.test.js` — FAIL.

- [ ] **Step 3:** Implement `boot-recovery.js`. `boot.js` `renderState`: when `starting && skipUserPlugins`, use `skipStartingCopy()`; when `state === 'error'` and not runtime, `statusEl.textContent = startupErrorLabel()` (today it hard-codes `Harness 启动失败` — that is a copy downgrade). Retry: `retryActionLabel(runtimeFailure)`. `visibleLogs` uses `isImportantBootLog`.

Do not add a second boot button. Do not change `boot.html` canvas.

- [ ] **Step 4: Re-run** boot-recovery tests — PASS.

---

### Task 8: Install non-tree does not rollback; polish that blocks delivery

**Files:**
- Modify: `src/main/harness-controller.js` `restartAfterInstall` + plugin-tree runtime `allSettled`
- Test: `src/main/harness-controller.test.js`
- Test: `src/main/config.test.js` (reason 500)
- Modify: `src/main/plugins.js` comment on `WEB_TEMPLATE_BUNDLES`
- Modify: `vendor/deepseek-harness/packages/boot/app-boot/src/profile.ts` JSDoc if it still calls skip a “bundles-only consumer” beside dump-default-config

**Spec:** install step 4 is plugin-tree → remove → full start. Other failures take the normal startup error path (no remove). Runtime plugin-tree: cancel auto-restart; empty catch must name what it swallows.

- [ ] **Step 1:**

```js
test('install non-tree failure does not remove the package or spawn recovery', async () => {
  const removed = [];
  const f = fixture();
  await f.controller.start();
  const starts = f.dsh.startCalls;
  f.dsh.startResults.push(new Error('listen EADDRINUSE: address already in use'));
  await assert.rejects(() => f.controller.restartAfterInstall({
    before: { plugins: [] },
    after: { plugins: [{ name: 'ghost', spec: '1.0.0' }] },
    uninstallPlugin: async (name) => { removed.push(name); },
  }));
  assert.deepEqual(removed, []);
  assert.equal(f.dsh.startCalls, starts + 1);
  assert.equal(f.controller.snapshot().pluginRecovery.skipUserPlugins, false);
});
```

Config:

```js
test('pluginRecovery reason is capped at 500 characters', () => {
  const saved = saveConfig({
    pluginRecovery: {
      skipUserPlugins: true,
      reason: 'x'.repeat(600),
      at: '',
      appVersion: '1.2.3',
    },
  });
  assert.equal(saved.pluginRecovery.reason.length, 500);
});
```

- [ ] **Step 2: Run** those tests — FAIL (install currently second-spawns; reason cap may already pass).

- [ ] **Step 3:**

```js
async restartAfterInstall({ before, after, addedSpec, uninstallPlugin }) {
  if (this.shouldSkipUserPlugins()) {
    return this.restart({ allowPluginRecovery: true });
  }
  try {
    return await this.restart({ allowPluginRecovery: false });
  } catch (error) {
    const name = addedPluginName(before, after, addedSpec);
    if (name && typeof uninstallPlugin === 'function' && this.looksLikePluginTree(error)) {
      await uninstallPlugin(name);
      return this.restart({ allowPluginRecovery: true });
    }
    throw error;
  }
}
```

Keep the existing one-error full-success and two-error skip-FSM tests (both are tree failures).

Runtime plugin-tree:

```js
void Promise.allSettled([
  this.remote?.sync?.(),
  this.ensureBootVisible(),
]).catch(() => {
  // allSettled does not reject; this catch is defense if sync is replaced with a throwing thenable.
});
```

Better: drop the useless `.catch` on `allSettled` (it never rejects) and name the inner failure:

```js
void Promise.allSettled([
  Promise.resolve(this.remote?.sync?.()).catch((error) => {
    this.dsh.log(`手机 Remote 同步失败：${errorMessage(error)}`, 'app');
  }),
  this.ensureBootVisible().catch(() => {
    // Window already gone after a plugin-tree runtime abort.
  }),
]);
```

`WEB_TEMPLATE_BUNDLES` comment: must stay equal to `PROFILE_TEMPLATES.web` in app-boot (`@deepseek-ai/dsh-base` then `@deepseek-ai/dsh-web-app`). Cannot import app-boot.

JSDoc on `LoadProfileOptions.userLayer`: `--dump-default-config` is manifest bundles / no user layer / no `--patch`; `--skip-user-plugins` is template bundles / no user layer / `--patch` allowed. Do not call them the same “bundles-only consumer.”

- [ ] **Step 4: Re-run** `node --test src/main/harness-controller.test.js src/main/config.test.js src/main/plugins.test.js` — PASS.

---

## Verification (after all tasks)

Desktop:

```
node --test src/main/plugins.test.js src/main/plugin-tree-failure.test.js src/main/plugin-recovery-actions.test.js src/main/dsh.test.js src/main/harness-controller.test.js src/main/config.test.js src/main/desktop-install-control.test.js src/main/marketplace-install.test.js src/main/ipc-authorization.test.js src/preload/shell-api.test.js src/renderer/boot-recovery.test.js
```

Vendor (from `vendor/deepseek-harness`):

```
pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts apps/cli/tests/args.spec.ts apps/cli/tests/profile-boot.spec.ts apps/cli/tests/dump-config.spec.ts packages/client/ui-settings-plugin-inventory/tests/marketplace.client.spec.tsx packages/client/ui-settings-plugin-inventory/tests/browser-plugin.client.spec.tsx
```

## Self-review

- Overlay omit, two-dir heal, first-new-name rollback, template write, Button 32px overrides: already restored; this plan does not reintroduce them.
- Boot Retry stays a skip-clear (spec). Do not split it into a non-clearing restart.
- Official template damage still takes the FSM’s one recovery spawn; the new test forbids a third spawn and forbids deleting template names.
- `allSettled` is not left as an unnamed empty catch.

# Marketplace 审查收口修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Stay in the `feat/marketplace-parity` worktree: `C:\Ai\Deepseek-Harness-Desktop\.worktrees\marketplace-parity`. Tasks are coupled — execute inline in this session (not a fresh worktree, not SDD-per-task). Do not commit unless Trent asks.

**Goal:** Close every remaining production-delivery review finding that is a real defect or a test that does not pin the rule it names.

**Architecture:** Catalog mapping and CLI add share `isAllowedMarketplaceSpec`. Settings applies a successful catalog payload even when `listInstalled` throws. Profile writes (marketplace install, Host install, uninstall) share one `startHarness` wrapper: one-statement `try`, `ok: true` / `harnessStarted: false` on throw. `#path:` posix tests use a GitHub URL that matches owner/repo so the `..` / `:` / `\` checks are the failing condition.

**Tech Stack:** Node `node:test` for desktop main; Vitest jsdom for `ui-settings-plugin-inventory`.

**Spec:** [docs/superpowers/specs/2026-08-18-marketplace-parity-design.md](../specs/2026-08-18-marketplace-parity-design.md)

## Global Constraints

- Worktree only. Do not edit the main checkout. Do not `pnpm install` in the worktree vendor tree.
- Do not preinstall `dshmarket`. Do not implement Phase 2–4. Do not split `marketplace-install.js`. Do not invent a Tab atom. Keep `screenshots` mapping.
- Do not widen Host `isValidGithubSpec` / `installPlugin` to `#path:` or tarballs.
- TDD: failing test first (except Task 4 test-pin: prove red by temporarily dropping the posix check, then restore).
- Do not commit unless Trent asks. Do not push.
- Frontend: `ui-primitives` + `--dsw-alias-*`. Product copy Chinese. Comments English contracts.
- Desktop tests from worktree root. Client tests: `node "C:\Ai\Deepseek-Harness-Desktop\vendor\deepseek-harness\node_modules\vitest\vitest.mjs" run packages/client/ui-settings-plugin-inventory` with cwd worktree `vendor/deepseek-harness`.

## Pushback (do not implement)

- Extra GitHub-parser extraction.
- Category chip redesign / screenshot gallery.
- Changing `refresh-marketplace` to re-default `locale` to `'zh'` in IPC (`resolveLocale` already defaults).

## File map

- Modify: `src/main/marketplace-spec.js` — npm last-token must equal `plugin.npm`.
- Modify: `src/main/marketplace-catalog.js` — JSDoc; name `resolveCommitSha` catch.
- Modify: `src/main/marketplace-catalog.test.js` — last-token npm with no registry npm.
- Modify: `src/main/marketplace-install.js` — `parsePatchInsertedIds` contract comment; `whichAll` catch name.
- Modify: `src/main/marketplace-install.test.js` — `#path:` fixtures use GitHub blob URLs.
- Modify: `src/main/ipc.js` — shared one-statement restart helper for marketplace install, Host install, uninstall.
- Modify: `src/main/ipc.test.js` — uninstall + Host install `startHarness` throw.
- Modify: `src/host/install-dsh-plugin-client.js` + `.test.js` — JSDoc / test name for git+https allowBuilds keys.
- Modify: Settings tab, locales, desktop-shell JSDoc, client tests.
- Modify: spec + Agent Note pair + i18n sidecars for facts this wave changes.

---

### Task 1: Last-token npm is only the registry `npm` field

**Files:**
- Modify: `src/main/marketplace-spec.js`
- Test: `src/main/marketplace-catalog.test.js`

**Interfaces:**
- Consumes: `isAllowedMarketplaceSpec(spec, { homepage, npm })`
- Produces: last-token package names with `npm: null` map to `installSpec === ''`

- [x] **Step 1: Write the failing catalog test** (append after the existing last-token github test)

```js
test('last-token npm fallback is empty when the row has no registry npm field', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse({
    name: 'awesome-dsh-plugin',
    url: 'https://awesome-dsh-plugin.com',
    categories: { ui: { en: 'UI', zh: 'UI' } },
    plugins: [{
      name: 'stray-npm',
      owner: 'evil',
      url: 'https://example.com/not-github',
      category: 'ui',
      description: { en: 'x', zh: 'x' },
      npm: null,
      stars: 0,
      install: 'dsh plugin --profile web add lodash',
      added: '2026-08-18',
    }],
  }));
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();
  assert.equal(byId(result.items, 'evil/stray-npm').installSpec, '');
});
```

- [x] **Step 2: Run — expect FAIL** (`installSpec === 'lodash'`)

Run: `node --test src/main/marketplace-catalog.test.js`

- [x] **Step 3: Minimal implementation**

In `isAllowedMarketplaceSpec`, replace `return plugin.npm ? spec === plugin.npm : true` with:

```js
  return Boolean(plugin.npm) && spec === plugin.npm;
```

- [x] **Step 4: Re-run catalog tests — expect PASS**

---

### Task 2: `#path:` posix tests pin owner-matched GitHub rows

**Files:**
- Modify: `src/main/marketplace-install.test.js` (the three `#path:` reject tests)
- Modify: `src/main/marketplace-install.js` only if a pin check fails (it should not)

**Interfaces:**
- Homepage must match owner/repo via `github.com/owner/repo` and must **not** be a bare repo URL (that would map to `github:owner/repo` and ignore last-token). Use `/blob/main/README.md`.

- [x] **Step 1: Change fixtures**

`dotdot` / `backslash` / `colon` / existing mismatch-github `#path:` rows that currently use `https://example.com/not-github` for **path-safety** tests become:

```js
`https://github.com/evil/${name}/blob/main/README.md`
```

Keep the owner/repo mismatch test (`evil/mismatch` + `https://example.com/not-github`) unchanged — that test pins URL mismatch, not posix.

- [x] **Step 2: Prove the `..` test pins posix**

Temporarily delete `posix.includes('..')` from `isValidMarketplacePathSpec`. Run the dotdot test — expect FAIL (`ok: true` or `calls.length > 0`). Restore the check. Re-run — expect PASS.

Run: `node --test src/main/marketplace-install.test.js`

---

### Task 3: Settings applies catalog independently of `listInstalled`

**Files:**
- Modify: `MarketplaceSettingsTab.tsx` `load`
- Test: `tests/marketplace.client.spec.tsx`

**Interfaces:**
- Success catalog (including `items: []`) always `setItems`.
- `listMarketplace` throw keeps cards.
- `listInstalled` throw does not block `setItems`; keeps last installed map; sets `marketError` if catalog did not already fail.

- [x] **Step 1: Write the failing test**

```ts
it('clears cards when a successful empty catalog arrives even if listInstalled throws', async () => {
  const listMarketplace = vi.fn()
    .mockResolvedValueOnce({ items: [ITEM], categories: [{ id: 'all', label: 'All', count: 1 }] })
    .mockResolvedValueOnce({ items: [], warning: '请求过于频繁', categories: [] })
  const listInstalled = vi.fn()
    .mockResolvedValueOnce({ plugins: [] })
    .mockRejectedValueOnce(new Error('profile unreadable'))
  renderTab({ listMarketplace, listInstalled })
  await waitFor(() => { expect(screen.getByText('dsh-loop')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.marketRefresh }))
  await waitFor(() => { expect(screen.queryByText('dsh-loop')).toBeNull() })
  expect(screen.getByText(en.marketError)).toBeTruthy()
})
```

- [x] **Step 2: Run vitest — expect FAIL** (card still present)

- [x] **Step 3: Implement `load`**

```ts
  const load = async (refresh = false): Promise<void> => {
    setBusy(true)
    let catalogOk = false
    try {
      const catalog = await listMarketplace({ refresh })
      const next = dedupeItems(catalog.items ?? [])
      setItems(next)
      setCategories(catalog.categories ?? [])
      setDetail(current => current ? next.find(item => item.id === current.id) ?? null : null)
      setWarning(catalog.warning ?? '')
      catalogOk = true
    } catch {
      // listMarketplace rejected; keep the last successful cards.
      setWarning(t('marketError'))
    }
    try {
      const profile = await listInstalled()
      setInstalled(new Map((profile.plugins ?? []).map(row => [row.name, row.spec])))
    } catch {
      // listInstalled rejected; keep the last installed map.
      if (catalogOk) setWarning(t('marketError'))
    } finally {
      setBusy(false)
    }
  }
```

Each `try` contains one `await`. State updates after a successful await stay outside that `try`.

Harness-down body uses locale copy, not the Chinese IPC string:

```ts
body: t('marketHarnessDownBody')
```

Uninstall success with `harnessStarted === false` uses the uninstall keys from Task 4.

- [x] **Step 4: vitest — expect PASS**

---

### Task 4: Shared `startHarness` wrapper for install and uninstall

**Files:**
- Modify: `src/main/ipc.js`
- Modify: `src/main/ipc.test.js` (`loadIpc` uninstall / Host install results)
- Modify: `locales.ts`, `MarketplaceSettingsTab.tsx` `runUninstall`
- Test: ipc tests + one client uninstall harness-down test

**Interfaces:**
- Produces: `{ ...result, ok: true, harnessStarted: true | false }`
- Install/Host down error (existing): `插件已写入 web profile，但 Harness 没有起来。请从现有入口重启，不要再安装一次。`
- Uninstall down error: `插件已从 web profile 移除，但 Harness 没有起来。请从现有入口重启，不要再卸载一次。`

- [x] **Step 1: IPC tests**

`loadIpc`: `uninstallResult` and `installPluginResult` options, default `{ ok: true }`.

```js
test('shell:uninstall-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    startHarness: async () => { throw new Error('spawn failed'); },
  });
  try {
    const result = await ipc.invoke('shell:uninstall-plugin', harnessEvent(), 'pkg');
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.match(String(result.error), /移除/);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});

test('shell:install-plugin keeps ok when startHarness throws', async () => {
  const ipc = loadIpc({
    startHarness: async () => { throw new Error('spawn failed'); },
  });
  try {
    const result = await ipc.invoke('shell:install-plugin', harnessEvent(), 'github:owner/repo');
    assert.equal(result.ok, true);
    assert.equal(result.harnessStarted, false);
    assert.equal(ipc.startHarness(), 1);
  } finally {
    ipc.restore();
  }
});
```

Client:

```ts
it('explains uninstall already happened when Harness did not start', async () => {
  renderTab({
    listInstalled: vi.fn(async () => ({ plugins: [{ name: '@dsh-external/dsh-loop', spec: 'github:owner/dsh-loop#abc' }] })),
    uninstallPlugin: vi.fn(async () => ({ ok: true, harnessStarted: false })),
  })
  await waitFor(() => { expect(screen.getByText('dsh-loop')).toBeTruthy() })
  pickMenu(en.marketStatus, en.marketInstalled)
  const detail = openCard('dsh-loop')
  fireEvent.click(within(detail).getByRole('button', { name: en.marketRemove }))
  fireEvent.click(within(screen.getByRole('dialog', { name: en.marketRemoveTitle })).getByRole('button', { name: en.marketRemoveOk }))
  await waitFor(() => { expect(screen.getByRole('dialog', { name: en.marketUninstallHarnessDownTitle })).toBeTruthy() })
  expect(screen.queryByRole('dialog', { name: en.marketFailTitle })).toBeNull()
})
```

Locales (zh + en):

```
marketUninstallHarnessDownTitle: '插件已卸载，Harness 未起来' / 'Plugin removed, Harness did not start'
marketUninstallHarnessDownBody: '插件已从 web profile 移除，但 Harness 没有起来。请从现有入口重启，不要再卸载一次。' / 'The plugin is already out of the web profile, but Harness did not start. Restart from the existing control. Do not uninstall it again.'
```

- [x] **Step 2: Run ipc + vitest — expect FAIL** (uninstall invoke rejects)

- [x] **Step 3: Helper in `ipc.js` (one-statement try)**

```js
const HARNESS_DOWN_AFTER_ADD = '插件已写入 web profile，但 Harness 没有起来。请从现有入口重启，不要再安装一次。';
const HARNESS_DOWN_AFTER_REMOVE = '插件已从 web profile 移除，但 Harness 没有起来。请从现有入口重启，不要再卸载一次。';

async function restartAfterProfileWrite(event, result, startHarness, downError) {
  if (result.ok !== true || typeof startHarness !== 'function') {
    return result;
  }
  sendPluginProgress(event, { phase: 'restart', line: '正在重启 Harness' });
  try {
    await startHarness();
  } catch {
    // startHarness threw after the profile write committed. Return ok so the UI does not retry the write.
    return { ...result, ok: true, harnessStarted: false, error: downError };
  }
  return { ...result, harnessStarted: true };
}
```

Wire marketplace install with `HARNESS_DOWN_AFTER_ADD`, Host `install-plugin` the same, uninstall with `HARNESS_DOWN_AFTER_REMOVE`.

`runUninstall`: same `harnessStarted === false` branch as install, using uninstall title/body keys.

Install harness-down dialog body: `t('marketHarnessDownBody')` (locale), not `result.error`.

- [x] **Step 4: Re-run ipc + vitest — expect PASS**

---

### Task 5: Contracts, JSDoc, pairing

**Files:** comments/JSDoc/docs only (no behavior)

- `marketplace-spec.js`: module JSDoc; `GITHUB_PATH_SPEC` JSDoc.
- `resolveInstallSpec` JSDoc: mention allow-listed last-token fallback.
- `resolveCommitSha` catch: `// GitHub SHA lookup failed (network, abort, or non-JSON); keep the floating ref.`
- `parsePatchInsertedIds`: `// Loader ids nested under an insert: key. Not a YAML parser; indented id: lines only.`
- `whichAll` catch: `// where/which exited non-zero; the command is absent from PATH.`
- `normalizeAllowBuilds` JSDoc: allow `name@git+https://github.com/owner/repo.git` keys; still reject bare `https://` URLs, YAML, paths.
- Test name: `allowBuilds accepts package, github.com/owner/repo, and name@git+https keys`
- `desktop-shell.ts`: field JSDoc `false when the profile write committed and Harness did not start; do not retry the write.`
- Spec: last-token npm must equal the row `npm` field; Settings applies catalog when `listInstalled` throws; uninstall `startHarness` throw is `harnessStarted: false`.
- Agent Note EN/ZH + testing bullets. Re-record both `.i18n.yaml` via `git hash-object -w` + `git update-ref refs/dsh/translation-pairing/snapshots/<hash> <hash>`.

- [x] **Step 1: Edit pairs in one pass**
- [x] **Step 2: Re-record sidecars**

---

### Task 6: Verification

- [x] **Step 1:** `node --test src/main/marketplace-catalog.test.js src/main/marketplace-install.test.js src/main/ipc.test.js src/main/window-marketplace.test.js src/host/install-dsh-plugin-client.test.js`
- [x] **Step 2:** vitest `packages/client/ui-settings-plugin-inventory`
- [x] **Step 3:** `npm test` from the worktree
- [x] **Step 4:** Do not claim done without this run's exit code 0

## Spec coverage

| Review / spec line | Task |
| --- | --- |
| last-token npm only if row `npm` | 1 |
| `#path:` `..` / `:` / `\` tests actually pin posix | 2 |
| empty catalog clears cards even if installed throws | 3 |
| `try` one statement; locale harness-down body | 3 + 4 |
| uninstall / Host install `startHarness` throw | 4 |
| JSDoc / named catch / pairing | 5 |

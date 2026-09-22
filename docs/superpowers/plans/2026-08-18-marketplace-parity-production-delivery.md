# Marketplace Phase-1 生产交付修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Stay in the `feat/marketplace-parity` worktree: `C:\Ai\Deepseek-Harness-Desktop\.worktrees\marketplace-parity`. Do not edit the main checkout. Tasks are coupled — execute inline in this session (not a fresh worktree, not SDD-per-task).

**Goal:** Close the production-delivery gaps the two-axis review proved, without shrinking Phase-1 or inflating Phase 2–4.

**Architecture:** Catalog mapping and CLI add share one allow-list (`isAllowedMarketplaceSpec`). Settings applies a successful empty catalog payload. GitHub SHA pin requires a stored token. `#path:` installed matching is exact. UI follows `ui-primitives` (including `FlipText` on changing Menu triggers). Comments name swallowed errors. README/JSDoc describe `harnessStarted`.

**Tech Stack:** Node `node:test` for desktop main; Vitest jsdom for `ui-settings-plugin-inventory`.

**Spec:** [docs/superpowers/specs/2026-08-18-marketplace-parity-design.md](../specs/2026-08-18-marketplace-parity-design.md)

## Global Constraints

- Worktree only: `C:\Ai\Deepseek-Harness-Desktop\.worktrees\marketplace-parity`, branch `feat/marketplace-parity`.
- Do not preinstall or vendor `dshmarket`. Do not port hoist / release-age / fetchTimeout / one-click pnpm.
- Do not widen Host `installPlugin` / `isValidGithubSpec` to `#path:` or tarballs.
- Do not implement Phase 2–4 (screenshot gallery UI, theme page, updates, hot disable, backup, diagnostics).
- Keep catalog field `screenshots` on `MarketplaceItem` (spec mapping table). Do not render a gallery.
- Keep category chips as `role="tab"` token-colored buttons with two-row clip + 展开. `ui-primitives` has no Tab atom; do not invent one.
- Frontend: `ui-primitives` + `--dsw-alias-*`. Product copy Chinese. Comments English contracts, not reasoning transcripts.
- TDD: failing test first, watch red, then minimal production code.
- Do not commit unless Trent asks. Do not push. Do not `pnpm install` in the worktree vendor tree.
- Do not mix unrelated `apiproxy` dirty files.
- Desktop tests: `node --test <files>` from the worktree root. Client tests: `node "C:\Ai\Deepseek-Harness-Desktop\vendor\deepseek-harness\node_modules\vitest\vitest.mjs" run packages/client/ui-settings-plugin-inventory` with cwd `...\marketplace-parity\vendor\deepseek-harness`.

## Pushback (do not implement)

- **Custom category chrome** — judgement smell; Phase-1 plan specified chips + 展开. Leave.
- **`mapPlugin` copies `screenshots`** — spec field table requires it. Leave.
- **Split `marketplace-install.js` into many files** — extract the shared allow-list only (`marketplace-spec.js`). Leave CLI/rollback in install.

## File map

- Create: `src/main/marketplace-spec.js` — `isAllowedMarketplaceSpec`, `isValidMarketplacePathSpec`, `parseGithubSpec`, `ownerRepoMatches`.
- Modify: `src/main/marketplace-catalog.js` — fallback uses allow-list; delete unused `WARNING_CACHE`.
- Modify: `src/main/marketplace-install.js` — require spec helper; `pinInstallSpec` only when token is non-empty.
- Modify: `src/main/ipc.js`, `src/main/window.js` — named catches / contract comments.
- Modify: vendor `MarketplaceSettingsTab.tsx`, `desktop-shell.ts`, `locales.ts` (if copy keys change), tests, README pair.
- Modify: spec / Agent Note only for facts this wave changes (empty catalog UI, pin-only-with-token, exact `#path:`, catalog allow-list at map time).

---

### Task 1: Shared allow-list + catalog fallback

**Files:**
- Create: `src/main/marketplace-spec.js`
- Modify: `src/main/marketplace-catalog.js` (`allowedFallbackSpec`, `resolveInstallSpec`)
- Modify: `src/main/marketplace-install.js` (delete duplicated helpers; require spec module)
- Test: `src/main/marketplace-catalog.test.js`, `src/main/marketplace-install.test.js`

**Interfaces:**
- Consumes: `isValidGithubSpec`, `isValidPackageName` from `src/host/install-dsh-plugin-client.js`
- Produces: `isAllowedMarketplaceSpec(spec, plugin)`, `isValidMarketplacePathSpec(spec, plugin)`, `parseGithubSpec(spec)`, `ownerRepoMatches(owner, repo, homepage)`
- `plugin` for allow-list: `{ homepage, npm }` where `homepage` is the registry `url`

- [x] **Step 1: Write the failing catalog tests**

Add to `marketplace-catalog.test.js` inside the live-mapping test file (new tests, not rewrite the tarball cases):

```js
test('last-token github: fallback is empty when the spec is not an allow-listed marketplace spec', async () => {
  process.env.DSHD_MARKETPLACE_REGISTRY_URL = FIXTURE_URL;
  mockFetch(async () => jsonResponse({
    ...LIVE_REGISTRY,
    plugins: [{
      name: 'bad-path',
      owner: 'evil',
      url: 'https://example.com/not-github',
      category: 'ui',
      description: { en: 'x', zh: 'x' },
      npm: null,
      stars: 0,
      install: 'dsh plugin --profile web add github:evil/bad-path#path:/../etc',
      added: '2026-08-18',
    }, {
      name: 'other-repo',
      owner: 'evil',
      url: 'https://example.com/not-github',
      category: 'ui',
      description: { en: 'x', zh: 'x' },
      npm: null,
      stars: 0,
      install: 'dsh plugin --profile web add github:evil/other-repo',
      added: '2026-08-18',
    }],
  }));
  const { listMarketplace } = loadCatalog();
  const result = await listMarketplace();
  assert.equal(byId(result.items, 'evil/bad-path').installSpec, '');
  assert.equal(byId(result.items, 'evil/other-repo').installSpec, '');
});
```

Keep existing tarball rows mapping to `github:` from the GitHub URL (those `url` fields are github.com).

- [x] **Step 2: Run the new test — expect FAIL**

Run: `node --test src/main/marketplace-catalog.test.js`
Expected: `other-repo` still has `installSpec === 'github:evil/other-repo'` because `allowedFallbackSpec` returns any `github:` prefix.

- [x] **Step 3: Extract `marketplace-spec.js` and use it from catalog fallback**

Move from install, keep behavior identical except fallback:

```js
'use strict';

const { isValidGithubSpec, isValidPackageName } = require('../host/install-dsh-plugin-client');

const GITHUB_PATH_SPEC = /^github:([^/#]+)\/([^/#]+)#path:\/(.+)$/;
const GITHUB_URL_OWNER_REPO = /github\.com\/([^/#]+)\/([^/#]+)/i;

function parseGithubSpec(spec) {
  const value = String(spec || '').trim();
  if (!isValidGithubSpec(value)) return null;
  const match = /^github:([^/#]+)\/([^/#]+)(?:#(.+))?$/.exec(value);
  if (!match) return null;
  return { owner: match[1], repo: match[2], ref: match[3] || '' };
}

function githubOwnerRepoFromHomepage(url) {
  const match = String(url || '').match(GITHUB_URL_OWNER_REPO);
  if (!match) return null;
  return { owner: match[1], repo: String(match[2]).replace(/\.git$/i, '') };
}

function ownerRepoMatches(owner, repo, homepage) {
  const fromUrl = githubOwnerRepoFromHomepage(homepage);
  return Boolean(fromUrl && fromUrl.owner === owner && fromUrl.repo === repo);
}

function isValidMarketplacePathSpec(spec, plugin) {
  const match = GITHUB_PATH_SPEC.exec(spec);
  if (!match) return false;
  const posix = match[3];
  if (!posix || posix.includes('..') || posix.includes(':') || posix.includes('\\')) return false;
  return ownerRepoMatches(match[1], match[2], plugin.homepage);
}

function isAllowedMarketplaceSpec(spec, plugin) {
  if (!spec || spec.startsWith('file:') || spec.startsWith('link:')) return false;
  if (/^(?:https?:|git\+|git:)/i.test(spec)) return false;
  if (spec.includes('#path:')) return isValidMarketplacePathSpec(spec, plugin);
  if (spec.startsWith('github:')) {
    const parsed = parseGithubSpec(spec);
    return Boolean(parsed && ownerRepoMatches(parsed.owner, parsed.repo, plugin.homepage));
  }
  if (!isValidPackageName(spec)) return false;
  return plugin.npm ? spec === plugin.npm : true;
}

module.exports = {
  parseGithubSpec,
  ownerRepoMatches,
  isValidMarketplacePathSpec,
  isAllowedMarketplaceSpec,
};
```

Catalog:

```js
function allowedFallbackSpec(spec, plugin) {
  const item = { homepage: plugin?.url || '', npm: plugin?.npm || null };
  return isAllowedMarketplaceSpec(spec, item) ? spec : '';
}

function resolveInstallSpec(plugin) {
  const npm = typeof plugin?.npm === 'string' ? plugin.npm.trim() : '';
  if (isValidPackageName(npm)) return npm;
  const source = parseSourceUrl(plugin?.url);
  if (source) {
    return source.subpath
      ? `github:${source.owner}/${source.repo}#path:/${source.subpath}`
      : `github:${source.owner}/${source.repo}`;
  }
  return allowedFallbackSpec(unquoteToken(lastInstallToken(plugin?.install)), plugin);
}
```

Install: `require('./marketplace-spec')` and delete the copied functions. Keep `githubIdentity` using `parseGithubSpec` + path regex from the spec module if needed (export `GITHUB_PATH_SPEC` or add `parsePathSpec`).

Delete unused `WARNING_CACHE` in catalog (only `WARNING_FRESH_CACHE` / per-failure suffix remain).

- [x] **Step 4: Re-run catalog + install tests**

Run: `node --test src/main/marketplace-catalog.test.js src/main/marketplace-install.test.js`
Expected: PASS. Install tests that used `https://example.com/not-github` + last-token `github:evil/...` still `ok: false`, `calls.length === 0` (now because `installSpec` is empty).

---

### Task 2: Pin SHA only when a GitHub token exists

**Files:**
- Modify: `src/main/marketplace-install.js` `pinInstallSpec`
- Test: `src/main/marketplace-install.test.js`

**Interfaces:**
- Consumes: `options.token` from IPC `config.githubToken`
- Produces: unchanged spec when token is missing/empty; `#<sha>` only when token is a non-empty string and GitHub returns a SHA

- [x] **Step 1: Write the failing test**

Install tests currently stub `fetch` to throw. Override fetch for one test:

```js
test('installMarketplacePlugin leaves a floating github ref when no token is stored', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return { ok: true, status: 200, text: async () => 'abc1234567890' };
    }
    throw new Error('unexpected fetch');
  };
  try {
    const { calls, runPlugin } = recordRunner(() => {
      writeProfileDep('@virex/dsh-status-rotator', GITHUB_SPEC);
      writeClientPlugin('@virex/dsh-status-rotator');
    });
    const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin, token: '' });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0], ['add', GITHUB_SPEC]);
    assert.equal(String(calls[0][1]).includes('abc1234567890'), false);
  } finally {
    globalThis.fetch = previous;
  }
});

test('installMarketplacePlugin pins a SHA when a GitHub token is stored', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return { ok: true, status: 200, text: async () => 'abc1234567890' };
    }
    throw new Error('unexpected fetch');
  };
  try {
    const { calls, runPlugin } = recordRunner(() => {
      writeProfileDep('@virex/dsh-status-rotator', 'github:01Virex/dsh-status-rotator#abc1234567890');
      writeClientPlugin('@virex/dsh-status-rotator');
    });
    const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin, token: 'ghp_test' });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0], ['add', 'github:01Virex/dsh-status-rotator#abc1234567890']);
  } finally {
    globalThis.fetch = previous;
  }
});
```

Adjust `writeClientPlugin` names to match existing helpers in this file.

- [x] **Step 2: Run — expect FAIL**

`pinInstallSpec` calls `resolveCommitSha` even with empty token, so the no-token test gets a pinned SHA.

- [x] **Step 3: Minimal implementation**

```js
async function pinInstallSpec(spec, token) {
  if (!token) return spec;
  const parsed = parseGithubSpec(spec);
  if (!parsed) return spec;
  if (parsed.ref && /^[0-9a-f]{7,40}$/i.test(parsed.ref)) return spec;
  const sha = await resolveCommitSha(parsed.owner, parsed.repo, parsed.ref || 'HEAD', token);
  return sha ? `github:${parsed.owner}/${parsed.repo}#${sha}` : spec;
}
```

- [x] **Step 4: Re-run install tests — expect PASS**

---

### Task 3: Settings empty catalog, exact `#path:`, harness-down kind, FlipText, named catch

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/MarketplaceSettingsTab.tsx`
- Modify: `src/client/desktop-shell.ts` JSDoc on `MarketplaceInstallResult`
- Test: `tests/marketplace.client.spec.tsx`

**Interfaces:**
- Consumes: `listMarketplace` resolving `{ items, warning }`; `installMarketplacePlugin` `{ ok, harnessStarted }`
- Produces: `setItems(next)` on every successful catalog read; `installedName` exact `#path:/` suffix; `ActionDialog` kind `'harness-down'`; Menu triggers wrap `FlipText`

- [x] **Step 1: Write failing tests**

Replace `keeps the current catalog when a refresh returns no items` with:

```ts
it('clears cards when a successful refresh returns no items', async () => {
  const listMarketplace = vi.fn()
    .mockResolvedValueOnce({ items: [ITEM], categories: [{ id: 'all', label: 'All', count: 1 }] })
    .mockResolvedValueOnce({ items: [], warning: '请求过于频繁', categories: [] })
  renderTab({ listMarketplace })
  await waitFor(() => { expect(screen.getByText('dsh-loop')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.marketRefresh }))
  await waitFor(() => { expect(screen.queryByText('dsh-loop')).toBeNull() })
  expect(screen.getByText('请求过于频繁')).toBeTruthy()
  expect(screen.queryByText(en.marketEmpty)).toBeNull()
})
```

Keep `reports a catalog failure` (throw keeps no cards on first load; add a follow-up if needed: first load success, then throw, cards remain):

```ts
it('keeps cards when a later catalog read throws', async () => {
  const listMarketplace = vi.fn()
    .mockResolvedValueOnce({ items: [ITEM], categories: [{ id: 'all', label: 'All', count: 1 }] })
    .mockRejectedValueOnce(new Error('offline'))
  renderTab({ listMarketplace })
  await waitFor(() => { expect(screen.getByText('dsh-loop')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.marketRefresh }))
  await waitFor(() => { expect(screen.getByText(en.marketError)).toBeTruthy() })
  expect(screen.getByText('dsh-loop')).toBeTruthy()
})
```

Exact `#path:` (sibling `foo` vs `foo-bar`):

```ts
it('does not mark a #path: prefix sibling as installed', async () => {
  const panel = {
    ...ITEM,
    id: 'DamonKoy/dsh-web-ui#panel',
    owner: 'DamonKoy',
    repo: 'panel',
    packageName: '',
    homepage: 'https://github.com/DamonKoy/dsh-web-ui',
    installSpec: 'github:DamonKoy/dsh-web-ui#path:/packages/foo',
  }
  const longer = {
    ...panel,
    id: 'DamonKoy/dsh-web-ui#panel-bar',
    repo: 'panel-bar',
    installSpec: 'github:DamonKoy/dsh-web-ui#path:/packages/foo-bar',
  }
  renderTab({
    listMarketplace: vi.fn(async () => ({
      items: [panel, longer],
      categories: [{ id: 'all', label: 'All', count: 2 }],
    })),
    listInstalled: vi.fn(async () => ({
      plugins: [{
        name: 'foo-bar',
        spec: 'git+https://github.com/DamonKoy/dsh-web-ui.git#path:/packages/foo-bar',
      }],
    })),
  })
  await waitFor(() => { expect(screen.getByRole('button', { name: 'panel-bar' })).toBeTruthy() })
  expect(within(screen.getByRole('button', { name: 'panel-bar' })).getByText(en.marketInstalled)).toBeTruthy()
  expect(within(screen.getByRole('button', { name: 'panel' })).queryByText(en.marketInstalled)).toBeNull()
})
```

Harness-down dialog is not `marketFailTitle`:

Existing test should already look for `marketHarnessDownTitle`. Change production `kind: 'failure'` to `'harness-down'` and assert `queryByRole('dialog', { name: en.marketFailTitle })` is null.

Sort order without `data-market-card`:

```ts
function cardRepos() {
  return screen.getAllByRole('listitem').map(row => within(row).getByRole('button').getAttribute('aria-label'))
}
```

Pagination: `expect(screen.getAllByRole('listitem')).toHaveLength(60)`.

- [x] **Step 2: Run vitest — expect FAIL on the new empty-refresh and prefix tests**

- [x] **Step 3: Implement**

`load`:

```ts
const next = dedupeItems(catalog.items ?? [])
setItems(next)
setCategories(catalog.categories ?? [])
setDetail(current => current ? next.find(item => item.id === current.id) ?? null : null)
setWarning(catalog.warning ?? '')
```

On throw: do not call `setItems`. Name the catch:

```ts
} catch {
  // listMarketplace / listInstalled rejected; keep the last successful cards.
  setWarning(t('marketError'))
}
```

`installedName` path match:

```ts
function specPathSuffix(spec: string): string {
  const marker = '#path:/'
  const index = spec.indexOf(marker)
  return index < 0 ? '' : spec.slice(index)
}

function specHasPath(spec: string, pathSuffix: string): boolean {
  if (!pathSuffix) return !spec.includes('#path:/')
  const got = specPathSuffix(spec)
  return got === pathSuffix
}
```

`ActionDialog` add `{ kind: 'harness-down'; title: string; body: string }`. `runInstall` uses that kind. `actionTitle` / `actionDescription` / `actionFooter` treat it like dismiss-only (same footer as failure). Log `pre` only for `installing` and `failure`, not harness-down.

Import `FlipText` from `@deepseek-ai/dsh-client-ui-primitives`. Wrap `{statusLabel}` and `{sortLabel}`:

```tsx
<FlipText text={statusLabel} />
```

Remove `data-market-card` and `data-market-col`.

- [x] **Step 4: Run vitest — expect PASS (35+ tests)**

---

### Task 4: Main-process catch contracts

**Files:**
- Modify: `src/main/ipc.js`
- Modify: `src/main/window.js`

- [x] **Step 1: No new behavior tests unless window catch is unnamed**

`openHarnessSettings` `.catch(() => false)` must name the swallow:

```js
.catch(() => {
  // executeJavaScript rejected (destroyed view or thrown page script).
  return false;
})
```

IPC:

```js
} catch {
  // startHarness threw after profile add committed. Return ok so the UI does not add again.
  return {
    ...result,
    ok: true,
    harnessStarted: false,
    error: '插件已写入 web profile，但 Harness 没有起来。请从现有入口重启，不要再安装一次。',
  };
}
```

Comment states the contract (return value + no re-add), not a design argument.

- [x] **Step 2: Run `node --test src/main/ipc.test.js src/main/window-marketplace.test.js` — expect PASS**

---

### Task 5: Docs and README pairing

**Files:**
- Modify: `desktop-shell.ts` JSDoc on `MarketplaceInstallResult.harnessStarted`
- Modify: `packages/client/ui-settings-plugin-inventory/README.md` + `README.zh.md`
- Re-record: `README.i18n.yaml` via `git hash-object -w` from the worktree (vendor `pnpm` / tsx may be missing)
- Modify: spec empty-list sentence if it still implies Settings keeps stale cards
- Modify: Agent Note present-tense: catalog allow-list at map time; pin only with token; exact `#path:`; successful empty payload clears cards
- Re-record Agent Note i18n yaml the same way

README bullet (EN):

> One-click install confirms the catalog spec in a Modal, then calls the desktop shell by catalog id. If add succeeds and Harness does not start, the tab shows that the plugin is already in the web profile and does not add it again.

ZH counterpart same fact. Then:

```
git hash-object -w vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/README.md
git hash-object -w vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/README.zh.md
git update-ref refs/dsh/translation-pairing/snapshots/<hash> <hash>
```

Write the two hashes into `README.i18n.yaml`. Repeat for the Agent Note triplet.

- [x] **Step 1: Edit the pair in one pass**
- [x] **Step 2: Re-record sidecars**

---

### Task 6: Full verification

- [x] **Step 1:** `node --test src/main/marketplace-catalog.test.js src/main/marketplace-install.test.js src/main/ipc.test.js src/main/window-marketplace.test.js src/host/install-dsh-plugin-client.test.js`
- [x] **Step 2:** vitest `packages/client/ui-settings-plugin-inventory`
- [x] **Step 3:** `npm test` (full desktop suite) from the worktree
- [x] **Step 4:** Do not claim done without this run's exit code 0

## Spec coverage

| Spec / review line | Task |
| --- | --- |
| installSpec = installTargetFor; last-token only if allow-listed | 1 |
| Empty installSpec is not an Install CTA | 1 + existing `canInstall` |
| 没有 Token 就装浮动 ref | 2 |
| 只有每一层都失败才空列表 | 3 |
| Settings list / install / uninstall | 3 |
| `#path:` installed match not prefix | 3 |
| FlipText on changing trigger | 3 |
| Named empty catch | 3 + 4 |
| README/JSDoc wire field `harnessStarted` | 5 |
| Host github-only | unchanged |
| Phase 2–4 / hoist | out of scope |

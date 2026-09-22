# T3 Git Tool Verbatim Leftovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD. Do **not** commit unless the user asks.

**Goal:** Replace the remaining unjustified self-writes in the titlebar Git tool with T3 behavior, keeping Harness skin, Electron IPC, and Windows overlays.

**Architecture:** Copy T3 control flow and types. Bind the commit dialog to live `status.workingTree.files`. Drop the snapshot state, the extra `aheadOfDefaultCount` disabled-reason branch, the GitHub-only CTA gate, the dead `-sb` helpers, and the `gitChangedFiles` IPC. Do not add `glab`, a Publish wizard, or the branch tool.

**Tech Stack:** Electron main `node:test`; vendored `ui-git` vitest/jsdom; desktop `src/main/git.js` + `git-pullrequest.js`.

**Spec:** [docs/superpowers/specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md](../specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md)

## Global Constraints

- Official `dsh web` tokens / `ui-primitives` only. Do not paste T3 JSX, lucide, shadcn, Tailwind, or `@pierre`.
- Copy T3 git argv, parsers, and Git-action state machine. Swap only the Electron/`runGit` shell.
- Keep NTFS reserved-name filtering, gone-upstream (`# branch.ab` missing), and `aheadUnreliable`.
- Product copy Chinese except titlebar action labels and `resolveDefaultBranchActionDialogCopy`, which stay T3 English.
- User-visible strings say `branch`, not T3's leaked `refName` type name.
- `gitCreateChangeRequest` stays GitHub/`gh` fail-closed. The menu and toast CTA still *offer* Create PR/MR for every provider.
- Do not commit unless asked.
- Tests first; watch them fail; then minimal production code.
- Out of scope: `glab` / other CR CLIs, T3 Publish wizard, branch switch/create port, thread↔branch, right sidebar.

## File map

- `vendor/deepseek-harness/packages/client/ui-git/src/client/git-logic.ts` — required `workingTree`; T3 disabled-reason; T3 CTA (no GitHub gate).
- `vendor/deepseek-harness/packages/client/ui-git/src/client/GitActionsControl.tsx` — live `workingTree.files`; drop `commitFiles` state and `gitChangedFiles` inject.
- `vendor/deepseek-harness/packages/client/ui-git/src/client/apply.ts` — drop `gitChangedFiles` from `GitShell`.
- Tests: `git-logic.client.spec.ts`, `git-actions.client.spec.tsx`, `apply.client.spec.ts`.
- `src/main/git.js` — delete `shortStatusPath`, `gitChangedFiles`, `parseNumstat`, `countUntrackedInsertions`; `gitReadPullRequest` uses `gitStatus().refName`.
- `src/main/git-pullrequest.js` — `lookupOpenPullRequest(cwd, refName)` / `readPullRequest(cwd, refName)`; no `status -sb`.
- `src/main/ipc.js`, `src/preload/index.js` — drop `shell:git-changed-files`.
- `src/main/git.test.js` — leftover files via `gitStatus().workingTree`; no `-sb` in PR lookup sources.
- Docs: ui-git README pair; Agent Note `2026-08-16-git-action-progress-toast` triplet + `pnpm run verify-translation-pairing --write`.

---

### Task 1: Live `workingTree` + required field

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-git/src/client/git-logic.ts`
- Modify: `vendor/deepseek-harness/packages/client/ui-git/src/client/GitActionsControl.tsx`
- Test: `vendor/deepseek-harness/packages/client/ui-git/tests/git-logic.client.spec.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-git/tests/git-actions.client.spec.tsx`

**Interfaces:**
- Consumes: desktop `gitStatus` already returns `workingTree: { files, insertions, deletions }` on every payload, including `notARepoStatus`.
- Produces: `VcsStatus.workingTree` is required. `GitActionsControl` reads `status?.workingTree.files ?? []` (T3: `gitStatusForActions?.workingTree.files ?? []`). No `commitFiles` snapshot state.

- [ ] **Step 1: Write the failing tests**

In `git-logic.client.spec.ts`, change the `status()` helper base object so a missing `workingTree` is a type error, and add an assertion that the helper always supplies the empty tree:

```ts
function status(overrides: Omit<Partial<VcsStatus>, 'sourceControlProvider'> & { sourceControlProvider?: VcsStatus['sourceControlProvider'] | undefined } = {}): VcsStatus {
  const base: VcsStatus = {
    refName: 'feature/test',
    hasWorkingTreeChanges: false,
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    sourceControlProvider: GITHUB,
    workingTree: { files: [], insertions: 0, deletions: 0 },
  }
  Object.assign(base, overrides)
  return base
}
```

If `workingTree` is still optional, TypeScript will not force this. After making it required, a helper that omits it must fail `pnpm --filter @deepseek-ai/dsh-client-ui-git exec vitest run tests/git-logic.client.spec.ts`.

In `git-actions.client.spec.tsx`, add this case next to `opens the commit review dialog from status.workingTree files like T3`:

```tsx
it('commit dialog file list follows live status.workingTree while open', async () => {
  let files = [{ path: 'a.ts', insertions: 1, deletions: 0 }]
  const gitStatus = vi.fn(async () => status({
    hasWorkingTreeChanges: true,
    workingTree: filesTree(files),
  }))
  mount({ cwd: '/work', gitStatus })
  fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
  expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
  expect(screen.getByText('a.ts')).toBeTruthy()
  files = [{ path: 'b.ts', insertions: 2, deletions: 0 }]
  fireEvent.focus(window)
  await waitFor(() => {
    expect(screen.getByText('b.ts')).toBeTruthy()
  })
  expect(screen.queryByText('a.ts')).toBeNull()
})
```

`mount` already defaults `gitFetchForStatus` to `opts.git ?? null`. Passing only `gitStatus` keeps fetch from overwriting the live tree (`if (!fresh) return`).

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --filter @deepseek-ai/dsh-client-ui-git exec vitest run tests/git-actions.client.spec.tsx tests/git-logic.client.spec.ts
```

Expected: the new live-list test still shows `a.ts` after focus (snapshot state), or times out waiting for `b.ts`.

- [ ] **Step 3: Write minimal implementation**

In `git-logic.ts`, make `workingTree` required on `VcsStatus`:

```ts
workingTree: {
  files: Array<{ path: string; insertions: number; deletions: number }>
  insertions: number
  deletions: number
}
```

In `GitActionsControl.tsx`:

1. Delete `const [commitFiles, setCommitFiles] = useState<CommitFileRow[]>([])`.
2. After `status` is in scope, derive T3's `allFiles`:

```ts
const commitFiles = status?.workingTree.files ?? []
```

3. `openCommit` only resets exclusion/editing and opens. Do not copy files into state.
4. `closeCommit` does not call `setCommitFiles`.
5. `selectedCommitPaths` and `CommitDialog` `files={commitFiles}` keep using the derived array.

- [ ] **Step 4: Run tests to verify they pass**

Run the same vitest command as Step 2.

Expected: PASS, including the new live-list test (debounce is 250ms; `waitFor` default is enough).

If TypeScript reports missing `workingTree` in other test helpers (`git-actions.client.spec.tsx` `status()` already has one), add the empty tree there too.

- [ ] **Step 5: Commit only if the user asked**

```bash
git add vendor/deepseek-harness/packages/client/ui-git/src/client/git-logic.ts vendor/deepseek-harness/packages/client/ui-git/src/client/GitActionsControl.tsx vendor/deepseek-harness/packages/client/ui-git/tests/git-logic.client.spec.ts vendor/deepseek-harness/packages/client/ui-git/tests/git-actions.client.spec.tsx
```

---

### Task 2: T3 disabled-reason and toast CTA

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-git/src/client/git-logic.ts`
- Modify: `vendor/deepseek-harness/packages/client/ui-git/src/client/GitActionsControl.tsx`
- Test: `vendor/deepseek-harness/packages/client/ui-git/tests/git-logic.client.spec.ts`

**Interfaces:**
- Consumes: Task 1 required `workingTree` (helpers already pass it).
- Produces: `getMenuActionDisabledReason` Create-PR arm uses `if (!isAhead)` only. `resolveCompletionCta(result, terms, isDefaultRef)` has no fourth argument. Production code does not call `supportsGitHubChangeRequests`.

T3 sources to copy (control flow, not JSX):

- `C:\Ai\t3code\apps\web\src\components\GitActionsControl.tsx` `getMenuActionDisabledReason` (the Create-PR arm is `if (!isAhead)`).
- `C:\Ai\t3code\apps\server\src\git\GitManager.ts` toast `cta` block (~1297–1327): after push/`commit_push` on a non-default ref, `Create ${terms.shortLabel}` with no provider check.

- [ ] **Step 1: Write the failing tests**

Add to `git-logic.client.spec.ts` inside `describe('getMenuActionDisabledReason'`:

```ts
it('Create PR disabled reason uses aheadCount only, like T3', () => {
  const noUpstreamAheadVsDefault = status({
    hasUpstream: false,
    aheadCount: 2,
    aheadOfDefaultCount: 2,
    hasWorkingTreeChanges: false,
  })
  expect(getMenuActionDisabledReason({
    item: buildMenuItems(noUpstreamAheadVsDefault, false)[2]!,
    gitStatus: noUpstreamAheadVsDefault,
    isBusy: false,
    hasPrimaryRemote: true,
  })).toBeNull()

  const countedOnDefaultFieldOnly = status({
    hasUpstream: false,
    aheadCount: 0,
    aheadOfDefaultCount: 2,
    hasWorkingTreeChanges: false,
  })
  const createPr = buildMenuItems(countedOnDefaultFieldOnly, false)[2]!
  expect(createPr.disabled).toBe(true)
  expect(getMenuActionDisabledReason({
    item: createPr,
    gitStatus: countedOnDefaultFieldOnly,
    isBusy: false,
    hasPrimaryRemote: true,
  })).toBe('No local commits to include in a pull request.')
})
```

Add inside the existing `resolveCompletionCta` example:

```ts
it('resolveCompletionCta offers Create MR after push without a GitHub gate', () => {
  expect(resolveCompletionCta({
    action: 'push',
    push: { status: 'pushed' },
  }, { shortLabel: 'MR', singular: 'merge request' }, false)).toEqual({
    kind: 'run_action',
    label: 'Create MR',
    action: 'create_pr',
  })
})
```

If `resolveCompletionCta` still takes `canCreateChangeRequest` as the fourth argument, call sites that pass `false` for GitLab must be deleted so this test describes the T3 three-argument function. Current production:

```ts
resolveCompletionCta(
  attachOpenPrForCta(folded, nextStatus),
  terms,
  nextStatus?.isDefaultRef ?? false,
  supportsGitHubChangeRequests(...),
)
```

Change the GitLab-false case into the test above (fourth arg gone). Replace `describe('supportsGitHubChangeRequests'` with a menu-only check that does not import a deleted helper:

```ts
describe('Create PR in the menu', () => {
  it('stays in the menu when the provider is absent or not GitHub', () => {
    expect(buildMenuItems(status({
      aheadCount: 2,
      sourceControlProvider: undefined,
    }), false).map(item => item.id)).toEqual(['commit', 'push', 'pr'])
    expect(buildMenuItems(status({
      aheadCount: 2,
      sourceControlProvider: {
        kind: 'gitlab',
        name: 'GitLab',
        baseUrl: 'https://gitlab.com',
      },
    }), false).find(item => item.id === 'pr')).toMatchObject({
      label: 'Create MR',
      disabled: false,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --filter @deepseek-ai/dsh-client-ui-git exec vitest run tests/git-logic.client.spec.ts
```

Expected: FAIL on `aheadOfDefaultCount: 2` / `aheadCount: 0` if the extra `&& (gitStatus.aheadOfDefaultCount ?? 0) === 0` still skips the T3 sentence, or FAIL compiling after `supportsGitHubChangeRequests` is removed from the import list.

- [ ] **Step 3: Write minimal implementation**

In `getMenuActionDisabledReason`, replace the Create-PR ahead check with T3:

```ts
if (!isAhead) {
  return `No local commits to include in a ${terminology.singular}.`
}
```

Keep the detached-HEAD string as `checkout a branch`, not `checkout a refName`.

In `resolveCompletionCta`, drop `canCreateChangeRequest` and the `&& canCreateChangeRequest` clause so the push arm matches T3:

```ts
export function resolveCompletionCta(
  result: StackedActionResult,
  terms: ChangeRequestTerminology,
  isDefaultRef: boolean,
): GitCompletionCta {
  if (result.action === 'commit' && result.commit?.status === 'created') {
    return { kind: 'run_action', label: 'Push', action: 'push' }
  }
  const openPr = (result.pr?.status === 'created' || result.pr?.status === 'opened_existing')
    ? result.pr
    : null
  if (
    (result.action === 'push' || result.action === 'create_pr' || result.action === 'commit_push' || result.action === 'commit_push_pr')
    && openPr?.url
    && (!isDefaultRef || result.pr?.status === 'created' || result.pr?.status === 'opened_existing')
  ) {
    return { kind: 'open_pr', label: `View ${terms.shortLabel}`, url: openPr.url }
  }
  if (
    (result.action === 'push' || result.action === 'commit_push')
    && result.push?.status === 'pushed'
    && !isDefaultRef
  ) {
    return { kind: 'run_action', label: `Create ${terms.shortLabel}`, action: 'create_pr' }
  }
  return { kind: 'none' }
}
```

Delete `supportsGitHubChangeRequests` from `git-logic.ts` if nothing else calls it.

In `GitActionsControl.tsx`, call:

```ts
const cta = resolveCompletionCta(
  attachOpenPrForCta(folded, nextStatus),
  terms,
  nextStatus?.isDefaultRef ?? false,
)
```

Remove the `supportsGitHubChangeRequests` import.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
pnpm --filter @deepseek-ai/dsh-client-ui-git exec vitest run tests/git-logic.client.spec.ts tests/git-actions.client.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit only if the user asked**

---

### Task 3: Drop `-sb` from PR lookup

**Files:**
- Modify: `src/main/git-pullrequest.js`
- Modify: `src/main/git.js`
- Test: `src/main/git.test.js`

**Interfaces:**
- Consumes: `gitStatus(cwd)` already returns `refName` from `# branch.head`.
- Produces:
  - `lookupOpenPullRequest(cwd, refName)` — uses `refName`; does not spawn `git status -sb`.
  - `readPullRequest(cwd, refName)` — same.
  - `gitReadPullRequest` loads `const status = await gitStatus(cwd)` then `lookupOpenPullRequest(root, status.refName)`.
  - Override seam stays `setLookupOpenPullRequest(async (cwd) => ({ pr, failed, headContext? }))`.

- [ ] **Step 1: Write the failing tests**

Add to `src/main/git.test.js`:

```js
test('git.js and git-pullrequest.js do not spawn git status -sb', () => {
  const gitJs = fs.readFileSync(require.resolve('./git.js'), 'utf8');
  const prJs = fs.readFileSync(require.resolve('./git-pullrequest'), 'utf8');
  assert.doesNotMatch(gitJs, /status',\s*'-sb'/);
  assert.doesNotMatch(prJs, /status',\s*'-sb'/);
});

test('gitReadPullRequest returns null pr on detached HEAD without short-status', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '--detach', 'HEAD']);
    const pr = await gitReadPullRequest(cwd);
    assert.equal(pr.ok, true, pr.message);
    assert.equal(pr.pr, null);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
```

Keep the existing gone-upstream `gitStatus` integration test. Delete `parseStatusHeader treats a gone upstream as no usable tracking ref` only after production no longer exports `parseStatusHeader` (Step 3). Until then, leaving that unit test is fine.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node --test src/main/git.test.js
```

Expected: FAIL `do not spawn git status -sb` while `gitReadPullRequest` / `lookupOpenPullRequest` still contain `status', '-sb'`.

- [ ] **Step 3: Write minimal implementation**

In `git-pullrequest.js`:

1. Stop importing `parseStatusHeader` if unused.
2. Change lookup to take the ref from the caller:

```js
async function lookupOpenPullRequest(cwd, refName) {
  if (lookupOpenPullRequestOverride) return lookupOpenPullRequestOverride(cwd);
  const root = asCwd(cwd);
  if (!root) return { pr: null, failed: true };
  const selected = await selectProviderContext(root);
  if (selected?.provider?.kind !== 'github') {
    return { pr: null, failed: false };
  }
  const headRef = typeof refName === 'string' && refName.trim() ? refName.trim() : '';
  if (!headRef) return { pr: null, failed: false };
  const headContext = await resolveBranchHeadContext(root, headRef);
  // ... existing gh pr list loop unchanged ...
}

async function readPullRequest(cwd, refName) {
  const looked = await lookupOpenPullRequest(cwd, refName);
  if (looked.failed) return null;
  return looked.pr;
}
```

In `git.js` `gitReadPullRequest`:

```js
async function gitReadPullRequest(cwd) {
  const root = asCwd(cwd);
  if (!root) return fail('Git status is unavailable.');
  const status = await gitStatus(cwd);
  if (!status?.refName) return ok({ pr: null });
  const branchKey = `${root}\u0000${status.refName}`;
  const looked = await lookupOpenPullRequest(root, status.refName);
  const headContext = looked.headContext || await resolveBranchHeadContext(root, status.refName);
  // ... rememberLastKnownPr / resolveLastKnownPr unchanged, using status.refName ...
}
```

At `gitCreateChangeRequest`, pass `status.refName` into `lookupOpenPullRequest(root, status.refName)`.

At the post-create `readPullRequest(root)` call, pass `status.refName`.

Delete `shortStatusPath` from `git.js` (no callers).

If `parseStatusHeader` has no remaining production callers, remove it from `git-exec.js` exports, `git.js` re-exports, and the unit test that only parses `## ... [gone]` strings. The porcelain v2 gone integration test stays.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
node --test src/main/git.test.js
```

Expected: PASS, including the new source-grep and detached-HEAD cases. Existing `gitReadPullRequest` tests still pass because the override seam ignores `refName`.

- [ ] **Step 5: Commit only if the user asked**

---

### Task 4: Delete `gitChangedFiles`

**Files:**
- Modify: `src/main/git.js`
- Modify: `src/main/git.test.js`
- Modify: `src/main/ipc.js`
- Modify: `src/preload/index.js`
- Modify: `vendor/deepseek-harness/packages/client/ui-git/src/client/GitActionsControl.tsx`
- Modify: `vendor/deepseek-harness/packages/client/ui-git/src/client/apply.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-git/tests/apply.client.spec.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-git/tests/git-actions.client.spec.tsx`

**Interfaces:**
- Consumes: Task 1 live `workingTree`. Diff panel keeps `gitStatusEntries` / `gitDiff` (unchanged).
- Produces: no `gitChangedFiles` on inject, preload, IPC, or `git.js`. Leftover-file assertions use `gitStatus(cwd).workingTree.files`.

- [ ] **Step 1: Write the failing tests**

Replace `gitChangedFiles reports numstat...` in `src/main/git.test.js` with a `gitStatus` workingTree assertion (T3 lists untracked porcelain paths as `0/0` when numstat has no row — do **not** recreate `countUntrackedInsertions`):

```js
test('gitStatus workingTree lists a modified file and an untracked path', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    fs.writeFileSync(path.join(cwd, 'extra.txt'), 'a\nb\n');
    const listed = await gitStatus(cwd);
    const byPath = Object.fromEntries(listed.workingTree.files.map(file => [file.path, file]));
    assert.equal(byPath['README.md'].insertions, 1);
    assert.ok(byPath['extra.txt']);
    assert.equal(byPath['extra.txt'].deletions, 0);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
```

In `gitCommit with filePaths stages only those paths`, replace leftover lookup:

```js
const leftover = await gitStatus(cwd);
assert.deepEqual(leftover.workingTree.files.map(file => file.path), ['skip.md']);
```

In the NTFS reserved-name commit test, drop the `gitChangedFiles` leftover; keep `status.hasWorkingTreeChanges === false`.

Remove `gitChangedFiles` from the `require('./git.js')` destructure.

In `git-actions.client.spec.tsx`, delete the `gitChangedFiles` mount prop, helper default, and the two `expect(gitChangedFiles).not.toHaveBeenCalled()` spies. The dialog tests already assert paths from `workingTree`.

In `apply.client.spec.ts`, delete the `injected.gitChangedFiles` expectation. Add:

```ts
expect('gitChangedFiles' in injected).toBe(false)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node --test src/main/git.test.js
pnpm --filter @deepseek-ai/dsh-client-ui-git exec vitest run tests/apply.client.spec.ts tests/git-actions.client.spec.tsx
```

Expected: FAIL compile or runtime until `gitChangedFiles` is removed from inject (`'gitChangedFiles' in injected` is `true`), and/or `gitChangedFiles is not a function` after the destructure drop.

- [ ] **Step 3: Write minimal implementation**

Delete from `git.js`: `gitChangedFiles`, `parseNumstat`, `countUntrackedInsertions`, and the `gitChangedFiles` export.

Delete from `ipc.js`: the `gitChangedFiles` import and `handle('shell:git-changed-files', ...)`.

Delete from `preload/index.js`: `gitChangedFiles: invoke(renderer, 'shell:git-changed-files')`.

Delete from `GitActionsInjected`, `GitActionsControl` props destructure (already unused in the component body after Task 1), `GitShell`, and `readGitShell`.

Repo grep after the edit must return no `gitChangedFiles` / `shell:git-changed-files` hits.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
node --test src/main/git.test.js
pnpm --filter @deepseek-ai/dsh-client-ui-git exec vitest run tests/apply.client.spec.ts tests/git-actions.client.spec.tsx tests/git-logic.client.spec.ts
```

Expected: PASS.

Grep:

```powershell
rg "gitChangedFiles|shell:git-changed-files" src vendor/deepseek-harness/packages/client/ui-git
```

Expected: no matches.

- [ ] **Step 5: Commit only if the user asked**

---

### Task 5: Docs match shipped behavior

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-git/README.md`
- Modify: `vendor/deepseek-harness/packages/client/ui-git/README.zh.md`
- Modify: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-git-action-progress-toast.md`
- Modify: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-git-action-progress-toast.zh.md`
- Modify: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-git-action-progress-toast.i18n.yaml` (via `--write`)

**Interfaces:**
- Consumes: Tasks 1–4 shipped facts.
- Produces: current-state prose only. No “previously / no longer”.

- [ ] **Step 1: Update README pair**

English: the commit dialog lists live `status.workingTree.files` (not a snapshot, not `gitChangedFiles`). Create PR/MR stays in the menu **and** on the push-success toast for every provider; desktop create still fails closed off GitHub.

Chinese: same facts. Do not narrate the migration.

- [ ] **Step 2: Update the Agent Note pair in place**

Rewrite stale sentences in `2026-08-16-git-action-progress-toast.md` / `.zh.md`:

- Commit dialog binds live `workingTree.files`.
- `VcsStatus.workingTree` is required.
- Toast CTA after push on a non-default ref is `Create ${shortLabel}` with no GitHub gate.
- PR lookup uses `gitStatus.refName` / porcelain v2; it does not spawn `git status -sb`.
- There is no `gitChangedFiles` IPC.

Keep Windows overlays, `aheadUnreliable`, gone upstream, and `gh` fail-closed as they are.

- [ ] **Step 3: Re-record translation pairing**

From `vendor/deepseek-harness`:

```powershell
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-08-16-git-action-progress-toast.md
```

Then:

```powershell
pnpm run verify-translation-pairing .agents/notes/implemented/feature/2026-08-16-git-action-progress-toast.md
```

Expected: PASS.

- [ ] **Step 4: Commit only if the user asked**

---

## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| Live `workingTree` in commit dialog | 1 |
| Required `workingTree` | 1 |
| Create PR disabled reason = `aheadCount` only | 2 |
| Toast CTA not GitHub-gated | 2 |
| Delete `shortStatusPath` | 3 |
| No `status -sb` in PR lookup | 3 |
| Delete `gitChangedFiles` | 4 |
| README + Agent Note | 5 |
| Skin / IPC / Windows overlays / `gh` fail-closed | Global constraints (no task changes them) |
| `glab`, Publish wizard, branch tool, sidebar | Explicitly out of scope |

**Placeholder scan:** none. Each step has the test or production snippet to type.

**Type consistency:** `VcsStatus.workingTree` required after Task 1. `resolveCompletionCta(result, terms, isDefaultRef)` three arguments after Task 2. `lookupOpenPullRequest(cwd, refName)` / `readPullRequest(cwd, refName)` after Task 3. No `gitChangedFiles` after Task 4.

# Ship-code bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **2026-08-31 Trent:** Task 1 (dshbot `#path:` catalog) **cancelled / reverted**. Keep first-party row at `github:ChisaAlter/dshbot`. Remote is parked (`REMOTE_FEATURE_ENABLED=false`) instead of shipping pairing.

**Goal:** Close remaining **code** defects on current HEAD. Version bump, git push, and CI installers are out of scope. dshbot marketplace install is out of scope.

**Architecture:** Phone SPA title and archive rows follow desktop: a titled session is not 「新会话」; archived ids without a list summary stay reachable. Approval `respond` treats E2EE 30s timeout as success when host history shows the approval already decided. Remote UI is parked via `REMOTE_FEATURE_ENABLED=false`.

**Tech Stack:** Desktop Node tests (`node:test`), mobile `node:test` ESM, existing Host remotes. No new windows, no marketplace.css hex, no `dshmarket` restore.

**Spec:** This plan. Cards: `marketplace-settings`, `mobile-remote`, `remote-settings`, `session-archive` (mobile parity only).

## Verdict (current code, not process)

Desktop chat / launcher / Git / surfaces / wallpaper / usage-stats **have no open code bugs** in `src/` or the named leftovers (archive remotes and message-edit are already wired on this pin).

Not bugs (do not implement): Android T3 Deferred; mobile Files/Diff/MCP freeze bars (signed DEFER); skipped system-camera QA; Git Create PR using `aheadOfDefaultCount` (correct: nothing to push, PR vs default still valid); directory-picker `\` heuristic (documented TODO, rare).

## Global Constraints

- Touching: `marketplace-settings`, `mobile-remote`, `remote-settings`. **Not** `dshbot`.
- `#path:` stays curated-catalog-only (`installMarketplacePlugin`). Host `installPlugin` stays github-only.
- First-party catalog `id` stays `ChisaAlter/dshbot`.
- Official `dsh web` language. Tokens / ui-primitives only.
- Do not push `ChisaAlter/dshbot` from this plan (403 is a repo-permission issue, not a desktop code path).

---

### Task 1: Marketplace one-click dshbot installs the in-tree plugin — **CANCELLED**

Do not re-point the first-party catalog at `#path:/vendor/dshbot`. Row stays `github:ChisaAlter/dshbot`.

**Files:**
- Modify: `src/main/marketplace-catalog.js` (`FIRST_PARTY_PLUGINS` url + install)
- Modify: `src/main/dshbot-market-row.test.js`
- Modify: `docs/features/dshbot.md` (User path 2, invariant, last verified, open follow-up P1)

**Root cause:** `resolveInstallSpec` prefers `plugin.url`. Current url is `https://github.com/ChisaAlter/dshbot` (README-only). One-click therefore clones an empty repo. The override test already says “registry npm wins over the first-party **#path:** spec”.

**Target spec:** `github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot`  
**Target url:** `https://github.com/ChisaAlter/Deepseek-Harness-Desktop/tree/main/vendor/dshbot`

- [x] **Step 1: Lock the row in the existing market-row tests**

Change constants and assertions:

```js
const DSHBOT_PATH_SPEC = 'github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot';
const DSHBOT_HOMEPAGE = 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop/tree/main/vendor/dshbot';
const STANDALONE_SPEC = 'github:ChisaAlter/dshbot'; // Host-only, still valid
```

`listMarketplace` / `getMarketplacePlugin` must assert `installSpec === DSHBOT_PATH_SPEC` and homepage is the tree URL. `installMarketplacePlugin(ChisaAlter/dshbot)` must hand `DSHBOT_PATH_SPEC` to `dsh plugin add`. Keep a Host `installPlugin(STANDALONE_SPEC)` test (github-only channel still accepts the standalone spec).

- [x] **Step 2: Run tests (expect fail)**

Run: `node --test src/main/dshbot-market-row.test.js`  
Expected: FAIL — `installSpec` still `github:ChisaAlter/dshbot`

- [x] **Step 3: Point FIRST_PARTY at the tree URL**

```js
url: 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop/tree/main/vendor/dshbot',
install: 'dsh plugin --profile web add github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot',
```

Do not change `owner`/`name` (`ChisaAlter` / `dshbot`). `parseSourceUrl` already maps `/tree/<ref>/<subpath>` to `#path:`.

- [x] **Step 4: Re-run tests (expect pass)**

Run: `node --test src/main/dshbot-market-row.test.js src/main/marketplace-catalog.test.js src/main/marketplace-install.test.js`  
Expected: PASS

- [x] **Step 5: Card**

User path 2: 一键安装规格为本仓 `#path:/vendor/dshbot`。独立仓 `github:ChisaAlter/dshbot` 仍可走 Host，但在独立仓含 `dsh.bundle` 之前第一方行不得指向它。P1 follow-up: 仓主推独立仓后再切回纯 github 规格。

---

### Task 2: Phone chrome title follows host title

**Files:**
- Modify: `mobile/web/conversation/title.js`, `title.test.js`
- Modify: `mobile/web/host/catalog.js`, `catalog.test.js`

**Root cause:** T1: host `session.list` already has e.g. 「验证连接并生成验证码」; phone header stays 「新会话」. `sessionTitle` returns 「新会话」 whenever `blank === true`, even if `projections.values.title` is set. `liveSessionRows` also drops raw `blank` sessions, so the titled row never enters the live list.

- [x] **Step 1: Failing tests**

`title.test.js`: `blank: true` + `projections.values.title: '验证连接并生成验证码'` → that title, not 「新会话」.

`catalog.test.js`: a `blank: true` list item with a projection title appears in `liveSessionRows` and `toRow.blank === false`. Untitled `blank: true` still hidden.

- [x] **Step 2: Run (expect fail)**

Run: `node --test mobile/web/conversation/title.test.js mobile/web/host/catalog.test.js`

- [x] **Step 3: Implement**

Export `projectionTitle` / `isUntitledBlank` from `title.js` (or keep helpers next to `sessionTitle` and import into `catalog.js`).

```js
function projectionTitle(row) {
  const title = row?.projections?.values?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : '';
}

function sessionTitle(row) {
  const titled = projectionTitle(row);
  if (titled) return titled;
  if (row?.blank) return '新会话';
  const id = String(row?.sessionId || '');
  return id.slice(0, 7) || '会话';
}

function isUntitledBlank(session) {
  return session?.blank === true && !projectionTitle(session);
}
```

`toRow`: `blank: isUntitledBlank(session)`.  
`liveSessionRows`: skip `isUntitledBlank(session)` instead of `session.blank === true`.

- [x] **Step 4: Re-run (expect pass)**

---

### Task 3: Archived ids without a list summary stay on the phone sheet

**Files:**
- Modify: `mobile/web/host/catalog.js`, `catalog.test.js`

Desktop `deriveArchived` synthesizes 「缺失会话」 so Unarchive/Delete stay reachable. Mobile `archivedSessionRows` only emits ids present in `session.list`.

- [x] **Step 1: Failing test**

`archivedSessionIds: ['arch-1', 'ghost-1']` with only `arch-1` in `session.list` → two rows; `ghost-1` has `projections.values.title === '缺失会话'`, `archived: true`, `blank: false`. Still skip `origin === 'dshbot'`.

- [x] **Step 2: Implement**

Walk `archivedSessionIds` order. Missing summary → placeholder row (same shape as `toRow`). Existing summaries → `toRow(..., true)`.

- [x] **Step 3: Re-run catalog tests (expect pass)**

---

### Task 4: Approval respond timeout is not a false “未能送达”

**Files:**
- Create: `mobile/web/host/approval-respond.js`, `approval-respond.test.js`
- Modify: `mobile/web/app.js` `respondToPendingApproval`
- Modify: `mobile/web/index.html` cache query (`app.js?v=20260831-shipbugs`)

**Root cause:** `hostRpc` times out at 30s (`Timeout waiting for message (30000ms)`). SPA already dismisses the bar first. Host often already applied Allow/Reject; the phone still banners 「审批未能送达电脑」.

- [x] **Step 1: Failing tests on the helper**

1. `hostCall` resolves → `{ ok: true }`, no history probe.
2. `hostCall` throws `Timeout waiting for message (30000ms)` and history has `approval/decided` for that id → `{ ok: true, ackMissing: true }`.
3. Same timeout but history still has unanswered `approval/asked` → `{ ok: false, error }`.
4. Non-timeout error → `{ ok: false }` without treating it as success.

- [x] **Step 2: Implement helper**

On timeout, `session.history` → `pendingFromHistoryEvents`. If the approval id / rpcId is gone, success. If still pending, failure (caller restores the bar).

- [x] **Step 3: Wire `app.js`**

Keep dismiss-first. On `{ ok: false }`, push `pending` back into `state.pendingApprovals` if missing, `renderApproval()`, banner. On success, no banner.

- [x] **Step 4: Run**

Run: `node --test mobile/web/host/approval-respond.test.js mobile/web/host/backend.test.js mobile/web/host/history.test.js mobile/web/app-cutover.test.js`

---

### Task 5: Focused verification

- [x] Run: `node --test src/main/dshbot-market-row.test.js src/main/marketplace-catalog.test.js src/main/marketplace-install.test.js mobile/web/conversation/title.test.js mobile/web/host/catalog.test.js mobile/web/host/approval-respond.test.js mobile/web/app-cutover.test.js`
- Expected: PASS
- Update `docs/features/dshbot.md` and `docs/features/mobile-remote.md` `last verified` with the commands above (code gates only; do not claim 实机全量 or installer Pass).

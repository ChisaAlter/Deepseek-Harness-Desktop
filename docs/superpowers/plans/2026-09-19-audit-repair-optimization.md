# Audit repair and optimization plan (2026-09-19)

Source: read-only audit `c2c_a731` (HEAD `dc05e7ae1dd67f456092c0f688f7efc22587a27f`).
Evidence: `iteration3-findings.md`, `iteration3-coverage.md`, `iteration3-provenance.md`,
`iteration4-errata-closure.md`.

Scope note: this plan repairs defects found in the **working tree**, not HEAD alone.
AUD-01 is a working-tree-only manifest loss; AUD-04 lives in an untracked script.
Every phase below preserves unrelated dirty changes and creates no branch, worktree,
commit, or deployment.

Reading note: Phase 1–4 problems below are the **historical findings** that motivated this
plan. Each phase now states its accepted current implementation and the scope actually
verified. "Source/unit verified" never implies runtime, packaged, or release acceptance.

## Phase 0 - Execution ledger and ownership

Freeze the inputs (HEAD, `git status` count, Node version), name one owner per shared
file, and keep concurrent agents on disjoint write sets. Checkpoint the C2C session.

Gate: no shared file is handed to two writers; the plan and its decision records exist
before product edits start.

## Phase 1 - Desktop manifest and packaged runtime contract

Historical finding (no longer current): `package.json` had been reduced to
name/version/engines/optionalDependencies/overrides.
`scripts`, `devDependencies`, `build`, and `dependencies` are gone, so the documented
`npm start` / `npm test` / `npm run dist` entry points do not exist and
`installer-branding.test.js` dies at module load.

Restore the HEAD manifest, add the missing `dsh-remote/**` filter that
`scripts/after-pack.js` already requires, and add a contract test that fails loudly when
scripts, runtime dependencies, or the critical `build` fields disappear again.

Current implementation: the manifest is restored; its only remaining HEAD diff is the
added `dsh-remote/**` resource filter, and `package-lock.json` has no HEAD diff. Verified
scope: source/unit contract tests. Package acceptance is still pending.

Gate: `package-contract.test.js` green, and `node --test src/main/package-contract.test.js src/main/installer-branding.test.js` reports 15/15 combined (5 contract + 10 branding); `installer-branding.test.js`'s individual cases execute,
full `npm test` no longer shows the 9 manifest-linked failures.

## Phase 2A - Harness readiness cancellation

Historical finding (no longer current): `probeHarnessReady` gave its `AbortSignal` to the
first fetch and the origin retry but
not to the nested `redeemBrowserSession` call, so a stalled redemption can outlive the
readiness budget. `DshManager.waitUntilReady` also checks generation and child identity
before the `await` only, so a probe that resolves after `stop()` can still publish a stale
`sessionCookie`.

Gate: a fetch stub that never settles proves the readiness watchdog still fires; a stalled
redemption receives the same signal; the production cookie-publication path rejects an old
generation and still publishes a current generation's cookie.

Current implementation: the caller signal is combined with the internal timeout and
covers the initial probe, the nested redemption, and the authenticated retry; cancelled
callers are rechecked after the await. Generation and child identity are rechecked before
any cookie is published. Verified scope: source/unit. Real startup-cancellation behaviour
in a packaged app remains pending.

## Phase 2B - Preview permission policy

Historical finding (no longer current): `configurePreviewSession` decided permission
requests by name only, ignoring origin,
frame, and `webContents`, so any http(s) preview page can obtain clipboard-read,
notifications, or geolocation grants.

Gate: deny-by-default is the shipped policy (empty allow-list; no consent UI in this
hotfix); evil-origin, cross-origin-frame, ownerless/foreign-session, destroyed, and
opaque-origin probes are denied; with an explicitly non-empty test allow-list, only
bound loopback main frames and same-origin loopback frames pass.

Current implementation: default denial is shipped with an empty allow-list and no consent
UI. Verified scope: source/unit policy tests. Real Electron permission enforcement is
still pending.

## Phase 3 - Remote-workspace live acceptance contract

Historical finding (no longer current): the opt-in live verifier ignored `result.ok`,
redeemed the one-shot token twice, and
exits 0 after SKIP.

Gate: `--require-live` turns an unrun check into a non-zero exit; the one-shot token is
redeemed exactly once.

Current implementation: readiness requires `ok === true` plus a non-empty cookie, the
launch token is redeemed exactly once, `--require-live` exits non-zero when config is
missing, cleanup success requires a validated response body, and the fixture keeps its own
route-method table. The run-level deadline now keeps its timer referenced so a stalled
operation cannot outlive the event loop. Verified scope: guard/runner fixtures on Node
22.22.2 and 26.7.0 (29/29). Live SSH remains NOT RUN.

## Phase 4 - Remote identity isolation

Historical finding (no longer current): `CHISACODE_HOME=''` resolved `cli-client-id` to
the repository root because the CLI used
`??` instead of an empty-checking fallback, producing untracked identity state inside
the worktree.

Gate: empty/relative `CHISACODE_HOME` never writes identity state into the checkout.
`vendor/chisacode-remote/packages/cli` is outside the root `npm test` glob, so run
the package-local runner against `src/utils/client-id.test.ts` explicitly. The accepted
result is 9 cases: pure path cases plus a temp-HOME persistence case (identity file
created under the resolved home and reused across a fresh module instance).

Current implementation: empty/relative `CHISACODE_HOME` no longer writes identity state
into the checkout, and three identity-related environment variables are restored after
each test. Verified scope: source/persistence tests. Whether a built consumer ships this
module is checked in Phase 7.

## Phase 5 - Negative-path coverage

Add negative and real-window coverage for IPC authorization, workspace, Git, PTY,
persistence, remote, and renderer paths that only have happy-path tests.

### Checkpoint B1 - workspace containment, Git, and `dsh-home`

Two real defects were found by writing the discriminating test first:

1. **`.git` reachable through an innocuously named internal link (privilege escalation).**
   `notes` → `.git` (junction) passed `resolveInside` because the link resolves *inside*
   the root; `writeFile(cwd, 'notes/hooks/pre-commit', …)` returned `{ ok: true }` and
   overwrote `.git/hooks/pre-commit`, which runs on the next git invocation. Not a
   hypothetical: reproduced before the fix, sentinel bytes changed.
2. **Check-then-use window in `writeFile` (TOCTOU).** Swapping the target directory for a
   link to `.git` at the point of the privileged call still wrote into `.git` before the
   fix. The test interleaves deterministically by patching `fs.promises.mkdir` for its
   first call, so it does not depend on timing luck.

A separate **availability** defect was fixed in the same pass: `startsWith('..')`
containment checks rejected real names (`..notes`, `sub/..cache`, `..dir/inner.txt`) in
`resolveInside`, `containedIn`, and `resolveGitPath`.

Fixes: `escapesBase` (segment-aware escape test), `hasGitDirSegment` (shared `.git`
segment rule), a canonical-path `.git` re-check inside `resolveInside`, `isPathInside` for
already-resolved paths, and `canonicalInside` re-validation before every Files
read/write/list. See
[the decision record](../../decisions/proposed/bug-fix/2026-09-20-workspace-path-containment.md).

Evidence: `workspace-authority.test.js` + `workspace-fs.test.js` 32/32 (was 28);
`git*.test.js` + workspace suites 183/183; root `npm test` 1849 tests, 1847 pass, 0 fail,
2 skipped, 0 cancelled. Mutation checks: removing the canonical `.git` re-check fails
3 tests; reverting `canonicalInside` to the lexical parent fails `L-4c`.

Not claimed: realpath re-checking narrows the TOCTOU window but does not make it atomic,
and no real Electron window was driven for these paths.

#### Checkpoint B1 closure (iteration 7)

The reviewer found two reverse bypasses in the iteration-6 code. Both were reproduced with a
counterexample script before any fix (`.tmp/audit-iteration7-b1-repro.cjs`: 1/5 safe, 4 bypasses):

1. **Caller-selected cwd launders `.git`.** `resolveAuthorizedCwd` accepted any real
   subdirectory of an authorized root, and the `.git` rule was evaluated relative to that cwd.
   `writeFile(<root>/.git, 'hooks/pre-commit')`, `<root>/.git/hooks`, and an innocuously named
   cwd link all returned `{ ok: true }` and rewrote `.git/hooks/pre-commit`.
2. **A dangling link was mistaken for a not-yet-created path.** realpath fails both for a
   missing node and for an existing link whose destination is missing; `resolveInside` walked
   upward in both cases, and `writeFile` validated only the parent. A link pointing at a
   missing file outside the root created that out-of-root file.

Fixes: `resolveAuthorizedCwd` re-checks the `.git` segment against the **trusted root**;
`isAbsentNode` (`lstat`) separates “genuinely absent” from “present but unresolvable” in both
`resolveInside` and `canonicalInside`; `writeFile` validates the **complete target** and writes
the canonical path instead of re-appending the requested basename to a canonical parent.

Evidence: after the fix the counterexample script is 5/5 safe. `workspace-authority` +
`workspace-fs` 35/35 (was 32, +2 cases and one extended); `git*.test.js` + workspace 103/103;
candidate-A full run on Node 22.22.2: **1852 tests / 1850 pass / 0 fail / 0 cancelled /
2 skipped, exit 0** (`.tmp/audit-iteration7-candidate-full-node22.log`). Mutation evidence
(`.tmp/audit-iteration7-b1-mutation.txt`): removing the trusted-root anchor fails the cwd case;
removing `isAbsentNode` fails 1 of 35. `L-4b`/`L-4c` fixtures now create their links
independently and self-verify the resolved target, so a failed fixture cannot be counted as a
successful denial.

Candidate source identity (`.tmp/audit-iteration7-candidate-source-identity.txt`): the four
task-owned files were incrementally synced into candidate-A and their live/candidate SHA256
values are identical; no wholesale recopy or recount.

Still not claimed: the realpath re-check narrows but does not make the check-use window atomic,
and no real Electron window was driven for these paths.

### Checkpoint B3 - persistence and the two remote systems

**Real defect fixed (failing reproduction first).** `importSessions()` wrote
`phase: 'done'` into the import journal before the later stages of `runImport()` (skills,
plugins, settings, presets) had finished. A cancel after the last session copy but before the
attachment copy therefore left the journal claiming completion, so cold-start recovery no
longer cleaned up `.import-tmp`. Fix: `data-import.js:1368` writes `done` only when
`deferJournalDone` is unset, and `runImport` passes `deferJournalDone: true`
(`data-import.js:1689`) until every stage has landed. Two discriminating tests:
`data-import.test.js:848` and `:877`.

**Vendor negative-path suites added.** `vendor/dsh-remote/lib/` had no test directory for
these paths, so four suites were added: `hostkey.test.js` (fingerprint change),
`binding.test.js` (revocation, malformed binding), `sync.test.js` (three-way conflict),
`forwards.test.js` (forwarding scope and persistence). They use synthetic homes, fake SFTP
and fake SSH clients only; no real host, relay, session, or `~/.dsh` is touched.

Already-covered areas were re-run rather than duplicated: plugin-forensics / launcher-recovery
(built-in damage vs skippable user-plugin failure), `dshd-remote` / `dshd-host-tunnel`
allowlist and revocation, and route-method negatives.

**Boundary decision, not a defect.** A candidate fix was proposed for
`disablePlugins()` committing `disabledPlugins` even when `applyDisabledBundles()` fails on a
malformed profile, and was rolled back for being outside its card's allowed touch. The main
agent's determination is that this is the existing **intent-then-reconcile** model, not a
bug: the desktop config records user intent, and `harness-controller.js:687` replays
`applyDisabledBundles(loadConfig().disabledPlugins)` on every Harness start, logging
`应用插件禁用名单跳过：<reason>` when the profile is still unusable. `enablePlugin()` has the
same deliberate shape (its doc comment states the disabled-list write commits even when the
bundle re-add reports a failure). Recording intent while a profile is unreadable is strictly
better than dropping the user's request; the bundle is removed on the next start that can read
the profile. No code change; this boundary is recorded rather than silently reclassified.

Live SSH remains **NOT RUN**: no disposable localhost/VM server is available here, and the
verifier was not run with `--require-live`. Real installer upgrade/recovery and non-Windows
platform cases are likewise not executed by this checkpoint.

### Checkpoint B2 - IPC, preview, and PTY lifecycle

Central authorization now rejects a destroyed sender (`ipc-authorization.js:33-38`), so wrong
roles, subframes, replaced senders, destroyed senders, and changed origins all fail with
`ERR_DSH_IPC_SENDER`. Preview host binding tracks a generation and converges on
`did-navigate` / `render-process-gone` / `destroyed` / sender replacement; a late
`shell:preview-open` closes the preview it just created and fails. PTY gained a sender
generation table, an ownership check on write/resize/kill, terminal-dimension normalization
(`1..1000`, non-finite falls back to 120x30), and bounded repeated teardown.

**Real defect fixed.** `did-navigate` bumped the sender generation but `isCurrent` did not
compare it, so a PTY created while the renderer was *navigating* (not destroyed) escaped as an
orphan. Failing reproduction first, then the generation comparison, then green.

Evidence: the six B2 suites pass 160/160; adjacent preview/window suites add 69. Full live-tree
run on Node 22.22.2 after integration: **1872 tests / 1870 pass / 0 fail / 0 cancelled /
2 skipped, exit 0**.

**Runner defects found and fixed while integrating.** The real-Electron permission runner
could not produce a report at all, and three separate causes were found and fixed:

1. Electron started on an `.mjs` entry never settles `app.whenReady()` (the process exits
   silently with 0). Added `scripts/verify-preview-permissions.cjs`, a CommonJS launcher that
   boots Electron and then dynamically imports the ESM runner.
2. The runner destroys its last `BrowserWindow` before the report is written, and Electron's
   default `window-all-closed` behaviour quits the app at that moment. The runner now keeps the
   app alive and quits explicitly after writing.
3. The destroyed-`webContents` assertion read `isDestroyed()` synchronously after `destroy()`;
   Electron flips that flag one tick later, so the case failed against correct production code.
   The assertion now waits a tick.

With those fixed the real-Electron run is **11/11 checks, exit 0** and the test file is **6/6
with zero skips** — handler-level denial and browser/OS-level enforcement are observed
separately, exactly as the checkpoint required.

**Environment defect repaired (outside the repository).** The live tree's Electron install had
six corrupted `locales/*.pak` files (`uk`, `sr`, `hu`, `zh-CN`, `lt`, `de`): same Electron
43.4.0 and a byte-identical `electron.exe`, but the packs differed from a clean install and made
every GUI launch die with Chromium CHECK `0x80000003` before app code. Swapping in the clean
files restored GUI startup. The damaged originals are preserved at
`.tmp/electron-locales-backup-20260920-122741/`. This is why earlier attempts attributed the
failure to third-party IME injection: the crash was real, the attribution was wrong.

### Checkpoint B2 corrections (iteration 8, 2026-09-20)

Review found that the host-generation cleanup introduced above was itself a defect, plus two
runner defects. All three are now fixed; B2's earlier "160/160" is superseded, not withdrawn.

1. **Old-host cleanup destroyed the new host's preview.** `reapHost()` queued
   `teardownHostResources()` in a microtask while the same `shell:preview-open` handler created
   the successor's preview; the deferred *global* `live.closeAll()` swept the new preview while
   still returning `{ ok: true }`. Reproduced first
   (`.tmp/audit-iteration8-preview-race-repro.cjs`: `RACE_REPRODUCED`), then fixed by scoping
   teardown to the reaped generation: only the ids and shared singletons that generation
   registered are closed, and ownership of a shared singleton is claimed **synchronously** at
   request time so the successor takes over before any `await`. Mutations: restoring the global
   sweep fails 3 regressions; deferring the singleton claim fails 1. Evidence:
   `.tmp/audit-iteration8-preview-lifecycle-mutation.txt`; `preview.test.js` 61/61.
2. **Electron runner isolation was established too late.** The CommonJS launcher waited for
   `app.whenReady()` before importing the runner, and the runner only redirected `userData`,
   never `sessionData`. The launcher now creates the run-owned root synchronously, redirects both
   paths before readiness, and the parent removes it only after the child exits. Reports echo the
   effective paths.
3. **Runner report and exit status disagreed.** `--positive-control` added a permission and then
   evaluated the default-deny-only "allow-list is empty" assertion, so it could never report
   success, while its test demanded exit 0. Mode-specific expectations now agree, exit goes
   through `app.exit(exitCode)` after flush and cleanup, and a launched process that crashes fails
   the gate instead of being converted into a skip.
4. **The import-journal deferral had no discriminating regression.** The existing cases could
   not tell a deferred journal write from an eager one. `src/main/data-import.test.js` now
   cancels *after* the session phase completes (during a later plugin stage) and asserts the
   journal stays `copying`, that completed sessions and attachments survive, and that cold-start
   recovery still clears `.import-tmp`; a positive all-phases case asserts the final `done`.
   Setting `deferJournalDone: false` in an isolated copy fails the new case.

**Superseded totals.** Iteration 8's integrated runs: live `npm test` on Node 22.22.2
**1880 / 1878 pass / 0 fail / 0 cancelled / 2 skipped, exit 0** (+8 over iteration 7's 1872);
`preview.test.js` 61/61; focused preview + IPC + PTY + workspace set 117/117;
`data-import.test.js` 27/27; `verify-preview-permissions.test.mjs` 9/9 with zero skips.

**Intermittent acceptance failure (cause unconfirmed).** A candidate-wide run
(`.tmp/audit-iteration8-candidate-full-node22.log`) failed one case,
`positive control succeeds under its declared semantics and exits 0`, which asserts the real
Electron process exits 0. The identical command re-run passed
(`.tmp/audit-iteration8-candidate-full-node22-rerun.log`, 1614 tests / 1612 pass / 0 fail), and
the same test file passed 9/9 both in isolation and in the live tree.

This is recorded as an **intermittent acceptance failure whose cause is not confirmed** — earlier
notes called it a load-sensitive harness flake; that was an inference, not a measurement.
Iteration 9 replaced the guesswork with diagnosability instead of a retry:

- the positive-control predicate no longer accepts "not denied". It previously used
  `queryStates.some(state !== 'denied')`, which treats `timeout` — a probe that never resolved — as
  an observed grant. A controlled comparison forced every probe to time out
  (`.tmp/audit-iteration9-runner-predicate.txt`): the old predicate reported
  `positiveControlObserved=true` on pure timeouts, the new predicate reports `false`.
- `report.ok` now requires exactly `main.query_geolocation=granted`,
  `same.query_geolocation=granted`, and `cross.query_geolocation=denied`, plus every other required
  probe in every frame at exactly `denied`. Missing, `unsupported`, `timeout`, and `threw:` outcomes
  fail in **both** modes, so default-deny is no longer vacuously satisfiable.
- a failing run now emits the whole report (`checks`, `handlerDecisions`, `permissionChecks`,
  `browserOutcomes`, `positiveControlObserved`), the failed check names and details, per-stage
  timings, and runtime identity, so the next occurrence is diagnosable from the artifact alone.

No automatic retry and no loosened assertion was added. The probe budgets are unchanged
(`PROBE_TIMEOUT_MS = 2_000`, `RESULT_TIMEOUT_MS = 20_000`).

The bootstrap comment and this plan no longer claim Electron cannot use an `.mjs` main entry;
that is recorded as an observed launch problem and the selected workaround.

Not executed: `desktop-pet.js` / `desktop-live2d.js` self-registered channels are unchanged and
untested by this checkpoint. PTY event routing is covered against a fake backend, not a real
node-pty session end-to-end. Caption hit-testing and real window-drag geometry remain
Electron-interactive items for Checkpoint E.

### Checkpoint B2 corrections (iteration 11, 2026-09-20)

The iteration-9 cleanup supervisor moved deletion out of Electron but kept its failures
unobservable, and three safety judgements did not hold. Fixed in the same checkpoint:

1. **Failure output was discarded.** `startProfileCleanupSupervisor()` used `stdio: 'ignore'` and
   `unref()`, so timeout and removal-failure stderr had no receiver. The helper now writes a
   **durable JSON receipt outside the profile root**, the launcher pipes stderr into its `detail`,
   and it records `supervisor-start-failed` synchronously on an `'error'` event or a missing pid.
2. **An unexpected probe error authorized deletion.** `isAlive()` returned `false` for every
   exception except `EPERM` (so "probe failed" read as "process gone"). It is now a tri-state probe
   (`alive` / `dead` / `unknown`) where **only a confirmed `ESRCH` advances to removal**; `unknown`
   and a deadline overrun retain.
3. **Inputs were unvalidated.** Non-absolute roots, roots equal to a filesystem root or the OS temp
   dir, non-positive pids, non-finite deadlines, receipt paths missing/non-absolute/inside the root,
   and missing ownership tokens now all retain and exit non-zero. Ownership is a
   `<root>/.dshd-cleanup-owner.json` marker plus a matching `argv[7]` token.

The runner's success and failure reports both carry
`profileCleanup: {state: pending|not-owned|retained, receiptPath, profileRoot, ownerPid}`; a
standalone run is `pending` because cleanup can only finish after the Electron owner exits, so
**permission-test success does not imply completed cleanup**, and a caller-owned root stays
`not-owned`.

The last silent stale-preview close path was also closed: the stale `shell:preview-open` result
branch used `void Promise.resolve(live.close(id)).catch(() => {})`, which swallowed a rejection and
let a synchronous throw escape. It now awaits
`Promise.resolve().then(() => live.close(id)).catch(reportTeardownFailure)`; the stale caller still
rejects with `ERR_DSH_IPC_SENDER` and the accepted generation/singleton logic is unchanged.

Checks on the synchronized candidate under Node 22.22.2: `verify-preview-permissions.test.mjs`
**17/17 (0 skip)**; focused preview **82/82**; the exact desktop selection
(`src/**/*.test.js` + `mobile/web/**/*.test.js` + `scripts/**/*.test.mjs`) **1894 reported /
1892 pass / 0 fail / 2 skipped, exit 0** in both the candidate and the live tree; vendor remote
**26/26** as a separate selection; governance **6/6**; doc-sync **8/8**. Captured receipts show the
intended three states: `removed` (root deleted), `pending` (owner force-killed, root retained), and
`retained`/`supervisor-start-failed` (root retained).

Not executed here: the iteration-8 intermittent real-Electron acceptance failure remains **cause
unconfirmed**; no retry was added and no stability guarantee is claimed.

### Checkpoint B2 corrections (iteration 12, 2026-09-20)

The iteration-11 receipt left two holes: a failed replacement could destroy the only readable
receipt, and the observer tests treated mere file existence as publication.

1. **Replacement failure destroyed evidence.** Both writers did
   `rename(temp) fails → unlink(destination) → rename(temp) retry`; if the retry also failed the
   previous readable receipt was already gone. Publication is now a single shared writer,
   `scripts/lib/receipt-file.cjs`, which **never unlinks the destination**: it writes a complete
   temp file in the same directory and retries an in-place rename a bounded number of times
   (5 attempts, 25 ms apart), then **throws** with `failure.cause` set so the caller reports a
   failed publication instead of claiming success. The destination stays byte-for-byte unchanged.
   The deterministic test hook `DSHD_RECEIPT_FORCE_REPLACE_FAILURE=1` forces replacement failure
   only when the destination already exists. `preview-profile-cleanup.cjs` now routes its
   `publishReceipt()` through the shared writer behind the guard that still refuses a receipt path
   inside the profile root; `verify-preview-permissions.cjs` dropped its duplicate implementation.
2. **Existence was not publication.** `verify-preview-permissions.test.mjs` waited only for the
   receipt file to exist, but the launcher writes `pending` before starting the supervisor and the
   helper removes the root *before* the terminal write. The test now polls the parsed receipt
   (`waitForTerminalReceipt`) until it is terminal and matches the expected `profileRoot` +
   `ownerPid`, distinguishing missing / unparseable / `pending` observations and failing with the
   last observations after a bounded deadline. The standalone test and the removal-failure fixture
   were also corrected (`createOwnedFixture` no longer assumes a dead pid; it derives one from an
   observed exited child).
3. **Receipt wording.** The evidence note no longer generalizes that a force-kill "by design"
   leaves `pending`/retained. `pending` means only that **cleanup completion is unconfirmed**; the
   helper cannot distinguish a graceful exit from a forced one, and `pending` neither proves the
   profile survives nor explains a missing terminal receipt by itself.

Checks in iteration 12: live tree `node --test scripts/verify-preview-permissions.test.mjs`
**19/19 pass, 0 skip, exit 0**; an isolated mutation that restored delete-before-replace drove the
same suite to **18 pass / 1 fail, exit 1** with the single failure being the receipt-preservation
test (log `.tmp/audit-iteration12-mutation-rerun.log`), confirming the new test discriminates. An
earlier mutation attempt reported 10 pass / 9 fail, but eight of those were environment failures
caused by an incomplete `src/` tree in the isolated copy; that number is superseded and must not be
quoted as mutation strength. The rerun used the explicit Node 22.22.2 binary; the discarded first
attempt ran under the workspace default Node 26.7.0. The surviving evidence establishes only that
the single targeted preservation test fails under the mutation. After
re-syncing the seven task-owned files to candidate-A, the candidate runner suite is **19/19**; the
exact desktop selection is **1896 reported / 1894 pass / 0 fail / 2 skipped, exit 0** in both the
candidate and the live tree under Node 22.22.2; governance **6/6**; doc-sync **8/8** in the live
tree (the candidate copy lags `docs/qa`, so its `verify-md-links` reports pre-existing dead links
that the live tree does not; this is a copy-completeness artifact, not a regression).

Not executed here: the iteration-8 intermittent real-Electron acceptance failure remains **cause
unconfirmed**; no retry was added and no stability guarantee is claimed.

## Phase 6 - Measured performance work

Measure startup, main-thread blocking, IPC, memory, session scanning, Files search, and
packaging first; optimize only measured hot spots.

### Checkpoint C1 - host-function baseline (2026-09-20)

C1 is **measurement only**. It adds a synthetic-fixture harness that measures three
production main-process functions in isolated Node 22.22.2 worker processes, two
sequential batches per case (case order reversed in batch two), one fresh process per case
per batch, with the first invocation and two warm-ups kept separate from ten measured
invocations.

**Protocol revision 3 (2026-09-20).** Revisions 1 and 2 are retained as
**provisional/exploratory**: it measured a post-control-call "first invocation", reported
memory as whole-series endpoint observations, compared workload blocking maxima against a
control median, and computed input hashes after the decision rather than gating on them.
The corrected protocol measures the actual first call, publishes ten per-invocation
post-yield memory observations and derives growth from those endpoints before taking the
median, uses the same per-window maximum statistic for workload and matched control, and
applies the 50 ms / +30 ms blocking gate to the **batch median of the ten window maxima**
rather than to the batch maximum. It requires exit-code 0 plus schema/case/digest
validation, recomputes every decision statistic from raw samples, retains every
calibration, applies repeatability to the metric that triggers the recommendation
(`profileFocus: blocking` for S1), and gates the result — including a negative conclusion —
on worker/worker-hash, resolved-dependency, fixture-content-digest and Git-ignore-preflight
provenance. Revision 3 also fixes the memory endpoint order, the timeout/stop-expansion
contract and task-owned child identity on failure. Those provisional numbers are superseded
by the correct-protocol run below and must not be averaged with it: the runs measured
different harness revisions.

Corrected run, isolated candidate A, Node 22.22.2 (two sequential batches, batch 2 order
reversed, one fresh process per case per batch):

| Case | Production function | Duration median (batch 1 / batch 2) | Blocking median of window maxima (batch 1 / batch 2) | Predeclared threshold | Disposition |
| --- | --- | --- | --- | --- | --- |
| P1 | `probeImportHold`, populated source, empty destination | 4.408 / 4.704 ms | 5.636 / 5.398 ms | > 25 ms; control max 5.389 / 5.595 ms | NO_OPTIMIZATION_JUSTIFIED |
| P2 | `probeImportHold`, populated destination | 0.610 / 0.547 ms | 5.196 / 5.676 ms | > 25 ms | NO_OPTIMIZATION_JUSTIFIED |
| S1 | `scanImport`, 1,000 small sessions | 164.110 / 149.094 ms | **156.301 / 139.540 ms** (window max 196.254 / 174.649) | > 250 ms duration; > 50 ms blocking median and > 30 ms above control | **PROFILE_ONE_HOT_PATH, `profileFocus: blocking`** |
| S2 | `scanImport`, one ~8 MiB session | 20.994 / 20.641 ms | 11.427 / 10.980 ms | > 250 ms; RSS 12.81 / 13.01 MiB, heap 7.53 / 7.51 MiB | NO_OPTIMIZATION_JUSTIFIED |
| F1 | `listDir`, 100 files + ignore rules | 76.867 / 71.193 ms | 9.771 / 9.454 ms | > 100 ms | NO_OPTIMIZATION_JUSTIFIED |
| F2 | `listDir`, 1,000 files + ignore rules | 88.435 / 84.118 ms | 9.100 / 9.312 ms | > 250 ms | NO_OPTIMIZATION_JUSTIFIED |

No duration threshold was breached in both batches. **S1** is the only finding that
repeats: the median of its ten per-invocation window maxima is 156.30 / 139.54 ms, above
the predeclared 50 ms absolute floor and more than 30 ms above the matched no-work control
(5.13 / 5.22 ms max), and the blocking series passes its own repeatability gate
(between-batch delta 16.76 ms within a 27.91 ms tolerance, per-batch MAD 18.63 / 8.15 ms).
The raw window maxima 196.25 / 174.65 ms are published as diagnostics only; the gate does
not use them. Its focus
is labelled **blocking**, not latency, because blocking — not the 250 ms duration
threshold — is the metric causing the recommendation. Disposition `PROFILE_ONE_HOT_PATH`
recommends profiling that single path next; it does **not** authorize a production patch.
The deliberate 40 ms synchronous calibration block was detected in all 12 workers, and all
no-work control maxima stayed below the 20 ms contamination gate.

**S2 memory is not a finding.** Under the endpoint-derived per-invocation post-yield median
protocol its heap growth stayed at 7.53 / 7.51 MiB, below the 32 MiB threshold, and RSS at
12.81 / 13.01 MiB, below 64 MiB. The provisional run's whole-series endpoint observations
are superseded; no leak is claimed. S2's endpoint statistic moves between harness revisions
because it is GC-timing dependent, which is exactly why it only triggers profiling and is
never averaged across revisions.

Evidence: `C:\Ai\_dshd-validation\c2c_2a1c-C1-reviewed-r2\{report.json,summary.md}`
(isolated candidate A, Node 22.22.2, production/worker/fixture hashes unchanged across the
run, resolved production dependencies and launched-worker PID/SHA256 recorded per case, and
task-owned `git check-ignore` children recorded with their injected bookkeeping subtracted
from the timed duration), and fixture content digests plus timeout/child-process evidence.
The first corrected attempt,
`c2c_2a1c-C1-corrected`, is retained as a defect record: it returned
`INCONCLUSIVE` only because repeatability was mistakenly applied to non-triggering series,
which the preregistered protocol forbids; that defect was fixed before `-r2` and is not a
threshold change. `c2c_2a1c-C1-reviewed` is the first revision-3 attempt and is also
retained: the hardened input gate failed it closed with `FIXTURE_MANIFEST_MISMATCH` because
the expected inventory compared a per-log record count against a summed total — a harness
accounting defect, fixed before `-r2`. `-r2` and `-r3` of the previous revision are
superseded provenance revisions (worker identity, then child-process accounting).
Provisional reports remain at
`c2c_2a1c-C1-candidate`, `c2c_2a1c-C1-candidate-r2`, `c2c_2a1c-C1-final-candidate` and
`c2c_2a1c-C1-final-live`. Harness: `scripts/measure-desktop-lifecycle.mjs`,
`scripts/lib/desktop-perf-worker.cjs`, `scripts/measure-desktop-lifecycle.test.mjs`
**76/76** on both the live tree and candidate A. Decision record:
`docs/decisions/proposed/testing/2026-09-20-desktop-performance-measurement.md`.

#### Checkpoint C1 corrections (iteration 4, 2026-09-20)

The reviewed-r2 report stands as the recorded measurement of its revision; iteration 4
does not re-run it. Three protocol holes were closed in the harness instead:

1. **Child-PID safety.** `parseChildRecords()` returned every announcement ever seen, so a
   timeout killed historical PIDs whose numeric value could already belong to an unrelated
   process. It is replaced by a per-PID lifecycle ledger that only exposes currently open
   children as signal targets, validates positive integer PIDs, drops torn/malformed
   announcements without displacing known-good records, and keeps an attempted signal
   distinct from OS-confirmed termination. Unconfirmed termination is now fatal
   (`UNRESOLVED_PROCESS`), records `unresolvedChildren` with `terminationConfirmed:false`,
   and launches nothing further.
2. **Raw elapsed time is authoritative.** The worker's overhead-subtracted `durationMs`
   had been feeding the thresholds. `rawDurationMs` is now the primary series for
   threshold comparisons, repeatability and published medians; the subtracted value is
   published as `adjustedDurationEstimateMs` only. Payloads must declare
   `authoritativeDurationSeries: 'rawDurationMs'` or they are rejected as
   `DURATION_SERIES_MISLABELED`. The F-case durations in the reviewed-r2 report were
   recomputed from its stored `rawDurationMs` as **analysis only** (F1 77.023 / 71.275 ms,
   F2 88.502 / 84.321 ms versus the previously published 76.867 / 71.193 and 88.435 /
   84.118); the ordering and the S1 conclusion are unchanged.
3. **Execution validity is not the analytical verdict.** `const complete = verdict !==
   'CORRECTNESS_FAILURE'` had let input-gate failures exit 0. `executionStatus()` now
   derives `{ok, exitCode, reasons}` from the validity flags and input violations, so a
   methodologically invalid run fails with a nonzero exit code and preserves each specific
   reason, while a valid-but-evidence-free `INCONCLUSIVE` still exits 0.

Checks: harness **76/76** on Node 22.22.2 in both the live tree and candidate A (the three
harness files are SHA256-identical across the two trees); `npm run check:governance` 6/6 and
`node scripts/run-gates.mjs doc-sync` 8/8 on the live tree. Candidate A's `doc-sync` is
**7/8**, failing `verify-md-links` only because the copy pre-dates four `docs/qa/*` files
(`production-acceptance-test-cases.md`, `mobile-remote-live-acceptance.md`,
`results/2026-08-25/installer-branding/TC-INST-RUNBOOK.md`,
`results/2026-09-08/remote-ayase-deployment.md`) that exist in the live tree; that
candidate-A documentation gap is pre-existing and unrelated to this iteration. No full
desktop suite and no broad benchmark re-run were performed for iteration 4.

Still NOT MEASURED and still pending: live Electron main-thread blocking and IPC
round-trip latency, full/packaged startup, rendered Files search, zstandard-compressed
sessions, packaging and installer acceptance, live SSH acceptance, real-Electron
host replacement, and checkpoints D2/D3 and E.

#### Checkpoint C1 corrections (iteration 5, 2026-09-20)

Iteration 4's review accepted the raw-duration-authoritative change and the separation of
execution validity from the analytical verdict, and found two remaining ways to claim a
clean termination without observing one. Both are closed in the harness (measurement only;
no production code and no re-run of the reviewed-r2 measurement):

1. **Termination confirmation now requires worker exit AND child resolution.** The timeout
   path previously sent `child.kill()` and immediately entered the child-only completion
   check, so with an empty child ledger it could return `terminationConfirmed:true` without
   ever observing the worker exit or the kill result. The worker-`close` branch was also
   guarded by `survivors.length > 0 && !timedOut`, which let a close during a timed-out run
   bypass child polling and clear the grace observer. There is now one completion condition
   shared by the timeout path and the post-exit cleanup path: **worker exit observed by the
   spawn handle AND every tracked child either known-closed or confirmed absent**. Worker
   exit is recorded only from the spawn lifecycle event, a false `kill()` return or a throw
   is recorded as a failed attempt rather than an exit, the timed-out `close` route passes
   through the same check, and an unexpected existence-probe error stays `unknown` and
   therefore unresolved. If the grace period expires the run stops with
   `UNRESOLVED_PROCESS`, keeping the unresolved worker/child identities and the original
   timeout reason under `requestedFailure`.
2. **Report serialization keeps the observed termination evidence.** Worker identity is
   built from the actually spawned PID instead of the (absent on timeout) final payload,
   `terminated` comes from `terminationConfirmed` instead of being inferred from
   `failure !== 'UNRESOLVED_PROCESS'`, and failed rows preserve `requestedFailure`,
   `terminationConfirmed`, `workerExitConfirmed`, the kill attempt, signal attempts, and
   unresolved worker/children. A report-level regression routes a real failed `runWorker`
   outcome through the production report builder.

Checks: harness **82/82** on Node 22.22.2 in both the live tree and candidate A (the three
harness files are SHA256-identical across the two trees); `npm run check:governance` 6/6 and
`node scripts/run-gates.mjs doc-sync` 8/8 on the live tree. Candidate A's `doc-sync` is
**7/8**, failing `verify-md-links` only because the copy pre-dates four `docs/qa/*` files
that exist in the live tree; that candidate-A documentation gap is pre-existing and
unrelated to this iteration. Mutation checks (temporary copy outside the checkout, deleted
afterwards) confirmed the new tests discriminate the bypasses: dropping the worker-exit
requirement fails the kill-result and late-close tests, treating `unknown` as absent fails
the unexpected-probe-error test, and restoring the early `close` finish under timeout fails
the timeout-close and alive-child tests. One further candidate mutation (re-adding the
`&& !timedOut` guard to the survivor branch) was equivalent after the unification because
both branches now route through the same completion check, so it is recorded as an
equivalent mutation, not as evidence. No full desktop suite and no broad benchmark re-run
were performed for iteration 5.

Still NOT MEASURED and still pending: live Electron main-thread blocking and IPC
round-trip latency, full/packaged startup, rendered Files search, zstandard-compressed
sessions, packaging and installer acceptance, live SSH acceptance, real-Electron
host replacement, and checkpoints D2/D3 and E.

#### Checkpoint C2 (1A) - S1 attribution (2026-09-20, iteration 19)

C2 answers "where does S1's blocking time go?" without reopening C1's acceptance and
without authorizing any production change under any outcome. Protocol: two rounds, each an
unprofiled control process followed by a profiled one (sequential, never concurrent); two
untimed warm-ups then ten measured scans per process; an in-process `node:inspector` CPU
profile enabled only around the measured scans, stopped before
projection/digest/oracle/serialization and `disconnect()`ed in a `finally`; the raw
`.cpuprofile` retained per round. The parent re-parses that file and recomputes every
share; category shares are self-time based and disjoint, and inclusive nested totals are
published separately as diagnostics that must never be summed with them. Predeclared
decision rule: a next-step proposal is supportable only if a category is both >= 20% of
attributed workload time and >= 20 ms per scan in BOTH rounds with the C1 digest still
matching; profiler overhead > 20%, unattributed time > 50%, or a material ranking
disagreement each downgrade the result to a limitation instead of a recommendation.

Executed result (working tree, Node 22.22.2, both rounds valid, S1 digest equal to C1's
oracle): control 155.58 / 146.28 ms versus profiled 216.45 / 213.12 ms, i.e. **+39.1% /
+45.7%** profiler overhead. Both rounds breach the 20% ceiling, so the recorded verdict is
**`LIMITATION_PROFILER_OVERHEAD`** and **no category is proposed**. Published shape
(evidence only, never a recommendation): `session-meta-read` 39.8 / 40.7% (86.33 / 89.35 ms
per scan), `session-walk` 37.3 / 36.6% (81.01 / 80.33 ms), `dest-existence` 19.1 / 18.5%
(41.56 / 40.66 ms), gc 1.3 / 1.5%, unclassified 1.1 / 1.1%. A separately declared coarse
run (1,000 µs interval) recorded the same verdict with larger overhead (+61.6 / +67.9%),
so coarsening the instrument did not make the gate reachable on this machine; it is
reported as a limitation too. Evidence: `c2c_6678-C2-1A-r1` and
`c2c_6678-C2-1A-r1-coarse`. Harness **72/72** (Node 22.22.2, live tree).
This does not change C1's accepted S1 blocking result, its median statistic or its
raw-duration rule.

#### Checkpoint C2 (1A) corrections (iteration 5 of the audit task, 2026-09-21)

Review found the last fail-open path in the dependency-identity boundary:
`evaluateExecution()` derived one `dependencyIdentity` map as the **union** of whatever
`resolvedModules` happened to appear across the required runs. The union detected the same file
carrying two different hashes, but it never required every required round/mode to report the same
file set. A report such as R1/control `[A,B]`, R1/profiled `[A,B]`, R2/control `[A]`, R2/profiled
`[A,B]` therefore passed with the published provenance and the final recheck both covering
`[A,B]`: R2/control never proved dependency B, yet the run still exited 0. A second, smaller
mismatch collapsed an exact duplicate row in `provenance.resolvedProductionDependencies` carrying
the *same* hash.

Dependency identity is now **per run** rather than a union: the canonical map is taken from the
first valid required run (round order, then mode order) and every required round/mode must contain
exactly that file set with exactly those hashes. A required run missing `resolvedModules`, an empty
list, a missing canonical dependency, an unexpected extra dependency, or a duplicate record inside
one run (including a same-hash duplicate) invalidates the execution
(`RESOLVED_DEPENDENCY_SET_INCOMPLETE` for absent or empty evidence,
`RESOLVED_DEPENDENCY_SET_MISMATCH` for a set or duplicate problem), while conflicting digests keep
the existing `RESOLVED_DEPENDENCY_IDENTITY_UNSTABLE`. The published provenance now requires exactly
one row per canonical dependency, so a same-hash duplicate row is
`PROVENANCE_DEPENDENCIES_INCOMPLETE` rather than being silently collapsed by the `Map`. The final
`inputIdentity.dependencyRecheck` one-to-one rule is preserved unchanged and is now compared
against the stricter canonical set; the measured production input's three-way before/after rule is
untouched, and every pre-existing reason code still fires. Checks: harness **79/79** on Node
22.22.2 (72 existing + seven new cases that reach `finalizeReport()`, one of them a fully complete
two-dependency positive control that also reports its records in the other order),
`run-gates governance` **6/6** and `run-gates doc-sync` **8/8**, all exit 0. Negative control in a
scratch copy outside the checkout: restoring the union-only merge (no per-run set comparison and no
same-hash duplicate rejection) failed exactly the six new discriminating tests (**73 pass / 6
fail**), while the 72 pre-existing cases still passed. No new profiling run, no production change,
no threshold, sample-count or category change, and C1's accepted S1 result, median statistic and
raw-duration rule are unchanged.

#### Checkpoint C2 (1A) corrections (iteration 4 of the audit task, 2026-09-21)

Review found one remaining fail-open path in the execution validity boundary:
`evaluateExecution()` only compared a module hash against the before/after maps *when the
map and the key happened to exist*, so a report that omitted `inputIdentity.hashesBefore`,
omitted one required module key, carried a null/malformed digest, or omitted the final
dependency recheck entirely still passed every check and could exit 0. Validity is now
derived from the actual evidence rather than from `inputIdentity.unchanged`, which stays a
readable diagnostic only: each of `attributionHarness`, `profileWorker`, `c1Worker` and
`c1Harness` must carry a well-formed `sha256:<64 hex>` in the before map, the after map and
`provenance.executedProfilingModules`, and all three must agree
(`PROVENANCE_MODULE_HASH_MISSING` for absent, null or malformed evidence,
`PROVENANCE_MODULE_IDENTITY_UNSTABLE` for disagreement). The measured production input is
gated by the same rule across the two maps, and
`inputIdentity.dependencyRecheck` must exist and correspond one-to-one with the canonical
dependency set derived from the required runs, with recorded and current digests equal to
each other and to the cross-run identity (`RESOLVED_DEPENDENCY_RECHECK_MISSING` for a
missing, partial or duplicated coverage, `RESOLVED_DEPENDENCY_RECHECK_FAILED` for a
disagreeing, extra or `matches !== true` row). Checks: harness **72/72** on Node 22.22.2
(seven new cases reach `finalizeReport()`, one of them a fully complete positive),
`run-gates governance` **6/6**
exit 0. Negative control in a scratch copy outside the checkout: restoring the permissive
"only when present" comparisons failed exactly the six new discriminating tests (66 pass /
6 fail). No new profiling run, no production change, no threshold or category change, and
C1's accepted S1 result, median statistic and raw-duration rule are unchanged.

#### Checkpoint C2 (1A) corrections (iteration 3 of the audit task, 2026-09-21)

Review of the iteration-2 submission required four corrections; the first two are the
substantive ones because they close paths that could turn evidence into a favourable
answer:

1. **Unusable timing and cyclic graphs are rejected before attribution.** Individual
   `timeDeltas` entries are now validated (a negative, non-finite or non-numeric delta is
   `PROFILE_DELTA_INVALID`; a series that carries entries but no positive elapsed time is
   `PROFILE_TIMING_UNUSABLE`), and the parent graph is checked for self-edges, conflicting
   parents and multi-node cycles (`PROFILE_GRAPH_CYCLIC`). `resolveNamedAncestor` also
   carries a visited-set bound so an unvalidated cyclic graph cannot spin forever. The
   previously permissive "drop bad deltas sample by sample" behaviour is gone: dropping
   them would shrink the attributed total and shift every published share.
2. **Hash completeness and cross-run stability.** `validateProfileRun` now requires a
   well-formed `sha256:<64 hex>` on the recorded side and a real hash on the re-read side,
   so a missing file and a recorded `sha256: null` can no longer agree with each other
   (`RESOLVED_DEPENDENCY_HASH_INVALID` / `RESOLVED_DEPENDENCY_HASH_UNAVAILABLE`), and
   duplicate records for one canonical file must agree (`RESOLVED_DEPENDENCY_CONFLICT`).
   `evaluateExecution` additionally requires all four executed-module entries with real
   hashes, requires one consistent identity per dependency across all required runs,
   requires the published dependency list to agree with the per-run records, and compares
   the published module identity against the before/after hash maps. The publisher now
   captures those four module hashes before the measurement window, groups them under the
   same names it publishes, and re-checks every resolved dependency on disk before writing
   the report (`RESOLVED_DEPENDENCY_RECHECK_FAILED`).
3. **Two reporting paths corrected.** The worker's cleanup error now carries
   `profileStopError` as well as `sessionDisconnected`, and that flag describes the
   disconnect operation rather than a successful connect, so a throwing `disconnect()`
   reports unconfirmed instead of clean. The release-asset link tests now use the runner's
   skip mechanism instead of printing and returning, which used to record a PASS for a
   fixture that was never exercised.
4. **Evidence is exposed as readable outputs.** The three records and the revalidation
   log are registered individually rather than behind an index, and the revalidation
   report separates "current revalidation" (row-level gates over the stored payloads,
   PASS) from "historical stability proof" (NOT CAPTURED in a run that predates the
   provenance fields). The historical run is therefore reported as method-invalidated
   rather than silently promoted.

Revalidation of the stored 250 µs and 1,000 µs payloads: all 8 real rows still VALID, and
14 single-field mutations are each rejected with a non-zero exit and the candidate list
cleared (`revalidate-real-evidence.log`, failures 0). A code-path smoke run of the updated
publisher (`iter3-provenance-smoke-a`, 3 scans / 1 warm-up per mode) confirms the new
capture path completes and records four module hashes, four dependency rechecks and
`execution.ok=true`. Iteration-3 gate results: `profile-import-scan.test.mjs` **65/65**,
`check-release-assets.test.mjs` **36/36**, `ci-isolation.test.js` **17/17**,
`run-gates governance` **6/6**, `run-gates doc-sync` **8/8** — identical in the live tree
and candidate-A.

Candidate-A's earlier `doc-sync` 7/8 on `verify-md-links` is **superseded**, and the
replacement is recorded rather than asserted: the four `docs/qa/*` inputs
(`production-acceptance-test-cases.md`, `mobile-remote-live-acceptance.md`,
`results/2026-08-25/installer-branding/TC-INST-RUNBOOK.md`,
`results/2026-09-08/remote-ayase-deployment.md`) are present in the copy and SHA256-identical
to the live tree (70262 / 38103 / 6270 / 1861 bytes respectively), which is why the
candidate now reports 8/8. The record, including each full SHA256, is
`c2c_6678-iter3-evidence/candidate-a-doc-inputs-sync.md`. Both the old and the new status
are therefore tied to their own input identity; neither is carried forward on its own.

#### Checkpoint C1 corrections (iteration 6, 2026-09-20)

Iteration 5's review accepted the shared completion condition and the report serialization,
and found one remaining path around them: `child.on('error')` still called
`finish(SPAWN_ERROR)` unconditionally. Node documents that a child's `error` event can also
mean a failure *after* creation (for example a `kill()` whose signal could not be
delivered) and does not guarantee a subsequent `exit`/`close`, so a worker that was alive
with a live child could be finished as an ordinary creation failure: timers cancelled,
identity and termination facts omitted, and `runControlAfter` free to launch the next case.

The handler now separates the two meanings. An `error` with no PID ever observed is a
genuine creation failure and stays a bounded `SPAWN_ERROR` that signals nothing and claims
no termination. Once a PID exists the error is recorded as `{code, message}` and attached
to the matching kill attempt; it must not finish early, must not cancel the grace observer,
and must not recurse into another `terminate()`/`kill()`. The result stays owned by the one
completion condition (worker exit AND every tracked child resolved), with the original
reason preserved in `requestedFailure` and the error carried through
`workerIdentityFor`/`persistedCaseRow` as separate evidence.

Checks: harness **85/85** on Node 22.22.2 in both the live tree and candidate A (the three
harness files are SHA256-identical across the two trees); live `npm run check:governance`
6/6 and `node scripts/run-gates.mjs doc-sync` 8/8, both exit 0; candidate-A governance 6/6.
Mutation checks in a temporary copy outside the checkout (deleted afterwards): replacing
the post-spawn branch with an unconditional `finish(SPAWN_ERROR)` failed the two new
post-spawn cases (83 pass / 2 fail), and making the error handler call `terminate()`
unconditionally failed the same two. A third candidate mutation that guarded the recursive
call with `!timedOut` was **equivalent** (the fixture's error is emitted from the timeout
path, so the branch was never reached) and is recorded as equivalent, not as evidence.
Candidate A's
`doc-sync` remains 7/8 on `verify-md-links` for the pre-existing `docs/qa/*` copy gap and is
never reported as a candidate pass. No full desktop suite and no benchmark re-run were
performed for iteration 6; the accepted S1 blocking result, the median statistic, the
raw-duration rule and the CLI validity distinction are unchanged.

Still NOT MEASURED and still pending: live Electron main-thread blocking and IPC
round-trip latency, full/packaged startup, rendered Files search, zstandard-compressed
sessions, packaging and installer acceptance, live SSH acceptance, real-Electron
host replacement, and checkpoints D2/D3 and E.

## Phase 7 - Supply chain and release pinning

Pin release-workflow actions to commit SHAs to match test.yml. Do not run
`audit fix --force` and do not publish.

Current implementation (Checkpoint 1B, 2026-09-20): every `uses:` in `release.yml` and
`publish.yml` is a 40-hex SHA. Promotion no longer re-implements asset checks in shell;
`scripts/check-release-assets.mjs` is the single read-only, offline, bounded validator and
`publish.yml` calls it before checksums, provenance and `gh release create`. The sparse
checkout carries the helper, `package-lock.json` and `.nvmrc`; runtime prep is
`npm ci --ignore-scripts` with no `npx`; a candidate SHA without the helper fails instead of
substituting another revision. Verified scope: 36/36 validator cases (four of them
mutation proofs) and 17/17 `ci-isolation.test.js` workflow pins. NOT RUN: dispatching
`publish.yml` (requires a real candidate run and tag), and any actual release promotion.

## Phase 8 - Integration gates

Governance + doc-sync, Harness build and focused suites, source smoke, packaged smoke,
and installer acceptance in an isolated VM.

## Known deferrals

- An optional Windows DPAPI credential backend already exists in
  `vendor/dsh-remote/lib/credential.js`; it falls back to plaintext with a user-visible
  warning when protection is unavailable. Mandatory encryption, credential migration,
  and recovery policy remain separate, unfunded decisions.
- Live SSH acceptance cannot be executed here (no host configured); Phase 3 makes that
  state explicit instead of silently green.

## Phase status (Checkpoint A, 2026-09-20)

Baseline: HEAD `dc05e7ae1dd67f456092c0f688f7efc22587a27f`; working tree 657 entries
(70 modified, 587 untracked). All evidence below is working-tree evidence, not HEAD.

| Phase | Status | Evidence |
| --- | --- | --- |
| 0 - Ledger and ownership | complete | `.tmp/audit-iteration5-git-evidence.txt`; candidate manifest `.tmp/audit-iteration5-candidate-A-manifest.json` |
| 1 - Manifest/runtime contract | implemented, verified | `package-contract.test.js`; manifest hash `f5b78b93502ebf6e`; full suite has no manifest-linked failures |
| 2A - Readiness cancellation | implemented, verified | `harness-browser-auth.test.js`, `dsh.test.js` generation/identity cases |
| 2B - Preview permission policy | implemented, verified | `preview-session.test.js` deny-by-default origin/frame/owner matrix |
| 3 - Live acceptance contract | implemented, corrected in A | guard `deadlineSignal` timer no longer `unref()`; 29/29 guard+runner on Node 22.22.2 and 26.7.0, including a no-other-handle deadline regression |
| 4 - Remote identity isolation | implemented, verified | `vendor/chisacode-remote/packages/cli/src/utils/client-id.test.ts` (vitest, package-scoped) |
| 5 - Negative-path coverage | B1-B3 closed (B2 corrected in iterations 8, 9 and 11), B4 verified | B1 workspace containment (trusted-root cwd anchor + dangling-link refusal; 35/35). B2 IPC/preview/PTY lifecycle, **partially accepted**: the original global-sweep host cleanup was a real regression and is replaced by generation-scoped teardown with synchronously claimed shared-singleton ownership; the real-Electron permission runner's isolation, exact per-frame success predicate, unexpected-grant rejection and exit-status agreement are fixed; the standalone profile cleanup now has a tri-state owner probe (only a confirmed `ESRCH` may delete), an ownership-token handoff, and a durable receipt outside the profile root so uncertain outcomes retain and stay observable. `preview.test.js` 67/67 (isolation mutations verified), `verify-preview-permissions.test.mjs` 17/17 with 0 skip (default-deny and positive-control both exit 0 with `report.ok=true`). B3 import journal + vendor remote negative paths (27/27 + 26/26). B4 renderer 706/706 and 1517/1517 vitest. Iteration 11 final: live tree and candidate-A both **1894/1892 pass/0 fail/2 skip** on Node 22.22.2 (same desktop selection; vendor 26/26 reported separately) |
| 6A - Measured performance (C1) | **CLOSED** by independent review at iteration 6 (2026-09-20) | Harness **85/85** on Node 22.22.2 in both trees (iterations 5-6 added the shared completion condition, tri-state probe, report serialization and post-spawn-`error` handling). Authoritative measurement: `c2c_2a1c-C1-reviewed-r2`; S1 is the only repeated finding, focus **blocking** — median of invocation-window maxima 156.301 / 139.540 ms vs matched control maxima 5.132 / 5.219 ms, between-batch delta 16.76 ms within the 27.91 ms tolerance. Next step is attribution, not production rewriting. Live Electron/IPC/rendering/packaging still NOT MEASURED |
| 6B - S1 attribution (C2 checkpoint 1A) | executed; verdict `LIMITATION_PROFILER_OVERHEAD`, **no optimization authorized or proposed** | Harness `profile-import-scan.mjs` + `lib/import-scan-profile-worker.cjs` **79/79** (Node 22.22.2; the recorded 72/72 was the live/candidate-A count before iteration 5 added seven cases). Two rounds, control-vs-profiled medians 155.58→216.45 ms (+39.1%) and 146.28→213.12 ms (+45.7%): both breach the predeclared 20% instrument-overhead ceiling, so the rule returns a limitation. Shape (evidence, NOT a recommendation): `session-meta-read` 39.8/40.7%, `session-walk` 37.3/36.6%, `dest-existence` 19.1/18.5%, unclassified 1.1/1.1%. Coarse 1,000 µs configuration also recorded `LIMITATION_PROFILER_OVERHEAD` (+61.6/+67.9%) and is reported as a limitation too. Evidence: `c2c_6678-C2-1A-r1` and `c2c_6678-C2-1A-r1-coarse`. Iteration 3 added delta/graph validation, hash completeness and cross-run identity gates, a real final dependency recheck, and readable evidence outputs; 14 mutations of the stored payloads are all rejected. Iteration 4 made the execution validity boundary fail-closed: before/after/provenance module hashes must all exist and agree, the measured production input is gated the same way, and the final dependency recheck must correspond one-to-one with the canonical dependency set, so missing evidence invalidates the run instead of passing. Iteration 5 replaced the union-of-runs dependency identity with a per-run exact-set rule (canonical set from the first valid required run; missing/empty set `RESOLVED_DEPENDENCY_SET_INCOMPLETE`, missing/extra/duplicated record `RESOLVED_DEPENDENCY_SET_MISMATCH`, conflicting digest unchanged as `RESOLVED_DEPENDENCY_IDENTITY_UNSTABLE`) and rejects same-hash duplicate published provenance rows, so a round that never proved a dependency can no longer be published. The stored runs predate provenance capture, so they replay cleanly through the current per-row gates but are explicitly **not** a historical stability proof. C1's accepted result, median statistic and raw-duration rule unchanged |
| 7 - Supply chain/release pinning | implemented for the asset-validation scope (Checkpoint 1B); workflow dispatch NOT RUN | Validator `scripts/check-release-assets.mjs` + `check-release-assets.test.mjs` **36/36** including four mutation proofs (SHA256, SHA512, `files[].url` name match, `files[].size`), each showing the mutated copy accepts what the shipped one rejects. Both link cases now skip through the runner's skip mechanism when the host refuses symlink creation, instead of printing a message and recording a PASS for an unexercised fixture. `publish.yml` invokes the validator before checksums/provenance/publish, carries helper + lockfile + `.nvmrc` in the sparse checkout, uses `npm ci --ignore-scripts`, contains no `npx`, and fails explicitly when the candidate SHA lacks the helper. `ci-isolation.test.js` **17/17** pins that. All 11 workflow `uses:` remain 40-hex SHAs. `publish.yml` itself was **not dispatched** (needs a real candidate run and tag) |
| 8 - Integration gates | pending (Checkpoint E) | not started |

### Checkpoint A results

Checkpoint A is **four distinct result classes**. They are never combined into one
"green" claim:

1. **Clean install (candidate).** `npm ci --no-audit --no-fund` exit 0 (293 packages, 7s)
   under Node 22.22.2; the Electron binary was installed separately (`.npmrc` sets
   `electron_skip_binary_download=true`), exit 0, `electron.exe` present. The
   electron-install log is 0 bytes — an evidence gap, not a pass; see the revised
   candidate manifest.
2. **Guard/runner suites (by runtime, in the live tree).** 29/29 on both Node 22.22.2 and
   Node 26.7.0 (28 before the deadline-lifetime regression was added). This is
   fixture-level evidence for the guard library's own contract, not live SSH acceptance.
3. **Live-tree full run (historical).** Node 22.22.2 on the real tree before the
   containment fixes: 1842 tests, 1840 pass, 0 fail, 2 skipped, 0 cancelled
   (`.tmp/audit-iteration5-node22-live-full.log`). Historical only; superseded by the runs
   recorded below.
4. **Candidate full validation.** Exact-glob Node 22 runs in
   `C:\Ai\_dshd-validation\candidate-A`, both after the QA inputs were restored and the
   vendored workspace links rebuilt:
   - `candidate-A-full-node22-v3.log` (before the containment fixes): 1843 tests, 1841
     pass, 0 fail, 0 cancelled, 2 skipped.
   - `candidate-A-full-node22-v4.log` (after the B1 containment fixes were synced into the
     candidate): 1849 tests, 1847 pass, 0 fail, 0 cancelled, 2 skipped, exit 0.
   `node:test` printed `1..1829` / `1..1835` while reporting 1843 / 1849 — a
   reporter/plan-count discrepancy that is documented, not explained away.

Candidate provenance: built with `robocopy /E /XJ`; the copy itself excluded
`node_modules`, `.pnpm-store`, `dist`, `tmp`, `artifacts`, `docs/qa`, `.tmp`,
`.superpowers`, `.omc`, `.omo`, `.codely`, `.codely-cli`; 0 failures. `.git` **was**
excluded from the copy; what exists now was created afterwards by `git init -q` as a bare
scaffold — 0 objects, empty `refs/heads` and `refs/tags`, no index, no reflog, no
`objects/info/alternates`, no `commondir`, no `gitdir`, no `worktrees`, and local config
is exactly the `git init` defaults. `git rev-parse HEAD` therefore exits 128 there. No
writable link points back into the live checkout: all 56 reparse points are junctions
that resolve inside the candidate (0 into the live checkout, 0 outside, 0 dangling) — a
finding reproduced independently by `.tmp/audit-iteration6-verify-link-isolation.cjs`.
Two external cache links under `vendor/chisacode-remote/node_modules/` (`.cache`,
`.vite`) are deliberately not recreated. Manifest:
`.tmp/audit-iteration6-candidate-A-manifest.json` (237146 files / 7816394836 bytes;
`package.json` and `package-lock.json` hashes identical to the live tree, so `drift` is
empty).

Two candidate caveats stay visible rather than being smoothed over: the
electron-install log is empty (only the driver's exit 0 and a present
`electron.exe` are on record), and a planned scrub of `cli-client-id` /
`residential-chain.json` was policy-blocked and never ran, so both remain byte-identical
to the live tree.

Candidate-only failures found during preparation were copy artifacts, not product
defects, and each was resolved by restoring the missing input rather than by weakening a
test: the four `git check-ignore` cases needed a `.git` directory, `shell-p0-qa.test.js`
needed `docs/qa/results/2026-08-31/ci-installer/run-installed-full.mjs`, and
`remote-epipe.test.js` needed the workspace junction
`vendor/chisacode-remote/node_modules/@chisacode/protocol`.

### Corrections to earlier iteration notes

- The manifest loss was a working-tree-only incident, not a HEAD defect.
- A zero-exit skip is `NOT RUN (not PASS)`; it is not a pass.
- `/dsh-remote/machines` serves both GET (list) and POST (mutate).
- Generation guards reject stale publication; they do not cancel in-flight requests.
- Optional Windows DPAPI protection exists, but mandatory encryption and credential
  migration remain separate, unfunded decisions.
- Historical timings that were never recorded stay unknown; this plan records only
  measurements produced by its own scripts.
- Unit-test counts and live-test counts are distinct and are never combined.

## Final closeout — Checkpoint 2 stopped by user (2026-09-21)

The user stopped Checkpoint 2 and directed this audit/repair work line to close instead of
continuing build and integration work while unrelated product defects remain. This is a
**closure with residual work**, not a claim that every planned gate passed and not a
release approval. No production performance optimization is authorized.

What completed before the stop:

* The current source candidate was frozen and synchronized to candidate-A; the final
  convergence check reported **0 files pending**.
* The smoke harness gained an explicit no-commit existing-workspace mode in
  `scripts/smoke-workspace.mjs`, `scripts/run-source-smoke.mjs` and
  `scripts/run-packaged-smoke.mjs`, with focused coverage in
  `scripts/smoke-workspace.test.mjs`. The mode lets source/packaged smoke use an existing
  Git workspace without running `git init`, `git add`, `git commit`, checkout, branch or
  worktree creation. Its temporary `userData` / `dsh-home` remains isolated and the
  supplied workspace is not deleted by smoke cleanup.
* The smoke-workspace focused suite passed **7/7** in both the live tree and candidate-A;
  the four smoke-harness files were SHA256-identical across the two trees.
* The final focused closeout bundle passed **60/60**, and governance **6/6** plus doc-sync
  **8/8** both exited 0.
* No product implementation was changed by Checkpoint 2, and the previously established
  performance disposition remains unchanged:
  `productionOptimizationAuthorized=false`.

The attempted `build:official` did **not** complete. It reached the Harness client
typecheck and then failed in another concurrent workstream's uncommitted edits:

* `vendor/deepseek-harness/packages/client/ui-directory-picker-browse/tests/client-flow.client.spec.tsx`
* `TS6133` at line 71
* `TS2740` at lines 244, 265, 290, 334 and 355 because the affected values were missing
  `GlobalStandardProps`

Those edits are outside this task's ownership. This task did not fix them, revert them or
weaken the typecheck. After that blocker was identified, the user explicitly stopped the
remaining Checkpoint 2 work rather than asking this audit line to repair unrelated product
defects.

Final disposition of the unfinished gates:

* `build:official` completion — **NOT RUN TO COMPLETION**; blocked at client typecheck by
  concurrent unrelated edits, then abandoned for this plan by user direction.
* Harness `test:gui` — **NOT RUN**.
* Focused core Vitest suites — **NOT RUN**.
* Malformed-tool snapshot replay — **NOT RUN**.
* Client catalog / third-party notices `--check` — **NOT RUN**.
* Source smoke — **NOT RUN**; the no-commit harness support was implemented and tested,
  but no current source application smoke was executed after the build failed.
* Phase 6 application measurements 6A–6E (startup, real main-thread/IPC, rendered Files
  search, application memory/lifecycle, real-Electron host replacement) — **NOT
  MEASURED** in this audit line.
* Fresh packaged smoke — **NOT RUN**.
* Installer acceptance in an isolated VM — **NOT RUN**; no isolated VM is available.
* Live SSH acceptance — **NOT RUN**; no live SSH host is configured.
* macOS packaging/acceptance — **NOT RUN** in this Windows environment.
* `publish.yml` dispatch / actual release promotion — **NOT RUN**; no publication was
  authorized.

The previously accepted results remain unchanged:

* Phase 6 C1 host-function baseline is **CLOSED**.
* C2 S1 attribution remains `LIMITATION_PROFILER_OVERHEAD`; the retained category shape is
  evidence only and is not an optimization recommendation.
* Phase 7's source-level action pinning and release-asset validation are implemented and
  locally verified; actual promotion remains NOT RUN.
* The Phase 8 candidate-freeze and no-commit smoke infrastructure work completed, but the
  planned current-source build, source smoke, packaged smoke and downstream integration
  gates did not complete.

Accordingly this audit/repair plan is **CLOSED WITH RESIDUAL WORK** at the user's
direction. The unexecuted gates above must remain visible as NOT RUN / NOT MEASURED rather
than being inherited from historical runs or converted into PASS. Any future work on
those items should start as a new scoped task against the then-current product tree and
must not treat this closeout as release certification.

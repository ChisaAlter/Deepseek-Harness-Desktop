# Decision: Preview permissions are scoped to session, origin, and frame

Status: proposed

[中文](2026-09-19-preview-permission-origin-scope.md) | English

## Problem

`configurePreviewSession`'s handlers used to look only at the permission name: the request
handler does `callback(ALLOWED_PREVIEW_PERMISSIONS.has(permission))` and the check handler
matches, both ignoring `webContents`, the requesting origin, and the frame. The preview
panel may open any http(s) document, so a main frame on `https://evil.example` receives
`clipboard-read`, an iframe from that same site receives `geolocation`, and
`notifications` behaves the same way. The audit probe reproduced successful grants from
both a main frame and a cross-site iframe. That is a least-privilege defect: an external
page gets an application-level grant instead of one scoped to its own origin.

## Proposal

The audit repair first adopts **deny-by-default**: `ALLOWED_PREVIEW_PERMISSIONS` becomes
empty, no consent UI is introduced, and the four legacy grants plus every unknown
permission are denied. The retained authorization seam
`isPreviewPermissionAllowed(ses, webContents, permission, origin, details)` must still
fail closed: `webContents` must explicitly belong to this session, must not be destroyed,
both the top-level and requesting origins must be parseable http(s), the requesting frame
origin must be loopback (`localhost` / `127.0.0.1` / `0.0.0.0` / `::1`, with IPv6
literals normalized from `URL#hostname`'s bracketed form), and a subframe must be
same-origin with the document that embeds it; missing owner/origin information, opaque
origins, and unparseable input must never fall back to the parent origin. If a grant is
restored later, the name allow-list is only a necessary condition and cannot bypass those
bindings.

## Alternatives considered

- **Deny every permission request outright** — accepted as the hotfix: no broad consent
  UI lands first; if a local development workflow later proves it needs a capability,
  that grant should be restored with origin/frame binding.
- **Trust only the main frame and never allow iframes** — rejected: same-origin local dev
  pages commonly embed editors or canvases in iframes; allowing same-origin keeps the
  capability while staying safe.
- **Add a page-level allow-list with a UI hint only** — rejected: the grant happens in
  the main-process permission handler, so a UI hint cannot replace that decision and
  cannot stop an iframe's request.

## Acceptance criteria

`node --test src/main/preview-session.test.js` is green: the four legacy grants,
`clipboard-write`, `local-fonts`, `media`, and unknown permissions are denied by default;
public origins, cross-site frames, foreign-session or ownerless `webContents`, destroyed
contents, and opaque/unparseable origins are always denied. When an allow-list entry is
explicitly supplied in tests, loopback main-frame and same-origin loopback-frame positive
bindings are still checked and mismatched owners/origins remain denied. Real-page and
OS-level behavior are outside this round's assertions.

## Risks

Denying all permissions makes clipboard-read, geolocation, and notifications unavailable
to preview pages; that is the deliberate trade-off for this hotfix. If review shows that
ordinary copy/paste or a local development workflow is damaged, add an origin/frame-bound
grant under a separate decision rather than restoring name-only grants. The decision relies
on `webContents.getURL()` and Electron's `requestingUrl`/`isMainFrame`: if upstream changes
those field semantics, decisions collapse to denial (fail-safe) and the tests must be
updated together.

## Addendum: host-generation teardown (2026-09-20)

The same hardening round added host-generation tracking to `registerPreviewIpc`, and review
found a deterministic race in it: on replacement, `reapHost()` queued the teardown into a
microtask, and the same `shell:preview-open` handler created the new preview afterwards. The
queued **global** `live.closeAll()` therefore destroyed the successor's preview instead of
only the previous host's resources, while still returning success to the new host.

The corrected invariants:

- Teardown is scoped to a **generation**. The leaving host closes only the preview ids and
  shared singletons it registered itself; resources created by the successor are never
  touched by the previous generation's cleanup.
- Ownership of a shared singleton (floating file window, `workspace-preview` server, PiP) is
  registered **synchronously** when the host issues the request. A claim registered after
  the handler's first `await` arrives too late: the previous generation's queued teardown
  runs first and closes it (`preview-workspace.js`'s `close()` resets the port to 0, leaving
  the victim with a dead URL).
- A later host that takes over the same singleton assumes ownership; the previous
  generation's teardown closes it only while ownership is unchanged.
- An individual cleanup failure is reported, never silently treated as a successful
  cleanup, and it must not prevent the other resources from converging.

Residual limitation: cleanup and takeover are still not atomic. The invariant depends on
every shared resource being registered synchronously in the handler that owns it; a new
singleton that can outlive a host must be registered the same way or this defect class
returns.

## Addendum: implicit singleton dependencies and cleanup ordering (2026-09-20, iteration 9)

The generation-scoped teardown above had two real defects. Both were reproduced by review and
confirmed in code:

1. **An implicit dependency was never registered.** The `shell:preview-open-file-window` handler
   claimed only `file-preview-window`, but `createFilePreviewWindowController(...).open()`
   internally calls `workspacePreview.fileUrl(input)`
   (`src/main/preview-file-window.js:139-142`), so the floating file window **depends on** the
   `workspace-preview` server. Two consequences: host B merely opening the floating window could
   replace a server host A still owned, and conversely a host that started from the floating
   window entry point left an **ownerless** server behind that no generation's teardown would ever
   reclaim. Fix: that handler now also claims `ownSingleton('workspace-preview', generation)`
   synchronously when the request is issued.
2. **The queued cleanup lost its ownership check.** `teardownOwnedResources` read `singletonOwner`
   and then queued the close, deleting the ownership record BEFORE the close actually ran. If a
   successor claimed the same singleton in that window, the previous generation's queued close
   still closed it. Fix: each singleton close is wrapped in `closeIfStillOwned(close)`, which
   re-validates `singletonOwner.get(name) !== generation` synchronously immediately before the
   close and only then deletes the claim.

The same round unified failure observability: every close path shares `reportTeardownFailure`,
`Promise.allSettled` rejections are no longer discarded, and stale-result close failures are
reported through the same path instead of being swallowed by an empty `.catch(() => {})`.

**Checkable criteria (regression tests):** the floating-window entry point must leave a remote host
with a live port serving the expected content; a host that used only the floating-window entry
point must leave no ownerless server after teardown; with a controlled suspension between
selecting a resource for cleanup and actually closing it, a successor that claims first must keep
its resource; and an injected close failure must be observable through `onTeardownError` without
blocking the other cleanups.

## Addendum: acceptance predicate and failure diagnostics (2026-09-20, iteration 9)

The real-Electron permission runner's **acceptance predicate** had a hole: the positive control was
judged by "not `denied`", so a `timeout` (a probe that never resolved) counted as "observed the
grant". In a controlled comparison that forced every probe to time out, the old predicate reported
`positiveControlObserved=true` while the new one reports `false`.

The corrected criterion is an **exact per-frame state**: precisely
`main.query_geolocation=granted`, `same.query_geolocation=granted`,
`cross.query_geolocation=denied`, and every other required probe in every frame exactly `denied`.
`missing`, `unsupported`, `timeout`, and `threw:` fail in **both** modes, so the default-deny run
can no longer pass vacuously.

On failure the runner retries nothing and loosens no assertion; instead it emits the **full
report** (`checks`, `handlerDecisions`, `permissionChecks`, `browserOutcomes`,
`positiveControlObserved`), the failed check names and details, per-stage timings, and runtime
identity, so the next occurrence is diagnosable from the artifact alone. Earlier notes called this
a "load-sensitive harness flake"; that was an inference rather than a measurement, and it is now
recorded as an **intermittent acceptance failure whose cause is not confirmed**.

**Independent cleanup boundary:** on a standalone run (no `DSHD_PREVIEW_PROFILE_ROOT` supplied) the
profile root used to be removed by the Electron process from a `process.once('exit')` hook. That
hook fires while Chromium still holds the profile's file handles, so removal could fail, and the
failure was swallowed silently, leaving leaked directories with no record of their paths. Fix: the
Electron process now only creates the root and hands its path and its own pid to a `detached`
plain-Node cleanup supervisor (`scripts/preview-profile-cleanup.cjs`); the supervisor waits for the
owning process to genuinely exit, then removes **exactly that one** directory, and when the exit
status is uncertain or removal cannot be confirmed it **retains the directory and reports its path
on stderr**. A caller-provided root always belongs to the caller and is never removed by either
file. (Putting the supervisor inside the Electron entry point was measured and rejected: an
Electron parent synchronously waiting on an Electron child deadlocks.)

## Addendum: cleanup supervisor failure contract (2026-09-20, iteration 11)

The previous supervisor only moved deletion out of Electron; **its failures remained
unobservable**, and further safety judgements did not hold:

1. **Failure output was discarded.** The launcher spawned the helper with `stdio: 'ignore'` and
   immediately `unref()`ed it, so the timeout and removal-failure stderr had no receiver. The
   direct helper tests could see those messages; the real wiring could not.
2. **Asynchronous start failures had no outlet.** The launcher had only a synchronous `try/catch`
   and no `'error'` listener, so a spawn failure delivered as an event was never handled.
3. **A probe error counted as "dead".** `isAlive()` returned `false` for every exception except
   `EPERM`, so **any unexpected probe error was treated as confirmed process exit** and authorized
   deletion.
4. **Inputs were unvalidated.** The helper checked only that the root was non-empty and the pid was
   an integer; it did not enforce its documented absolute-root contract, positive pid, finite
   deadline, or ownership handoff.

The corrected contract:

- **Tri-state probe**: `process.kill(pid, 0)` returns `alive`; `EPERM` returns `alive`; `ESRCH`
  returns `dead`; anything else returns `unknown`. **Only `dead` may advance to removal**;
  `unknown` retains immediately, and a deadline overrun retains too.
- **Ownership handoff**: before the supervisor starts, the launcher writes
  `<root>/.dshd-cleanup-owner.json` (`version/token/ownerPid/createdAt/profileRoot`) and passes the
  same token as `argv[7]`; the helper requires a sane marker and token equality before deleting.
  A missing or mismatched marker always retains.
- **Durable receipt**: the helper writes an atomically updated JSON receipt **outside the profile
  root**, `{version, state: pending|removed|retained, reason, profileRoot, ownerPid, updatedAt, detail}`.
  The launcher writes `pending` first, and the helper records a terminal state before every exit
  (argument-validation failure, ownership mismatch, unknown probe, timeout, removal failure, and
  already-absent). A start failure is recorded synchronously by the launcher as `retained` /
  `supervisor-start-failed`.
- **Rejected inputs**: a non-absolute root; a root equal to a filesystem root or the OS temp dir
  itself; a non-positive pid; a non-finite or non-positive deadline; a receipt path that is
  missing, non-absolute, or inside the root; and a missing token all retain and exit non-zero.
- **Report boundary**: both success and failure runner reports carry
  `profileCleanup: {state: pending|not-owned|retained, receiptPath, profileRoot, ownerPid}`. A
  standalone run reports `pending`, so **permission-test success does not mean cleanup finished**;
  a caller-provided root is always `not-owned` and is never removed by either file.

**Discriminating criteria** (real subprocess regressions, not source-regex assertions): after the
owner genuinely exits the receipt becomes `removed` and the directory is gone; a live owner past
the deadline yields `retained`/`owner-timeout`; a probe error yields `retained`/`owner-probe-unknown`;
invalid input and ownership mismatch retain while an adjacent unowned sentinel directory stays
unchanged; a removal failure yields `retained`/`removal-failed`; a start failure yields
`retained`/`supervisor-start-failed`; and a caller-owned root is never deleted.

The same iteration closed the last silent path in stale-preview cleanup. The stale
`shell:preview-open` result branch used `void Promise.resolve(live.close(result.id)).catch(() => {})`,
which swallowed a failed close, and a synchronous throw escaped before `Promise.resolve` could
wrap it. It now awaits `Promise.resolve().then(() => live.close(id)).catch(reportTeardownFailure)`,
so both a rejection and a synchronous throw reach the common reporter; the stale caller still
rejects with `ERR_DSH_IPC_SENDER`, and the accepted generation-scoped teardown and singleton
ownership logic is unchanged.

## Addendum: receipt publication and observation contract (2026-09-20, iteration 12)

The receipt mechanism above still had two ways to **destroy its own evidence** or **misjudge
completion**:

1. **A failed replacement deleted the last readable receipt.** The launcher and the helper each
   implemented a writer that, on `EEXIST`/`EPERM` during rename, unlinked the destination and
   retried. If the second rename failed, the previous `pending` receipt was already gone, and an
   interval existed with no receipt at all — the opposite of "atomic replacement", precisely when
   publishing the terminal state failed.
2. **The observer only waited for the file to exist.** The standalone test first waited for the
   profile directory to disappear and then only waited until the receipt file appeared; but the
   launcher writes `pending` *before* starting the supervisor, so that second wait never waited
   for terminal publication. The helper also removes the root *before* writing its terminal
   receipt, so a valid run could produce: root disappears → test reads `pending` → test fails →
   helper publishes `removed`.

The corrected contract:

- **Shared writer `scripts/lib/receipt-file.cjs`**: launcher and helper now use the same
  `writeReceiptAtomic`, removing the drift between two implementations. It **never unlinks the
  destination**: it writes a complete temp file in the same directory and renames in place with a
  bounded retry. When the retries are exhausted it **throws**, so the caller reports a publication
  failure instead of claiming the receipt was written, and the destination stays byte-for-byte
  unchanged. The test hook `DSHD_RECEIPT_FORCE_REPLACE_FAILURE` makes a replacement failure
  deterministic.
- **The observer waits for a terminal state**: the `waitForTerminalReceipt` test helper polls the
  *parsed* receipt until the state is `removed`/`retained` **and** `profileRoot`/`ownerPid` match
  this run, or a bounded deadline expires; missing, unparseable, and still-pending observations
  stay distinguishable in the diagnostics. Root disappearance is no longer accepted as proof of
  publication, and the ordering issue is **not** hidden by rerunning the whole acceptance.
- **Failure fixtures use known process identities**: the removal-failure fixture no longer uses an
  assumed-dead pid; it uses a child whose exit was actually observed, so an unrelated live process
  cannot divert the run into `owner-timeout`.

**What `pending` precisely means**: the helper does not distinguish a graceful exit from a forced
one — a surviving supervisor proceeds normally once its probe returns `ESRCH`. `pending` therefore
means only that **cleanup completion is unconfirmed**. It neither guarantees that the profile still
exists nor by itself explains why the terminal receipt is absent.

**Discriminating criteria**: after injecting a replacement failure, the previous `pending` receipt
is byte-for-byte unchanged, an adjacent unowned file is untouched, the directory is retained, and
the failure is reported (non-zero exit); in the ordered "remove, then delay publication" test the
observer succeeds only after the terminal state arrives, and a terminal result that never arrives
fails within its own bounded deadline while preserving the last observed state.

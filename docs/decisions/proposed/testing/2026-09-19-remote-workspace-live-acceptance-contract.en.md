# Decision: Non-run contract for the remote-workspace live acceptance script

Status: proposed

[中文](2026-09-19-remote-workspace-live-acceptance-contract.md) | English

## Problem

`scripts/verify-remote-workspace-live.cjs` is the opt-in real-machine acceptance gate for `remote-workspace`, but it currently treats three **non-run** states as acceptance success: the readiness probe checks only object truthiness instead of `ok` and cookie; the probe cookie is discarded and the one-shot launch token is redeemed again; and missing SSH config prints SKIP with exit 0.

This lets "not run", "half run", and "probe failed" all land in a green conclusion, weakening the trust boundary between manual acceptance and automated reporting. The same script also carried a call sequence that disagreed with the product routes: `/home`, `/current`, `/machines`, `/mirror`, and `/fs` accept only POST, yet the runner defaulted to GET and looked only at status codes; it created `dirName` but handed a different `mirrorName` to a `/mirror` that requires the target directory to already exist; and teardown cleared the active machine **before** cleaning the remote fixture, so the following `/fs` removal could never succeed. Failure-only fixtures could not expose any of this.

The same guard code also carried a runtime-dependent false pass: `deadlineSignal()` used to call `timer.unref?.()`. When the deadline timer was the only referenced handle in the event loop, Node 22 drained the loop before the deadline fired, `node:test` cancelled the still-pending test, and the cancellation cascaded into 18 cancelled tests; the same code does not reproduce on Node 26, which keeps the harness alive differently. Whether the deadline could still settle therefore depended on the runtime version rather than on the contract — which is exactly why this regression has to be deterministic and runtime-independent.

## Proposal

Tighten the script's acceptance contract to three observable rules:

1. Readiness enters acceptance only when `ok === true` and the cookie is non-empty; otherwise it takes the failure path.
2. Each run redeems the one-shot launch token at most once; later requests reuse the same cookie returned by readiness.
3. Add `--require-live`: missing required SSH config exits non-zero; without that flag the soft skip remains, but the output explicitly says `NOT RUN (not PASS)`.
4. The acceptance runner must be import-safe and perform every write, mirror, and removal under a run-owned fixture root; requests, response bodies, and the whole run need bounded deadlines; spawn failure, early child exit, cleanup failure, and the original failure are reported separately. The port must not be fixed, and the temporary HOME is removed only after the owned child is stopped and awaited.
5. The runner calls routes on the real product contract: the method comes from an explicit route-to-method table (mutating routes are always POST; the product routes are never bent to suit the script); the mirror target is the directory this run created itself, paired with a negative case proving a missing directory is refused; and teardown order is fixed at remote fixture cleanup → deselect/delete machine → stop child → remove the local HOME, with no remote writes after the deselect.
6. The three mutating cleanup operations (remote fixture removal, machine deselection, machine deletion) must validate the **expected success response body**, not just `status === 200`. HTTP 200 with `ok:false`, missing JSON, or malformed JSON must all count as cleanup failures; the `remote-fixture-cleanup` / `machine-deselect` / `machine-delete` ledger entries and any "removed" message may only be recorded after that semantic check passes. Treating 200 alone as success lets a failed cleanup be recorded in the success ledger.
7. The test fixture's expected route-to-method table must be **independent of the runner's exported `API_METHODS`**, and unknown routes must be rejected outright: if the oracle and the implementation share one table, a single wrong entry changes both the behaviour and the judgement together and the test cannot detect it. An independent negative case must pin that invariant (GET `/dsh-remote/home` must be rejected).
8. The success path itself needs fixture coverage: assert `result.ok === true`, that every request used the method its route documents, that the fixture directory was removed, and that the teardown order and HOME removal happened; when `stopChild` fails, keep the HOME and report its location instead of deleting a directory a possibly-live child still owns. The primary failure and the cleanup failure must be reported separately.
9. The guard's deadline timer must stay **referenced**: `deadlineSignal()` no longer calls `timer.unref?.()`, and the source carries a comment there explaining why that handle must not be unreferenced; `withDeadline()`'s `finally` still clears it, so it cannot outlive the operation it guards.
10. Add a deterministic regression (`deadlineSignal keeps the event loop alive with no other referenced handle`): a subprocess with **no other referenced handle** creates only `deadlineSignal(undefined, 25)` plus an abort listener, and that listener prints a JSON completion marker; the parent asserts exit code 0, a non-empty marker, `name === 'TimeoutError'`, and `elapsed >= 20`, with a parent-side watchdog that fails the test if the child never settles.

Also extract config resolution and the readiness assertion into a dependency-free guard seam so `node:test` can cover single redemption, `ok:false`, the config matrix, and both skip semantics; runner-level tests cover subprocess exit codes, port allocation, stalls, early exit, and cleanup. Real SSH remains opt-in.

## Alternatives considered

- **Keep checking readiness with object truthiness** — rejected: `{ ok: false, cookie: '' }` is a failure, not a success; truthiness silently lets a failed probe through.
- **Redeem the token again after readiness** — rejected: the launch token is one-shot, so a second redemption can fail and violates the one-redemption-per-run semantics.
- **Always exit non-zero when config is absent** — rejected: that breaks the existing opt-in local run workflow; an explicit `--require-live` cleanly separates soft skip from a required gate.
- **Put the real SSH end-to-end path in the default test suite** — rejected: the live script depends on an external machine and credentials and must stay opt-in; this change fixes only non-run semantics and the unit-testable seam.
- **Keep `timer.unref?.()` and pin a Node version to avoid the defect** — rejected: Node 22 drains the event loop before the deadline and cancels the pending test, while Node 26 falsely passes because it keeps the harness alive differently; betting correctness on the runtime version is not a contract.
- **Assert only from the parent with a watchdog, without a real child process** — rejected: the parent holds event-loop handles of its own, so it cannot reproduce the premise that the deadline is the only referenced handle; only a child process can put that premise under test.

## Acceptance criteria

1. `node --test scripts/remote-workspace-live-guard.test.mjs scripts/verify-remote-workspace-live.test.mjs` is green at **29/29 on both Node 22.22.2 and Node 26.7.0** (9 guard + 20 runner, one more deadline regression than the previous round), and covers the config present/absent matrix, `--require-live`, `ok:false`/empty cookie, the single-token-redemption fixture, runner exit codes, occupied-port handling, stalled request/body, early child failure, run-level abort propagation through startup (real chain, with the probe's internal timeout far longer than the cancellation trigger), concurrent fixture isolation, cleanup failure, the HTTP 200 + `ok:false` / missing-JSON / malformed-JSON negatives for all three cleanup operations, the **full success path** (method assertions plus teardown order), the independent fixture route table rejecting GET `/dsh-remote/home`, `assertInsideRoot` rejecting traversal and non-absolute forms, the deadline firing and keeping the event loop alive with no other referenced handle, and HOME preservation on `stopChild` failure.
2. With SSH config absent and no `--require-live`, the script exits 0 and prints a note containing `NOT RUN (not PASS)`; with `--require-live` it exits 2.
3. Readiness failure, backend exception, premature child exit, and normal completion all still stop the child and remove the temporary HOME (unless the child is confirmed not to have stopped); remote cleanup stays inside the run-owned fixture and happens before the deselect; cleanup failure is reported separately from the original failure.
4. The feature card's Gates row states that the script is opt-in; a round that does not execute the real SSH path must not be recorded as PASS.
5. Test fixtures must isolate themselves: each case gets its own `mkdtemp` HOME and cleans it up promptly, never reusing a fixed path that writes into the real user profile; a completed round must leave no new residue in temp directories outside the workspace.
6. The deadline regression must really run in a subprocess with **no other referenced handle**, and must be sensitive to the defect: restoring `timer.unref?.()` makes the case fail with `child produced no completion marker; the deadline never kept the loop alive` (mutation-verified). That result pins only the guard library's own deadline contract and makes no claim to have proved product process-lifetime behaviour.

## Risks

- The soft skip still exits 0; a caller that omits `--require-live` can distinguish it only via the `NOT RUN (not PASS)` text, not via the exit code alone.
- This round does not run real SSH, so the new guard/CLI semantics are verified while the health of the remote-driver path is not reconfirmed.
- If the readiness cookie contract later changes to an empty string or is renamed, the guard treats it as failure and the seam and tests must be updated with it.
- Cleanup is now judged semantically, but the **non-cleanup assertions** (for example `fixture.mkdir`, `write`, `mirror`) still combine a status check with `ok === true`; if the plugin adopts another success encoding, those call sites must be tightened with it.
- The semantic cleanup check only meets real product responses during a live run; this round does not run real SSH, so that branch remains pending validation.
- The runner's `API_METHODS` and the fixture's `PRODUCT_ROUTE_METHODS` are now two independently maintained tables, so a product route change must update both or the implementation and the oracle will diverge (partially backstopped by the independent negative case).
- Symlink escape cannot be detected without a remote round-trip; the current contract only guarantees the caller's own fixture paths stay inside the root.
- The deadline regression proves the guard library's own contract — `deadlineSignal` still keeps the event loop alive when nothing else is referenced — not the process-lifetime behaviour of the product (Electron main process, runner subprocesses, and so on); each of those still needs its own check.
- Now that the timer is referenced, a future caller that creates a deadline and forgets to `clear()` it (or bypasses `withDeadline()`) would hold the exit open; every internal use currently goes through `withDeadline()`'s `finally`.

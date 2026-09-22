# Task 4 Code-Quality Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use workflow:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the fresh Task 4 code-quality review without weakening process ownership, relay capacity, loop cancellation/deadline, or command-output compatibility contracts.

**Architecture:** Keep the existing public entry points and add only private typed seams needed for deterministic tests. Windows identity-tracked cleanup fails closed instead of falling back to raw PIDs, Linux snapshot churn distinguishes vanished records from unreadable records, relay capacity counts sockets until close acknowledgement, loop verification gates every awaited boundary, and command output retains complete encoded characters with bounded slack.

**Tech Stack:** TypeScript, Node.js child processes and buffers, Vitest, Zod-backed loop records, ws-compatible relay sockets, npm workspace scripts.

---

### Task 1: Windows ownership fail-closed behavior and launch-bound anchors

**Files:**

- Modify: `packages/server/src/utils/tree-kill.ts`
- Test: `packages/server/src/utils/tree-kill.test.ts`

- [x] **Step 1: Write Windows tracking-unverified RED tests**

Add typed `windowsOperations` tests for snapshot failure, identity-revalidation failure, and a never-settling query. Use an ownership record with `rootPid: 42` and `launchedAtMs: 1000`; collect both identity signals and `child.kill` fallback signals.

```typescript
expect(result).toBe("kill-timeout");
expect(identitySignals).toEqual([]);
expect(fallbackSignals).toEqual([]);
```

- [x] **Step 2: Run the Windows failure tests and record RED**

Run each named test with:

```powershell
npx.cmd vitest run packages/server/src/utils/tree-kill.test.ts -t "<exact test name>" --bail=1
```

Expected before the fix: immediate failures invoke `child.kill("SIGTERM")`; the never-settling query must still settle once at the injected 50 ms deadline.

- [x] **Step 3: Prevent raw fallback after Windows identity tracking becomes unverified**

Carry fallback safety on the resolved tracking implementation rather than inferring it from which option supplied the operations:

```typescript
if (trackedResult === "tracking-unverified" && !tracking.allowsUnverifiedRootFallback) {
  return "kill-timeout";
}
```

Default and injected Windows CreationDate tracking set the flag false. Generic/POSIX tracking keeps
the safe fallback true, including generic operation seams used by POSIX state-machine tests.

- [x] **Step 4: Write launch-tolerance RED tests**

Use the exact records `100@500 parent=42`, `42@1500`, and `200@1600 parent=42`, with `launchedAtMs: 1000` and `rootExited: false`. Add both pure selector and full signaling tests.

```typescript
expect(selected.map(({ pid }) => pid)).toEqual([200, 42]);
expect(signaledPids).toEqual([200, 42]);
expect(running.has(100)).toBe(true);
```

- [x] **Step 5: Restrict old-lineage proof to post-launch records**

Retain the one-second tolerance only in the broad table used to find the current root. Build old-lineage anchors from records satisfying the strict launch lower bound:

```typescript
const isLaunchOwned =
  finiteLaunchedAtMs !== undefined && process.creationTimeMs >= finiteLaunchedAtMs;
```

If no strict old anchor proves reuse, traverse the live current root tree in child-first order.

- [x] **Step 6: Run targeted GREEN**

Run the Windows failure, bounded query, pure tolerance, and full tolerance tests together. Expected: all targeted tests pass, with no raw fallback signal.

### Task 2: Linux snapshot churn classification

**Files:**

- Modify: `packages/server/src/utils/tree-kill.ts`
- Test: `packages/server/src/utils/tree-kill.test.ts`

- [x] **Step 1: Add a private typed Linux operations seam and RED tests**

Inject topology reads, `/proc` identity reads, liveness probes, and PID signals without exporting a new API. Cover:

```typescript
// PID 100 disappears after topology capture; PID 101 remains.
expect(signaledPids).toEqual([101]);
expect(result).toBe("terminated");
```

Also cover a present PID whose stat read throws `EACCES`, and a present PID whose record disagrees with topology. Both must return `kill-timeout` without identity signals.

- [x] **Step 2: Run the Linux tests and record RED**

Expected before the fix: a vanished PID causes the whole snapshot to become unverified, so the surviving descendant is not signaled through tracked ownership.

- [x] **Step 3: Skip only genuinely absent records**

Treat `readProcess(pid) === null` as normal churn and continue. Preserve fail-closed behavior for thrown read errors, malformed records, and topology mismatches.

```typescript
if (process === null) {
  continue;
}
if (process.parentPid !== expected.parentPid || process.processGroupId !== expected.processGroupId) {
  throw new Error(...);
}
```

- [x] **Step 4: Run targeted GREEN**

Expected: vanished PID is skipped and the survivor is signaled; unreadable/inconsistent records remain `kill-timeout` with zero unsafe signals.

### Task 3: Relay closing sockets remain capacity-counted

**Files:**

- Modify: `packages/server/src/server/relay-transport.ts`
- Test: `packages/server/src/server/relay-transport.test.ts`

- [x] **Step 1: Add an asynchronous-close fake and RED test**

Extend the typed fake with a mode where `close()` changes ready state to closing but emits no close event until `acknowledgeClose()` is called. Saturate 256 IDs, disconnect one, then attempt a replacement.

```typescript
expect(getDataConnectionIds(relay)).not.toContain("replacement");
closingSocket.acknowledgeClose();
control.message(JSON.stringify({ type: "connected", connectionId: "replacement" }));
expect(getDataConnectionIds(relay).at(-1)).toBe("replacement");
```

Assert one capacity warning per saturation cycle and no duplicate socket for the same closing ID.

- [x] **Step 2: Run the relay RED**

Expected before the fix: the map entry is deleted immediately, so replacement is created before close acknowledgement.

- [x] **Step 3: Delete socket entries only from their real close handler**

On `disconnected`, call `close()` but keep the socket in `dataSockets`. The existing identity-checked close handler removes it, resets capacity warnings only after size drops below 256, and allows later slot reuse.

- [x] **Step 4: Run targeted GREEN**

Expected: the closing socket counts toward 256 until acknowledgement; replacement is refused before and accepted after the close event.

### Task 4: Loop post-await gates and fatal cleanup errors

**Files:**

- Modify: `packages/server/src/server/loop-service.ts`
- Test: `packages/server/src/server/loop-service.test.ts`

- [x] **Step 1: Add a private persistence writer seam**

Allow tests to inject a typed writer while production continues to use `writeFileAtomic`:

```typescript
persistLoopState?: (storePath: string, value: string) => Promise<void>;
```

- [x] **Step 2: Write stop-during-final-persist RED**

Return a passing verify-command result, block the persistence containing that result, call `stopLoop`, release the writer, and assert canonical stopped state with no success log.

- [x] **Step 3: Write verifier cancellation and late-result RED tests**

Use the scripted provider seam to stop while verifier execution is pending. Cover an ordinary provider cancellation error and a late passing JSON result. Both must end stopped with no verifier success.

- [x] **Step 4: Write deadline-after-result RED tests**

Advance the fake Date after a verify command or verifier returns but before transition. Assert `Reached max time (<ms>ms).`, one failed iteration, and no sleep/retry.

- [x] **Step 5: Write ExecCommandKillTimeoutError RED**

Reject the injected command runner with the exact exported error and assert one fatal failed iteration, no verify result, no sleep/retry, and logger context retaining the same error object and metadata.

- [x] **Step 6: Add canonical post-await gates**

Move stop abortion before queued persistence and call a shared guard after every awaited verification boundary and immediately before success:

```typescript
if (signal.aborted) throw new Error("Loop aborted");
if (deadline !== null && deadline - Date.now() <= 0) {
  throw new Error(`Reached max time (${loop.maxTimeMs}ms).`);
}
```

When an awaited verifier operation throws while aborted, rethrow `Loop aborted` with the provider error as cause. Preserve `workerCompletedAt` with nullish assignment.

- [x] **Step 7: Keep cleanup timeout fatal**

Import and rethrow `ExecCommandKillTimeoutError` from `runVerifyCheck`; ordinary numeric exit errors remain failed verification results.

- [x] **Step 8: Run targeted GREEN**

Run only the new stop/deadline/verifier/kill-timeout tests. Expected: canonical stopped/max-time/fatal states, no success, no retry, and retained metadata.

### Task 5: Encoding-safe bounded command output

**Files:**

- Modify: `packages/server/src/utils/spawn.ts`
- Test: `packages/server/src/utils/spawn.test.ts`

- [x] **Step 1: Characterize active PATH Node**

Run active `node`/`execFile` behavior for UTF-8 `éé` at `maxBuffer: 3` and UTF-16LE output crossing a code-unit/surrogate boundary. Record error code, message, and decoded stdout/stderr.

- [x] **Step 2: Add UTF-8 and UTF-16 RED tests**

Use real short-lived Node children. Assert `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, command metadata, and valid decoded output with no replacement character or dangling surrogate.

- [x] **Step 3: Preserve complete characters with bounded slack**

Pass encoding into `BoundedOutputBuffer`. Retain at most the configured bytes plus a small encoding-specific suffix sufficient to complete one code point/code unit, never the full arbitrary input chunk. Decode only the complete prefix.

- [x] **Step 4: Run targeted GREEN and compatibility gates**

Run the new multibyte tests plus existing zero/fractional/Infinity and independent stdout/stderr maxBuffer tests.

### Task 6: Roadmap, report, verification, and delivery

**Files:**

- Modify: `docs/refactors/comprehensive-improvement-roadmap.md`
- Modify local report: `.workflow/sdd/task-4-report.md`
- Generate local review diff: `.workflow/sdd/review-3decd3a59..<HEAD>.diff`

- [x] **Step 1: Add a pending architecture item**

Track extraction of Windows ownership/querying, POSIX tracking, and cleanup-deadline orchestration behind `terminateWithTreeKill`, without performing that risky extraction in this round.

- [x] **Step 2: Run fresh affected verification**

```powershell
npx.cmd vitest run packages/server/src/utils/tree-kill.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/relay-transport.test.ts --bail=1
npx.cmd vitest run packages/server/src/server/loop-service.test.ts --bail=1
npx.cmd vitest run packages/server/src/utils/spawn.test.ts --bail=1
npm.cmd run lint -- <changed source and test paths>
npm.cmd run typecheck --workspace=@chisacode/server
git diff --check
```

Run `npm.cmd run test:audit` only if test routing or audit patterns changed.

- [x] **Step 3: Update the Task 4 report**

Append exact RED failures, GREEN counts, changed files, compatibility concerns, and residual stable-handle/architecture risks.

- [x] **Step 4: Commit and regenerate the review diff**

Stage only Task 4 tracked files, commit once, then generate the cumulative binary diff from `3decd3a59` to the new HEAD.

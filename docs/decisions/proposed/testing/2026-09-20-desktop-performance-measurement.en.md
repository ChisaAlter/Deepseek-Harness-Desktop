# Decision: Desktop hot-path performance proceeds from a measure-first C1 baseline

Status: proposed

[中文](2026-09-20-desktop-performance-measurement.md) | English

## Problem

The audit-repair plan defines Phase 6 as "measure startup, main-thread blocking, IPC,
memory, session scanning, Files search and packaging, then optimize only measured hot
spots". The project previously had no performance measurement script and no predeclared
thresholds, so "what is slow" could only be guessed by reading code. Optimizing directly
would bake an unverified assumption into production code and leave no way to show that the
change was not a regression.

## Proposal

Introduce a **measurement-only** C1 slice that measures three main-process functions in
**isolated Node processes**:

| Case | Production path | What the result does establish | What the result does not establish |
| --- | --- | --- | --- |
| P1 / P2 | `probeImportHold` (`src/main/data-import.js`), the launcher gate | The probe's own cost | Whole-application startup, launcher paint, Harness readiness, packaged startup |
| S1 / S2 | `scanImport` (import page only), which enumerates sessions and reads every log's display metadata | The scan function's own cost | Electron IPC round-trip, Harness's own session list, compressed logs |
| F1 / F2 | `listDir` (`src/main/workspace-fs.js`), including authority checks, directory enumeration, one batched `git check-ignore`, and sorting | The listing function's own cost | End-to-end Files search or renderer responsiveness |

Measurement protocol (predeclared, not adjusted afterwards):

- Two **sequential** batches, one fresh process per case per batch; batch two reverses case
  order to expose ordering/cache effects. No concurrent full test suites, builds, or
  deliberate load during measurement.
- Each process records module-load time separately, the **actual first invocation** of the
  production function (timed; its correctness is judged afterwards against the fixture
  digest outside the window — no untimed control call may run before it, or "first
  invocation" would be a misnomer), two untimed warm-ups and ten timed invocations. The
  timed window wraps only the production call; fixture generation, digesting, assertion,
  memory sampling and serialization are outside it. The first memory endpoint is taken
  immediately after the call returns, before any projection/digest/assertion allocation, so
  harness allocations cannot be mistaken for the production call's growth.
- Metrics: monotonic duration; `process.cpuUsage()` user/system deltas (microseconds
  converted once to milliseconds and never combined with other units); event-loop
  obstruction from a 10 ms heartbeat re-armed relative to each actual firing, where `arm()`
  must cancel and re-arm the timer **and** its expectation deadline together after the
  warm-up sleep; and memory taken as the **median per-invocation post-yield growth**: one
  endpoint observation per timed invocation, a declared 100 ms yield, then a second
  endpoint, with all ten observations published and the growth series **re-derived from
  those endpoints**. A redundant summary series that contradicts the endpoints is invalid
  data.
- Every series publishes all samples, median, minimum, maximum and MAD; these small batches
  do not claim p95/p99.
- Decision thresholds (**investigation** thresholds, not user-facing SLOs): P1/P2 median
  over 25 ms; S1/S2 over 250 ms; F1 over 100 ms; F2 over 250 ms; the per-batch **median of
  the ten per-invocation window maxima** over 50 ms and at least 30 ms above a matched
  no-work control measured with the **same per-window maximum** statistic; post-yield RSS
  growth median over 64 MiB or heap growth median over 32 MiB.
- The repeatability gate applies only to the metric that would trigger the recommendation:
  a latency finding is judged on the per-batch medians and MAD, a blocking finding on the
  per-batch **median of window maxima** and the MAD around that median; the two aggregation
  levels are never mixed, and the batch maximum of those maxima is diagnostic only. Jitter
  in a series that never breaches must not manufacture an `INCONCLUSIVE`. Memory keeps the
  preregistered both-batch rule with no extra MAD gate — endpoint observations are
  GC-timing dependent and a stricter gate would turn timing noise into a finding. A no-work
  control maximum above 20 ms marks the timing environment contaminated; a missing or
  non-finite control maximum invalidates the case.
- **Invalid measurements must not be able to produce an accepted recommendation.** A
  nonzero worker exit code (even with a success-shaped payload), schema/case/digest
  mismatch, missing or non-finite samples, missing or undetected calibration, missing or
  changed input hashes (including the resolved local production dependencies the worker
  actually loaded), and fixture manifest or content-digest drift each suppress candidate
  selection and force `INCONCLUSIVE`, with `CORRECTNESS_FAILURE` taking precedence. This
  applies to a negative conclusion too: two hash maps that are equal only because the same
  key is `null` on both sides are still missing input. Every statistic the decision uses is
  recomputed from the published raw samples and endpoints rather than trusted from the
  worker's own summary. Every calibration is retained per worker, and a later success never
  hides an earlier missing or failed one.
- The disposition vocabulary is fixed to `NO_OPTIMIZATION_JUSTIFIED` /
  `PROFILE_ONE_HOT_PATH` / `INCONCLUSIVE` / `CORRECTNESS_FAILURE`; a memory case is marked
  with `profileFocus: memory` and only triggers profiling rather than a separate
  disposition. Even `PROFILE_ONE_HOT_PATH` does not authorize a production patch; a later
  optimization must preregister its own thresholds such as "at least 20% and 10 ms latency
  reduction".
- A one-batch memory excursion (`memoryUnstable: true`) is recorded as noise, not as a
  finding; memory endpoints are themselves subject to GC timing and are not leak evidence.
- Run bounding and provenance: the measurement deadline starts **after** fixture
  preparation and passes the remaining budget to each worker; each worker's own process
  termination is observed before the next case starts, and if termination cannot be
  confirmed the run stops, keeps the fixtures and records an unresolved-process result (no
  new cleanup subsystem). The report records the worker actually launched and its hash,
  every resolved production dependency the worker reported, the fixture
  inventory/manifest digest before and after, and the Git-ignore preflight result with its
  isolated configuration. Fixtures must live in a location this run owns:
  `prepareFixture()` refuses an existing directory instead of deleting caller-supplied
  input.
- A timeout is an explicit outcome, not an ordinary failure: the parent observes the
  worker's own process termination before another case starts, stops expanding the run
  after a timeout, and records the remaining cases as invalid. Each worker's deadline is
  `min(30 s, remaining run budget)` with no 1000 ms floor that could overshoot the total.
  When the worker spawns a task-owned child it announces that child's PID on stdout
  immediately, so the parent can still name and terminate only those announced processes
  after a kill. The parent consumes those announcements into a **per-PID lifecycle
  ledger** instead of re-parsing history on each pass: only children whose current state
  is open, with a positive integer PID, are signalable; a PID announced as closed is
  history whose numeric value may already belong to an unrelated process and is never a
  kill target; repeated close announcements only increment a counter; malformed or
  truncated announcements are dropped without displacing a known-good record. The ledger
  separates an **attempted signal** from **OS-confirmed termination**: every attempt is
  recorded as `{pid, command, signaled, error}`, and termination is confirmed only after
  polling proves every owned child is gone.
- Termination confirmation has exactly one completion condition, shared by the timeout
  path and the post-exit cleanup path: **worker exit observed AND every tracked child
  either declared closed or confirmed absent**. A delivered signal, a `child.kill()`
  returning false or throwing, an empty child list, or an inconclusive probe never
  substitutes for the worker exit; a worker `close` during a timeout must not skip child
  polling or clear the grace-period observer early. Worker exit is established only by the
  spawned handle's lifecycle event, never inferred from the failure name.
- The existence probe is tri-state: only a positive liveness answer is `alive`, only a
  definitive `ESRCH` is `absent`, and every other outcome (including unexpected errors
  other than `EPERM`) is `unknown` with the error retained for diagnostics. `unknown`
  counts as unresolved alongside `alive` and is never converted into "gone".
- A child's `error` event is evidence, not an outcome: Node documents that it can mean a
  failed creation **or** a failure after the process was created (for example a `kill()`
  that could not be delivered), and an `exit`/`close` event is not guaranteed afterwards.
  Only a creation failure with no PID ever observed may finish immediately as a bounded
  `SPAWN_ERROR`; once the worker has a PID, the `error` is recorded as `{code, message}`
  (and attached to the matching kill attempt) and must not finish early, cancel the
  grace-period observer, or recurse into another `terminate()`/`kill()`. The result stays
  owned by the single completion condition — worker exit AND every tracked child resolved —
  with the timeout reason preserved separately in `requestedFailure`.
- Unconfirmed termination is fatal: while an owned child is still alive or unknown, or the
  worker exit itself was never observed, the run ends immediately as `UNRESOLVED_PROCESS`,
  keeps its fixtures, records `unresolvedChildren`, `unresolvedWorker` and
  `terminationConfirmed: false`, preserves the original reason in `requestedFailure`, and
  launches no further case. The outcome makes the execution invalid (nonzero exit) and
  cannot be masked by later successes. A worker exiting normally is not evidence that its
  children died — the parent still checks for survivors before accepting the result.
- Persisted reports keep observed termination facts instead of re-deriving them: the
  worker identity is the **spawned** PID even when a timeout produced no final payload,
  `terminated` mirrors `terminationConfirmed`, and the record also carries signal attempts
  and errors, worker-exit confirmation, the worker kill result, `unresolvedWorker` /
  `unresolvedChildren`, the original `requestedFailure`, and the child lifecycle states.
  Cleanup success must no longer be reconstructed from
  `failure !== 'UNRESOLVED_PROCESS'`.
- The duration series used for decisions must be **raw wall time**: `rawDurationMs` is
  authoritative for threshold comparisons, the repeatability gate, and every published
  median. The spawn-observer-subtracted `adjustedDurationEstimateMs` is published only as
  a separately named estimate and feeds no gate. The worker must declare
  `authoritativeDurationSeries: 'rawDurationMs'`; a payload that omits it or names another
  series is invalid (`DURATION_SERIES_MISLABELED`), so an overhead-adjusted estimate
  cannot silently become the basis of a decision. If a reviewed run only exposed the
  adjusted series to the threshold, it must be recomputed from its stored `rawDurationMs`
  as analysis only — never re-executed or rewritten on that account.
- **Execution validity** and the **analytical verdict** are independent axes: an input-gate
  failure (missing or changed input, dependency, or fixture hash; structurally invalid
  payload; unresolved process; timeout) makes the run methodologically invalid and
  therefore `ok: false` with a nonzero exit code and each specific reason preserved, while
  an `INCONCLUSIVE` result on fully valid input remains a successful measurement with exit
  code 0. The two must not be collapsed into a single test such as "the verdict is not
  `CORRECTNESS_FAILURE`".
- F cases call a production function that spawns a task-owned `git check-ignore` child; a
  parent-process API cannot observe grandchildren, so the worker installs a spawn observer
  *before* the production modules are required and records each child's PID, exit code and
  duration plus the bookkeeping time the observer adds to the caller's frame. That
  bookkeeping is published separately and subtracted into an estimated `durationMs`, while
  `rawDurationMs` remains the authoritative elapsed time; the close listener's work is not
  part of the synchronous bookkeeping accumulator, so the subtraction is an estimate
  rather than proof that instrumentation effects were eliminated.

### Checkpoint C2 - S1 attribution (2026-09-20)

C2 is also **measurement only**, and it explicitly does **not** reopen C1's acceptance.
C1 found that `scanImport` over 1,000 small sessions blocks the event loop for
~140-156 ms per call and labelled the focus `blocking`; C2 asks where that time goes. It
does not authorize a production change under any outcome.

Protocol (predeclared, and exactly the same fixture and oracle digest as C1):

- Two rounds. Each round is an **unprofiled control process** followed by a **profiled
  process**; the four processes run sequentially and never concurrently.
- Each process performs two untimed warm-ups and then ten measured scans. The in-process
  `node:inspector` session is enabled only around the ten measured scans, stopped
  *before* projection/digest/oracle/serialization work, and `disconnect()`ed in a
  `finally` block, so a failing scan cannot leave the inspector attached.
- The raw `.cpuprofile` is retained per round and its SHA256 recorded. The parent
  re-parses that file and recomputes every published share; it never trusts a worker's
  summary.
- Category shares are **self-time based** and therefore disjoint: they sum to the
  attributed total. Inclusive (nested) totals are published in a separate diagnostic
  table that must never be summed or added to the disjoint shares.
- Sampled time is charged to the nearest **named production function** on the call stack,
  so an anonymous callback or a `node:fs` frame nested under `readPlainSessionMeta`
  belongs to that production function. `gc`, `dependency` and `unclassified` are separate
  buckets; only `unclassified` (a frame outside both the measured root and this checkout
  with no named production ancestor) is reported as absence of attribution.
- The report also publishes wall duration, per-scan CPU deltas, the sample interval, the
  sample count, weighted time-delta totals, and the control-vs-profiled overhead ratio.

Decision rule (recorded before the measurement, never adjusted afterwards). No
production optimization is authorized regardless of the outcome. A **next** optimization
proposal may only be supported when the same category is at least **20% of attributed
workload time AND at least 20 ms per scan in BOTH rounds**, the correctness digest still
matches the C1 oracle, profiler overhead stays at or below **20%**, unattributed time does
not dominate (**> 50%**), and the two rounds' material rankings agree. If profiler
overhead exceeds 20%, or unattributed time dominates, or the rankings disagree materially,
the result is a **limitation** and no recommendation is made. Otherwise the standing
negative conclusion is returned verbatim: "Attribution remains inconclusive; no
optimization is justified." Execution validity is again separate from the analytical
verdict: a valid run with a negative or limitation verdict still exits 0, while a changed
input hash, a changed fixture digest, an unresolved process or a digest mismatch exits
non-zero.

Result on the working tree (source root `C:\Ai\Deepseek-Harness-Desktop`), Node 22.22.2,
both rounds valid and the S1 correctness digest matching C1's oracle exactly
(`sha256:2149b23b8b0b9032d6d1e4a82e56e00e6d9c37b7497ec84db29962b33b42b246`):

| Round | Control median (ms) | Profiled median (ms) | Overhead | Samples |
| --- | --- | --- | --- | --- |
| 1 | 155.58 | 216.45 | **+39.1%** | 3,520 |
| 2 | 146.28 | 213.12 | **+45.7%** | 3,545 |

Both rounds breach the predeclared 20% instrument-overhead ceiling, so the recorded
verdict is **`LIMITATION_PROFILER_OVERHEAD`** and no category is proposed. The category
shares are still published as evidence of *shape*, not as a recommendation:
`session-meta-read` 39.8% / 40.7% (86.33 / 89.35 ms per scan), `session-walk` 37.3% /
36.6% (81.01 / 80.33 ms per scan), `dest-existence` 19.1% / 18.5% (41.56 / 40.66 ms per
scan), `gc` 1.3% / 1.5%, unclassified 1.1% / 1.1%, everything else under 1%. A second,
separately-declared coarse configuration (1,000 µs sampling interval) was run and also
recorded `LIMITATION_PROFILER_OVERHEAD` with a larger overhead (+61.6% / +67.9%), so
coarsening the instrument did not make the gate reachable on this machine; that run is
reported as a limitation too, not as a second chance at a favorable verdict.

Evidence: `C:\Ai\_dshd-validation\c2c_6678-C2-1A-r1\{report.json,summary.md}` (250 µs) and
`C:\Ai\_dshd-validation\c2c_6678-C2-1A-r1-coarse\{report.json,summary.md}` (1,000 µs), each
retaining its raw `.cpuprofile` files. Harness: `scripts/profile-import-scan.mjs`,
`scripts/lib/import-scan-profile-worker.cjs`, `scripts/profile-import-scan.test.mjs`
**79/79**. The original evidence predates the provenance fields,
so it replays through the current per-row gates but cannot serve as a *historical*
cross-round identity proof: the publisher now records the pre-measurement hash of all
four executed modules plus every resolved dependency, rechecks each one before writing the
report, and invalidates the execution when any of them is missing or inconsistent. Validity
is now read directly from the before/after hash maps and the published provenance, with a
missing, malformed or disagreeing entry in any of the three invalidating the run
(`PROVENANCE_MODULE_HASH_MISSING`), and the final dependency recheck must correspond
one-to-one with the canonical dependency set (`RESOLVED_DEPENDENCY_RECHECK_MISSING` /
`RESOLVED_DEPENDENCY_RECHECK_FAILED`); `unchanged` remains a readable summary and no longer
carries the authorization decision. This does not change C1's accepted S1 blocking result,
its median statistic or its raw-duration rule.

Dependency identity is then decided **per run**, not as a cross-run union: the canonical set is
the first valid required run's resolved dependencies, and every other required round/mode must
carry **exactly** that file set with **exactly** those hashes (a missing `resolvedModules` or an
empty list gives `RESOLVED_DEPENDENCY_SET_INCOMPLETE`; a missing, extra or duplicated record
gives `RESOLVED_DEPENDENCY_SET_MISMATCH`; a differing digest for the same file gives
`RESOLVED_DEPENDENCY_IDENTITY_UNSTABLE`). A union rule lets a round that stopped resolving a
dependency still pass, because another round can supply that file to the union; under the
per-run rule such a report is execution-invalid. The published provenance likewise requires
exactly one row per canonical dependency (a same-hash duplicate row gives
`PROVENANCE_DEPENDENCIES_INCOMPLETE`), and the final recheck keeps comparing against that same
canonical set one-to-one.

## Alternatives considered

- **Optimize the heaviest-looking `scanImport` directly** — rejected: without a baseline
  there is no way to separate a real hot spot from an impression, and no way to show
  improvement. C1 produces the reproducible measurement first.
- **Measure IPC round-trips on the live Electron main thread** — deferred: it requires
  launching the app and a stable load, and it is far noisier; function-level cost comes
  first, and IPC and rendering stay marked NOT MEASURED.
- **Add the measurement to CI as a performance gate** — rejected: scheduler noise on CI
  machines makes hard timing assertions flaky; this change records measurements only and
  adds no CI performance gate or npm alias.
- **Sample `process.memoryUsage()` frequently inside the timed window** — rejected: Node
  documents that gathering it is itself costly; only endpoint observations are taken.
- **Create a new Git repository for the F cases** — rejected (no new repositories,
  branches or commits are permitted): instead the harness uses read-only `GIT_DIR` +
  `GIT_WORK_TREE` against the existing isolated copy's Git scaffolding, with global and
  system Git configuration isolated.
- **Optimize the largest C2 category (`session-meta-read`) directly** — rejected: C2's own
  predeclared gate rejected its instrument as too intrusive (39-46% overhead), so the
  attribution is a limitation, not a finding. Acting on it would repeat exactly the
  mistake C1 was written to prevent.
- **Raise the 20% overhead ceiling after seeing the result** — rejected: the rule was
  recorded before the measurement, and moving it afterwards would convert a limitation
  into an unearned recommendation.
- **Describe the measurement as "historically stable"** — rejected: the original run never
  captured before-run module or dependency identities, so back-filling them would invent
  hashes that were never taken. The report therefore separates "replays cleanly through
  today's per-row gates" from "historical cross-round identity proof: not captured", and
  the missing latter proof invalidates the execution rather than being covered by the
  former's pass.
- **Expose the evidence through a single index file** — rejected: an index carries no
  bodies, so a reader still cannot see the records. The three records and the revalidation
  output are registered as separate readable execution outputs instead.

## Acceptance criteria

`node --test scripts/measure-desktop-lifecycle.test.mjs` passes, covering fixture
correctness and precomputed digests, sample accounting, time/CPU/memory units, threshold
boundaries (equal to the threshold is not a breach), the repeatability gate, first-call
ordering and call counting, the per-invocation memory protocol, heartbeat arm/settle under
a deterministic scheduler, and — through the **real** decision/orchestration functions —
that a success-shaped payload with a nonzero exit code, missing samples, failed
calibration, changed inputs (including a negative conclusion and two identically missing
hash maps), a same-length fixture edit, a changed resolved dependency, contradictory memory
endpoints and growth series, a missing control maximum, a wrong digest, a malformed
payload, a timeout that must stop expansion and cannot become a success payload, and the
three blocking-statistic cases (isolated outlier does not breach, a genuine repeated median
breach does, disagreeing batch medians are not repeatable) are handled as specified.
Child-ledger cases are separate: closed PIDs and reused PIDs are never signaled (proven
through an **injected signal/probe function**, not a real unrelated process), a failed
signal is recorded as an attempt rather than as termination confirmation, non-positive and
non-integer PIDs are never actionable, torn and malformed announcements are dropped without
displacing a known-good record, and duplicate close announcements only increment a counter.
An orchestration case proves that unconfirmed termination is fatal: nothing is launched
after it and the remaining cases are all recorded as invalid. A deterministic duration case
proves that when raw time breaches and the estimate does not, the gate follows the raw
series, and that a missing or misdirected `authoritativeDurationSeries` invalidates the
payload. Execution validity has its own cases: a valid-but-evidence-free `INCONCLUSIVE`
must be `ok: true` with exit code 0, while invalid input, an unresolved process, and
`CORRECTNESS_FAILURE` must be `ok: false` with a nonzero exit code. Ordinary tests never
depend on real timing thresholds and never start a real unrelated process.

Termination confirmation additionally has four injected integration cases that drive the
**real `runWorker` completion path** (injected spawn handle, probe and virtual clock; no
real unrelated process is touched): a worker whose kill returns false and whose exit is
never observed must, at grace expiry, return `UNRESOLVED_PROCESS` with
`terminationConfirmed: false`, the worker PID in `unresolvedWorker`, and
`requestedFailure: WORKER_TIMEOUT`; a late worker `close` must not be confirmed early; a
worker that closes during a timeout while its owned child survives must not have that
`close` callback bypass child polling (confirmation waits for the child, and persistent
survival stays unresolved); and an unexpected probe error must stay unresolved rather than
counting as absence. A `probeProcess` tri-state case covers alive/absent/unknown, and a
report-serialization case proves that an actual failed outcome, routed through the
production report builder without any `PERF_RESULT`, still retains the spawned worker PID,
signal attempts, `terminationConfirmed`, `unresolvedChildren` and `requestedFailure`, and
that an unresolved result keeps the CLI at `ok: false` with a nonzero exit code. These
cases were **mutation-checked**: removing the worker-exit requirement, treating `unknown`
as absence, and letting the `close` path skip the shared completion condition each made
them fail, so they genuinely discriminate the bypasses they cover.

A post-spawn `error` additionally has three injected-real-`runWorker` cases: when the kill
emits an error and returns false and the exit is never observed, no early `SPAWN_ERROR` may
be produced (`UNRESOLVED_PROCESS` at grace expiry, with the worker PID, `workerKill.error`
and `workerError.code` retained and `kill()` invoked exactly once so the handler cannot
recurse), and that actual returned value is carried through `workerIdentityFor`,
`persistedCaseRow`, `runControlAfter` and the execution-status path to prove the run stops
and reports `ok: false`; when the same error is followed by a late close, termination is
confirmed only after the close and child resolution with the error evidence retained; and a
creation failure with no PID stays a bounded `SPAWN_ERROR` that signals nothing and claims
no termination. Mutation checks: restoring an unconditional `finish(SPAWN_ERROR)` for a
worker that already has a PID fails two of these cases, and restoring a recursive
`terminate()` from the error handler fails as well. This error path changes none of the
accepted median statistics, raw-duration gating, or the S1 conclusion.
`node scripts/measure-desktop-lifecycle.mjs --profile c1
--source-root <root> --out <new dir>` produces `report.json` and `summary.md` on the
isolated copy, including input-identity hashes, every raw sample and the decision table.
The ordinary test suite must **not** run the full benchmark.

## Risks

- These are function-level measurements on synthetic fixtures, not real user load; the
  report must keep its NOT MEASURED list.
- Event-loop obstruction measured in an isolated Node process is not live Electron
  main-thread blocking.
- RSS endpoints in an isolated process include GC timing differences; they can trigger
  memory profiling but do not establish a leak.
- Report directories must not live inside the source checkout; benchmark fixtures are
  retained by default with their locations recorded, and no separate cleanup supervisor is
  introduced.

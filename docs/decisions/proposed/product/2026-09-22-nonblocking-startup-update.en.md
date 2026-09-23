# Decision: Cold-start update checks leave the auto-start critical path

Status: proposed

[中文](2026-09-22-nonblocking-startup-update.md) | English

## Problem

`runColdStartGate` (`src/main/launcher-gate.js`) awaits `checkUpdate()` as its very first action, and
only then evaluates local recovery, the import hold, the previous start failure, and the auto-start
setting. `update.js` budgets that request at `CHECK_TIMEOUT_MS = 10_000`, so when the GitHub API is
swallowed by a proxy black hole, DNS, or a firewall that connects but never answers,
`startDesktop()` waits for close to ten seconds. Source runs and packaged runs share the same gate,
so this is not a cost that appears only in one distribution shape.

The first fix that comes to mind is to shorten the timeout, but that budget is precisely the guard
that keeps a hung GitHub from dragging the cold start down. The real problem is not that the budget
is too long: it is that **auto-start has no reason to wait for a network result that does not
decide whether the local start may proceed**. The check result affects the product in exactly two
places — asking the user whether to update, and writing an update hint into the launcher.

## Proposal

Split the gate into two paths that run in parallel: the local start decision, and the update check.

The local start decision keeps today's rules for auto-entering the desktop — import hold, a
recovered interrupted import, a failed last start, and `config.autoStartDesktop === false` all
behave as before — but **no longer waits for the update network result**. The update check starts
when the gate starts, and a late result lands in the launcher according to the install shape
instead of rolling back the auto-start decision:

- `autoStartDesktop` is true with no local hold: `startDesktop()` runs first. A late result does not
  steal focus, does **not** open the launcher on its own, and does **not** trigger a second start;
  the result is kept in-process.
- `autoStartDesktop` is false, or a local hold already requires staying in the launcher:
  `openLauncher()` runs first and the late result surfaces in that same visible launcher window
  through the existing update ask and download orchestration.

Consuming a late result is the job of `createParkedUpdateDrainer`, not of "whoever reads status
first":

- The result parks in `parkedUpdateCheck`, and `shell:launcher-status` reads it with
  `peekParkedUpdateCheck()` **without consuming** (the previous take-based read let a single status
  refresh from a hidden window swallow the result).
- The drainer consumes only while the launcher is **actually visible** and the generation is current;
  concurrent calls share one single-flight round, so repeated `show` events cannot ask twice.
- With `askOnUpdate === false` the result is consumed silently, with no prompt.
- When consumption is abandoned (the window closed while the confirm dialog was awaited, the app is
  quitting, or the generation was replaced) and no newer result exists, the result is re-parked for
  the next launcher that is genuinely visible.
- `presentUpdateAsk` takes a `shouldContinue()` that re-checks **after** the confirm dialog is
  awaited; it returns `{ abandoned: true }` without installing or stealing focus.

On the `index.js` side a `launcherWindowToken` identifies the current launcher window:
`openLauncher()` drains after showing, `bindLauncherClose` drains on `show` and clears the token on
`closed`, and the drainer's `isCurrentGeneration` decides by window identity while `shouldContinue`
checks quitting, still-visible, and matching generation together.

The update check is single-flight within the process: concurrent callers in one process share a
single network request. An explicit refresh (the launcher versions page, `shell:check-update`)
still bypasses the short-lived result to fetch fresh data. The first version adds no on-disk update
cache.

Downloading, sha512 verification, confirmation for releases without a checksum manifest, and
launching the installer all keep their current code paths and semantics. A late result must check
the start/quit generation: if the update request returns after the app has quit or after the
installer flow has begun, it must not rewrite launcher state. A failed update download must never
close a desktop that is already working.

## Alternatives considered

- **Lower `CHECK_TIMEOUT_MS` (to three seconds, say)** — rejected: that trades a correct guard for a
  nicer-looking number. On a black-holed network it turns ten seconds into three while leaving the
  wait on the critical path, and a shorter budget makes users on slow networks see "check failed"
  more often: more false alarms, uncertain benefit.

- **Add an on-disk TTL cache for the check result and skip the cold-start request** — deferred: it
  does remove the steady-state first request, but it introduces an on-disk format and invalidation
  semantics (expiry, crossing versions, how an explicit refresh bypasses it) while leaving the root
  cause — a network result deciding start ordering — intact on every miss and every expiry.
  Non-blocking orchestration comes first; the cache stays an optional later accelerator.

- **Never auto-enter the desktop; always show the launcher and wait for the update result** —
  rejected: that reverses existing product behavior. A user who enabled "start the desktop after
  opening" is asking to skip the launcher; pushing everyone back into the launcher for the update
  check swaps a visible delay for an invisible one.

- **Move the update check after the desktop is entered and run it alongside the harness start** —
  partially adopted: the check already starts with the gate and runs concurrently with
  `startDesktop()`; only the presentation of the result differs. Deliberately not deferring the
  request until the harness is up, because that moves the prompt to a moment when the user is
  already working, which is more disruptive.

- **Let the renderer's status query take the result directly** — rejected (implemented, then
  overturned): `shell:launcher-status` is also called by background refreshes and by a hidden window,
  so take semantics made the result disappear before any visible surface could show it. The status
  read must be non-consuming, and consumption must be driven by the "actually visible" action.

## Acceptance criteria

- With `checkUpdate` returning an unsettled Promise, a cold start that qualifies for auto-start
  still calls `startDesktop()`, and `startDesktop` is called before the check settles.
- A late-settling check produces no second `startDesktop()` call, does not open the launcher, and
  does not steal focus.
- With injected 0 / 2 / 10 second network delays, the P95 delta of `gate → startDesktop` stays under
  100 ms against the zero-delay control, and the causal ordering assertions pass.
- The `autoStartDesktop === false`, import-hold, and failed-last-start paths still stop at the
  launcher, and an update result can still surface there.
- A status refresh from a hidden launcher does **not** consume the parked result; reopening asks once
  according to `askOnUpdate`, and `askOnUpdate === false` consumes it silently with no prompt.
- Abandoning consumption while the confirm dialog is awaited (window closed, app quitting, or
  generation replaced) re-parks the result, and a failed async notification produces no unhandled
  rejection.
- Existing update-flow regressions hold: a failed download or verification lands back on the
  launcher home; only a packaged run whose installer has launched waits for exit; a source run that
  launched the installer stays on the launcher.
- A single-flight hit issues one network request; an explicit `shell:check-update` refresh is not
  blocked by the short-lived result.
- Beyond the pure gate unit tests, a real Electron run that opens the launcher is required.

## Risks

- This is a **product ordering change**: the update prompt can appear later than the desktop. A user
  with auto-start enabled accepts that the update ask shows up the next time they open the
  launcher, rather than blocking the desktop start.
- A late result racing a manual action (the user opening the launcher first, choosing "later", or
  entering the installer flow) must be arbitrated by the generation check, or the app will show a
  duplicate prompt or rewrite a finished action.
- Skipping an on-disk cache means every cold start still issues one network request; this decision
  only guarantees it does not block the start, not that it is free of power cost or offline errors.
- If the concurrent check is implemented as unbounded re-entry, rapid consecutive restarts stack
  in-flight requests; single-flight is a requirement of this design, not an optimization.

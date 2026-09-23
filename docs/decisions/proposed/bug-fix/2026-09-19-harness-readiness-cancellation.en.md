# Decision: Harness readiness propagation carries the abort signal into the nested token redemption

Status: proposed

[中文](2026-09-19-harness-readiness-cancellation.md) | English

## Problem

`probeHarnessReady` guards its first probe and the origin retry with one
`AbortController`, but when the first response is 401/302/303 without `Set-Cookie` it
calls `redeemBrowserSession(url, { fetchImpl })` for the one-shot token redemption —
that call never receives the signal, and `redeemBrowserSession` itself never forwards a
signal to `fetch`. A stalled redemption can therefore outlive the readiness budget
(1500ms by default) and stretch the startup poll; when `stop()` bumps the generation to
invalidate the old run, that in-flight redemption is not cancelled either, keeps holding
the event loop, and returns after shutdown. The audit probe recorded the asymmetry:
`first=signal`, `redemption=no signal`. Similarly, `DshManager.waitUntilReady` only
checks the generation and child identity before the `await`; if the probe resolves after
`stop()`, it can still write the old generation's `sessionCookie`.

## Proposal

`redeemBrowserSession` takes an optional `signal` and passes it through to `fetch`;
`probeHarnessReady` supplies its own `controller.signal` at the nested call site. The
readiness `finally` keeps clearing the timer, so the signal and the timeout share one
lifecycle. `probeHarnessReady` also accepts an optional **caller signal** and combines it
with its own timeout controller: an already-aborted caller must throw its original reason
before any request is issued, the combined signal must cover all three requests (first
probe, nested redemption, origin retry), and caller cancellation must take precedence over
the internal timeout while that timeout still returns the original `{ ok: false, cookie: '' }`.
The `finally` releases both the timer and the abort listener registered on the caller
signal, so listeners cannot leak. Forwarding a signal into `probeHarnessReady` without
consuming it there is not cancellation propagation — the intermediate hand-off must reach
the real requests.

`DshManager` makes the low-level `probeHarnessReady` injectable, `isReachable`
accepts a caller-supplied guard, and re-checks that guard after the `await` returns but
before publishing the cookie; `waitUntilReady` supplies a guard that checks whether the
generation and child identity are still current, and **re-checks that same guard after the
probe `await` returns, before writing `this.baseUrl` or returning a ready URL** — the caller
must not rely on an injected probe implementation to honour the guard by itself. Add focused
tests: assert that all three
fetches (first probe, nested
redemption, origin retry) hold the same signal instance, and assert that a redemption
which never settles is aborted within the readiness budget and makes
`probeHarnessReady` return `{ ok: false }` instead of hanging until the caller's timeout;
also assert that a probe resolving after `stop()` does not publish a stale session cookie,
and add a controlled **overlap** case where the old generation's helper resolves only after
the new generation is already ready (with the injected implementation deliberately ignoring
the guard): the stale continuation must not overwrite the current `baseUrl`/`sessionCookie`,
and the current generation must stay ready. Caller-signal acceptance must exercise the
**real chain** `establishLiveSession → probeHarnessReady → injected fetch`; replacing
`probeHarnessReady` with a fake probe proves nothing about cancellation, because asserting
on argument forwarding cannot distinguish "consumed" from "ignored". After its `await`,
`establishLiveSession` must re-check cancellation so a probe that returned while the parent
was already cancelled cannot be accepted as a successful session, and it must not start
another token redemption for that.

## Alternatives considered

- **Give the redemption its own shorter timeout** — rejected: that introduces a second
  timeout budget and a second cancellation semantics; the caller's existing signal is
  the right scope, and another layer only makes the shutdown path harder to reason about.
- **Wrap the redemption fetch in `Promise.race`** — rejected: the race only returns to
  the caller early; the underlying request keeps running and cancellation is unsolved.
- **Leave it and rely on the caller's budget** — rejected: `waitUntilReady`'s readiness
  budget cannot interrupt an already-issued fetch; the in-flight request outlives
  `stop()`, which conflicts with the generation-invalidation contract.

## Acceptance criteria

`node --test src/main/harness-browser-auth.test.js src/main/dsh.test.js` is green (59/59),
including the new cases for signal propagation, the aborted stalled redemption, the
stale probe that must not publish a cookie after shutdown, verified through the production
forwarding path with old/current cookie positive and negative cases, and the cross-generation
overlap case where a stale helper completion cannot clobber the current URL or cookie while
the current generation stays ready; the existing
303-then-origin retry path is unchanged; `redeemBrowserSession` stays backward compatible
for existing callers that pass no signal (for example tool scripts outside `dsh.js`).

`node --test scripts/remote-workspace-live-guard.test.mjs` is green (8/8) and covers a
pre-aborted caller (asserting no request was issued at all), cancellation during the initial
request, during nested redemption, and during the authenticated retry, with the probe's
internal timeout set far longer than the cancellation trigger so that cancellation — not the
internal timeout — is proven to settle the operation; it also asserts the abort listener is
removed in `finally`. That case fails when the caller→timeout controller forwarding is
replaced with a no-op (mutation-verified), so cancellation propagation has real regression
protection.

## Risks

Once the signal propagates, every redemption triggered inside readiness is cancelled
with the readiness budget; any future caller that needs a redemption to outlive the
probe must pass an explicit separate signal instead of relying on the default. The signal
is only valid inside the readiness window, so callers must probe again after a timeout.
The caller's post-`await` recheck is defence in depth and does not replace a probe
implementation honouring the guard: an implementation that ignores it may still issue the
real request, and only its result will not be adopted.
The guard only prevents stale generations from publishing a probe result; it does not stop
the underlying fetch, which remains the signal's responsibility.

# Decision: Enable the whale assistant by default and restart without blocking

Status: implemented

[中文](2026-09-29-whale-default-restart.md) | English

## Problem

The user requested an enabled-by-default assistant and reported a roughly thirty-second freeze after enabling it. The default was false, and restart stopped the old Harness before revealing recovery. Synchronous Windows process lookup and termination blocked Electron's main thread.

## Decision

Default `whaleAssistantEnabled` to true while preserving explicit false values. The desktop character toggle remains independent. Once task protection approves restart, reveal the existing recovery canvas before stopping the service. Use asynchronous execFile with timeouts and hidden windows for process lookup and termination. Stop, leftover cleanup, and failed-start cleanup await termination, retaining PID provenance, process-name allowlisting, self-process exclusion, and generation checks.

The user explicitly approved extending the change to `src/main/dsh.js`. Keep inspect/acquire/drain and task interruption confirmation; do not shorten drain deadlines to simulate acceleration.

## Alternatives considered

Changing only the default avoids the first manual enable but leaves later toggles blocking. Revealing recovery earlier still freezes animation during synchronous system commands, so process cleanup also becomes asynchronous.

Overwriting every persisted false value would discard users' opt-outs, so only the default changes. Hot-loading the plugin needs a separate lifecycle contract; this change retains restart.

## Consequences

The assistant is available by default; recovery remains visible and the event loop responds during process termination. Reloading the service still takes time; instant startup is not promised. Every cleanup caller must await completion. Regression coverage checks that pending termination neither clears the PID nor starts the next generation, and rejects termination of processes other than node/dsh.

Isolated Electron measurement: one baseline restart took about 17.5 seconds with a 2.1-second main-thread stall. One fixed run took about 24.9 seconds, revealed recovery about 16 milliseconds after restart began, and recorded no main-thread stall above 500 milliseconds during the toggle. Different loads prevent treating these samples as startup-speed evidence. The isolated fixture auto-accepted task confirmation without changing production confirmation. All 324 focused tests passed; see the [QA record](../../../qa/results/2026-09-29-whale-restart/RESULTS.md).

Related-decision audit: [single conversation and settings](../product/2026-09-24-whale-single-conversation-settings.en.md) partially overlaps; retain its session and IM semantics. [Quit transport false positives](2026-09-29-quit-transport-false-positive.en.md) concerns task inspection and remains intact. [Partial performance rollback](../architecture/2026-09-24-whale-performance-partial-rollback.en.md) concerns drawing, unrelated to this stop path. No existing default-toggle decision needs replacement.

# Decision: Pet growth corpus scan moved off the Electron main thread

Status: implemented

[中文](2026-09-17-pet-growth-scan-off-main-thread.md) | English

## Problem

`scanSessionTokens` was triggered synchronously by the 60s `rescanGrowth` timer and the `shell:live2d-feed`/`shell:live2d-growth` IPCs, running `fs.readFileSync` + per-frame `zstdDecompressSync` + per-line `JSON.parse` on the Electron **main** process for every session log whose size+mtime changed. The active session's log changes with every write-behind batch (~200ms), so every 60s tick missed the cache and re-decoded the whole file; log size grows with the session (measured ~75ms per compressed MB), turning each rescan into a multi-second main-process freeze on large corpora — every window, IPC, and the cursor pump stalled together. The code comment's assumption ("session logs are small (KB-scale)") does not hold for long sessions and is the verified mechanism behind the reported "intermittent stutter after prolonged use".

## Decision

The corpus scan moved verbatim into `worker_threads`: `pet-growth-scan-worker.js` owns the per-file decode cache and runs the same `scanSessionTokens` off-thread; `createScanWorker()` wraps the message round-trip on the main side (lazy spawn, `unref()`, respawn on the next scan after a crash, `close()` terminal). `createGrowthTracker.refresh()` became async with concurrent calls coalesced inside the tracker (one shared in-flight scan), and a `scanTokens` injection point was added for tests and future implementations; `dispose()` terminates the worker. The worker entry and this module ship via `asarUnpack` under the same convention as `dshd-daemon-runner` (plain-node threads cannot read inside app.asar). The bookkeeping semantics (baseline watermark, (turn,step) last-wins dedup, daily totals, single-meal cap) are unchanged line for line.

## Alternatives considered

- **Fold growth into `pet-dsh-watch`'s incremental tailing** — rejected: the watcher holds persisted byte cursors, but growth needs the per-(turn,step) last-wins usage table; persisting that table either bloats config.json or invents a new on-disk format, and feedable must be gated until the backlog drain completes (otherwise the historical corpus becomes food and breaks the baseline contract) — far more state-machine and migration cost than a process boundary.
- **Keep the sync scan but throttle bytes per tick** — rejected: tokensSeen/baseline are untrustworthy until the corpus is fully scanned, requiring a new "baseline not ready" state and changed feedable semantics; it only slices one long freeze into smaller spikes without removing the main-thread cost.
- **Cap scanned file size and skip large logs** — rejected: skipping large files undercounts tokensSeen and baseline, breaking both the feeding ledger and the read-only-total contract.
- **`utilityProcess.fork` / `child_process` to host the scan** — rejected: same asar constraint with heavier process overhead; `worker_threads` inside the same process already provides the isolation.

## Consequences

Cost: the worker entry and `pet-growth.js` ship in `asarUnpack` (two copies on disk when packaged, same precedent as the daemon runner); `refresh()` went from sync to a Promise — the `feedTokens`/`growthSnapshot` IPCs became async (transparent to `invoke` callers through `ipcMain.handle`), with all three call sites awaiting; a new main↔worker message contract (`{type:'scan',id,sessionsDir}` → `{id,ok,total,sessions}`) reports scan failures as honest rejections absorbed by the existing try/catch at the call sites (the 60s tick quietly retries next round). Gain: the corpus can grow without bound while the scan only occupies the worker thread — the 60s tick on main degrades to one message round-trip and the periodic global freeze is gone; `node --test` pet-growth reports 23 pass (5 new: worker parity, main-thread liveness, refresh coalescing, failure propagation, close terminality), the desktop-live2d/pet-dsh-watch/pet-settings suites are unchanged, and the full main suite reports 1188 pass.

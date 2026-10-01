# Decision: Closing-overlay paint waiting must not block normal quit

Status: implemented

[中文](2026-10-01-closing-overlay-paint-deadline.md) | English

## Problem

After original CI candidate `36804159162` completed task protection and acknowledged quit, its peer file disappeared but the installed main window and Harness Node remained alive for an extended period. Bound to the exact installed EXE and CDP owner, the boot page contained the closing overlay and document.hidden was true; separate 500ms and 700ms read-only probes received neither the first nor second frame. `finalizeQuit` awaits `showClosingOverlay` before normal Harness shutdown, but the overlay's double-requestAnimationFrame Promise had no deadline.

This complements [the local-connection quit fix](2026-09-29-quit-transport-false-positive.en.md): inspection and drain had completed, and the stall is in closing-feedback painting. It does not replace task protection. Code inspection withdrew the late-listener-registration hypothesis; the listener registers synchronously outside the whenReady Promise.

## Decision

- Retain the overlay theme, copy and normal two-frame painting path. Put a 500ms main-process deadline around the complete CSS insertion, script execution and frame wait; clear its timer on completion, error or timeout, then continue normal shutdown.
- Cover throttled renderer timers and unresponsive IPC. Handle late Promise completion or rejection without unhandled rejections; do not increase global background frame production to solve quit.
- Retain inspect, admission locking, drain, resource cleanup and `harness.shutdown()`. The deadline limits only visual feedback and does not authorize skipping unfinished work or force exit.

## Alternatives considered

- Unbounded two-frame waiting ensures feedback was painted, but hidden or suspended pages never call back and block normal shutdown.
- A renderer-only setTimeout is simple but is also throttled and does not cover pending CSS or IPC.
- Direct app.exit or process termination ends the window but bypasses normal resource and Harness shutdown, unnecessarily expanding side effects.

## Consequences

A slow renderer may not paint closing feedback before normal shutdown begins; visual styling is unchanged. Regressions cover missing frame callbacks, CSS and script Promises, normal timer cleanup and renderer rejection, plus reproduction and bounded waiting in a real hidden Electron page. A new CI Setup still requires installed quit acceptance; the old candidate's extended process survival is not Pass.

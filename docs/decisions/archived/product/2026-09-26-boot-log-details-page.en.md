# Decision: Boot page two-page log zoning — clean scene, diagnostics and actions on a details page

Status: implemented

Archived: 2026-09-26

[中文](2026-09-26-boot-log-details-page.md) | English

## Problem

The boot page painted monospace logs permanently across the canvas bottom: during normal runs they were low-value standing noise diluting brand and status, while during failures the diagnostic lines and recovery actions users need most were squeezed into the same viewport segment. The prototype `docs/superpowers/prototypes/boot-redesign-b2-logzone.html` compared four "log zoning" treatments; the two-page structure (L1) carries the most information and stays compatible with the existing recovery semantics.

## Decision

Keep the instrument-canvas visuals (scan lines, corner rails, state stamp) and every existing recovery semantic; only the presentation structure of logs/diagnostics changes: the scene keeps mark/brand/status/hint, plus a bottom-edge handle "详细 · 日志 NN" counting log lines live. The details page (`page-details`) is a full-page overlay on the same canvas carrying a column header, the failure/recovery copy, the four transient actions, and a scrolling log column; a "回到场景" button or Escape returns.

The details page opens automatically whenever the action surface appears (`state==='error'` or recovery `scheduled`/`restarting` — `canAct`), keeping retry/cancel/bridge reachable at zero extra clicks; once dismissed manually it stays closed for that episode (`detailsDismissed`) and resets when the surface clears. The handle count uses `snapshot.logs.length` (a snapshot reseed replays only the visible slice, so counting appends would drift); live lines increment via `appendLog`. Corner rails rise above the details page so the instrument frame stays consistent across pages.

## Alternatives considered

- L2 bottom ticker / L3 portside echo band / L4 carrier band (same prototype page): all keep logs resident on the scene, so the noise problem remains; the ticker under-reports during errors.
- Moving diagnostics to the launcher Recovery Board: violates the "boot keeps transient actions + a bridge" responsibility split and moves startup logs away from where they occur.
- Duplicate status copies on scene and details: two DOM trees to keep in sync for little gain.

## Consequences

The scene page is fully quiet during normal runs; on failure or scheduled recovery the details page surfaces the diagnosis and all actions automatically. `boot.html`/`boot.css`/`boot.js` were restructured and `boot-recovery.test.js` pins the details-page structure and auto-open logic with static assertions. The design-language "Desktop boot page" section and the feature card were updated in sync; headless Edge screenshots verified auto-open on error and that a manual return does not reopen within the same episode.

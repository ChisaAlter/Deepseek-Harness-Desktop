# Decision: One runtime action entry on launcher home

Status: implemented

[中文](2026-09-29-launcher-home-state.md) | English

## Problem

A pending start disabled only the clicked button, leaving the duplicate retry and plugin recovery actions available. Home still displayed old idle state and repeated failure paths, making a slow start look stuck. The observed runtime later reported ready; the screenshot alone does not establish a permanent hang.

## Decision

Start, close, skip plugins and restore full plugins share a renderer operation lock. A click immediately shows the current operation and actual elapsed seconds until its real request settles. No simulated progress or timeout claims the backend stopped. Failure refreshes status and releases the operation lock; stale status requests cannot replace newer ones.

Home keeps one start/close entry, with start becoming retry after failure. Raw errors appear only in initially collapsed startup diagnostics alongside plugin recovery actions. Pending startup hides old diagnostics, and an empty plugin list is omitted.

## Alternatives considered

- Removing only the duplicate button leaves other recovery races and stale status; rejected.
- Re-enabling start on a timeout can race a still-running backend start; rejected.
- Deleting full logs loses diagnostic evidence; preserve them behind disclosure instead.

## Consequences

Users expand diagnostics to read details. Hidden Electron windows load the real page and preload to cover deferred requests, double clicks, failure, rejection, another start, close and zoomed action reachability. This does not prove installed startup is faster; no automatic restart or manipulation of user windows while the computer is in use.

Record audit: the [launcher audit closeout](2026-09-28-launcher-audit-closeout-fixes.en.md) partially overlaps; transaction protections and accessible layouts remain. This record changes only home actions and diagnostic presentation. [Optional import](2026-09-29-optional-import-startup.en.md) governs cold-start routing rather than these in-flight constraints.

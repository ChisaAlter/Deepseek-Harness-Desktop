# Agent Note: Explicit file save flushes through the coordinator and confirms only its snapshot

Status: implemented

English | [中文](2026-08-25-file-save-race-and-flush.zh.md)

## Problem

`FilePreview.save()` awaited the write and then marked `draftRef.current` — read *after* the await — as saved. Keystrokes typed while the write was in flight were stamped as the saved baseline even though the bytes on disk were the pre-await snapshot: the buffer read clean, and the next `active` reread replaced the editor with disk contents, silently dropping those keystrokes. Explicit save also bypassed `FileSaveCoordinator`, so a debounced write and an explicit write of different revisions could interleave on the same file.

## Decision

`FileSaveCoordinator` gains `flush(contents)`: it records the caller's snapshot as the latest revision, cancels the pending debounce, waits out the single in-flight write (`inFlight` promise slot shared with the debounced path), and persists. `FilePreview.save()` now routes through `flush(draftRef.current)` and relies on the coordinator's `onConfirmed(contents)` to publish the saved baseline — `onConfirmed` sets `text` to the written snapshot while keeping the live draft, so mid-flight keystrokes stay dirty and survive the next reread.

## Alternatives considered

**Snapshot-only fix inside `save()`** (capture `contents` before the await, confirm that) — fixes the data loss but leaves the debounce/explicit double-write: two concurrent `writeFile` calls with different revisions can still land out of order. The coordinator already owns write serialization; routing the explicit path through it closes both holes with one mechanism.

## Consequences

- Typing during Save/Ctrl+S no longer marks unwritten keystrokes as saved; the tab stays dirty and the follow-up debounced write persists them.
- Explicit and debounced writes are serialized through one in-flight slot; a flush after an in-flight write also cancels the debounce that write may have rescheduled, so the flushed revision is written exactly once.
- The disk-diverged guard (`error.changed`) is unchanged: persist still rereads first and refuses once when disk moved away from both baseline and draft.

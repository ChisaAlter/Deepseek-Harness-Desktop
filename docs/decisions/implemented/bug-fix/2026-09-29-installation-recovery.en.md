# Decision: Recovery boundaries for installation waits, downloads and runtime extraction

Status: implemented

[中文](2026-09-29-installation-recovery.md) | English

## Problem

The initial stalled installation report had no field logs. A subsequent WER report records AppHangB1 in Whale Isle 0.3.3.0 on Windows 10 19045, but contains no thread stacks to attribute the hang to a particular call. Code review and fault injection confirm that whole-file downloads had only an overall timeout, installer failures kept polling registration, unprovable same-version repairs waited eight minutes, and extraction had no deadline and deleted the old runtime first. Extraction uses the user-data volume, whose free space is independent of the installation volume.

Prior decision audit: [Standalone distribution](../../proposed/architecture/2026-09-24-launcher-standalone-distribution.en.md) partially overlaps; route and checksum authority remain. [Runtime instance layout](../architecture/2026-09-28-runtime-instance-layout.en.md) partially overlaps; the link manifest format remains. [Differential updates](../product/2026-09-17-electron-updater-differential-updates.en.md) partially overlaps; the updater channel remains. [Launcher closeout](2026-09-28-launcher-audit-closeout-fixes.en.md) concerns plugin installation and cannot define desktop Setup recovery. No record is fully superseded or requires archival.

## Decision

- Whole-file downloads have separate twenty-second connection, forty-five-second inactivity and two-hour overall budgets. Transient network or selected HTTP failures retry from scratch at most three times, removing partial files; backoff remains cancellable. The existing electron-updater channel retains its fifteen-minute budget.
- Download feedback uses actual bytes, speed and retry counts, with roughly four regular progress notifications per second. Unknown totals have no percentage. The download volume is checked against response size plus 256 MiB reserve; the extraction volume against 115% of uncompressed tar size plus the same reserve. Preflight does not guarantee writes; unsupported probes are not treated as zero free space.
- A complete Setup is reused only after rechecking its SHA512 against the current release manifest. New downloads use `.part` and enter the complete cache only after verification. Wizard cancellation or failed pre-install admission preserves the verified cache. Older releases without manifests still require explicit confirmation and never reuse unverified cache entries.
- Installer launch failures return errors promptly; self-update exits only after the OS accepts the spawn. Spawn runs inside the task-protection commit, so failure releases Host admission without latching committed. Waiting instructions mention the wizard and system authorization; failure wins over registration changes. A same-version parent's exit returns unconfirmed, never completion inferred from mtime or UAC handoff.
- Extraction uses an isolated staging directory, reports elapsed time every five seconds and times out after fifteen minutes. Stopping the desktop cancels extraction. Temporary output is cleaned only after the extractor closes. The previous runtime survives until the new tree validates; a failed directory replacement rolls back, with `.previous` retaining the interrupted replacement baseline. Absolute Windows junctions are rebuilt at the final path before stamping completion. Extractions targeting the same directory are serialized. Leftover staging trees are swept next launch, excluding currently active staging directories.
- Feedback stays in the existing launcher progress card and boot log ticker, without a new installer skin, invented percentages or automatic bypass of Windows authorization.
- Startup link validation, repair and removal use actual asynchronous filesystem I/O, reusing the root realpath within each operation. Build scripts retain synchronous APIs with shared manifest validation. Existing logs report completed links, total count and elapsed time every five seconds. Preparation checks cancellation between filesystem operations without treating cancellation as corruption and re-extracting. Once final directory replacement starts, link recovery or rollback completes before returning, avoiding partial committed trees. Path boundaries and real-directory protection remain enforced.

## Alternatives considered

- Only increase timeouts: tolerates slow disks and networks but extends waits after disconnection or failure, so use phase-specific budgets and explicit outcomes.
- Declare success when a matching exe appears or the parent exits: fast feedback cannot distinguish failed repairs from UAC handoff, so report unconfirmed instead.
- Delete the old runtime before extracting in place: reduces peak space but corrupt archives destroy the recovery baseline, so accept staging overhead.
- Append to a previous partial download: saves bandwidth but requires reliable ETag, Range and source identity semantics. This change reuses only reverified complete files; partial retries restart from zero.
- Wrap the synchronous link loop in a Promise: the interface appears asynchronous but still blocks the main thread, so await actual asynchronous filesystem APIs instead. No cross-launch cache skips link checks, which could miss damaged or relocated junctions.

## Consequences

Users learn about stalled transfers, low space and installer failure sooner. First extraction reports activity and preserves the previous runtime on failure. Staging costs additional disk space; same-version repairs still lack a trustworthy completion receipt and remain explicitly unconfirmed. NSIS silent semantics, signing policy, release names and user session directories are unchanged.

Regressions cover stalled bodies, retries, cancellation, unknown lengths, checksum failure, complete caches, installer failure and same-version repair, low space, corrupt archives preserving old trees, relocated links, and timeout/cancellation waiting for extractor closure. Source and injected-failure evidence cannot replace Windows installation acceptance of the same CI Setup or establish resolution of the original user's incident.

Additional link regressions cover event-loop yielding during slow I/O, cancellation without re-extraction, rollback after failed final link creation, rejection of escaping paths/parent junctions, and preservation of real directories. Asynchronous I/O improves responsiveness without promising shorter total preparation time. An individual filesystem operation already submitted to the OS cannot be interrupted; cancellation takes effect after it returns.

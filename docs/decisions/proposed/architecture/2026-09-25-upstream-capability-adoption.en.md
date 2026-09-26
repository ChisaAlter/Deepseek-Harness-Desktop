# Decision: Adopt upstream task protection, shortcuts, Office, and Diff within Whale Isle's Web runtime

Status: proposed

[中文](2026-09-25-upstream-capability-adoption.md) | English

## Problem

The vendor pin is already DSH 0.1.7-rc.2, but Whale Isle runs the Web profile in standalone Node rather than the official Desktop Host. A package being present in source does not establish desktop integration. The earlier plan omitted stop and installation entry points, equated request fencing with producer admission control, counted Office degradation as completion, and lacked executable recovery and verification requirements.

Read-only inspection on 2026-09-25 also corrected a critical diagnosis: native-engine resolution fails from the business package but succeeds for Windows x64 0.1.1 from the actual libreoffice-kit importer. The former does not establish a missing engine or inevitable conversion failure. The [revised plan](../../../superpowers/plans/2026-09-25-upstream-adoption-plan.md) owns the detailed steps, named source evidence, and timestamped upstream metadata. This record retains the rationale and does not claim implementation.

Existing-decision audit (relevant matches only; other branding, installer-visual, and remote-fix records do not change these choices):

| Record | Classification | Relationship |
| --- | --- | --- |
| [0.1.7 desktop adaptation](../../implemented/architecture/2026-09-23-harness-017-desktop-adaptation.en.md) | Partial overlap | Preserve upstream interfaces and desktop behavior; this proposal does not repeat vendor synchronization |
| [Standalone Launcher distribution](2026-09-24-launcher-standalone-distribution.en.md) | Partial overlap | Preserve full/slim and process boundaries, adding coordination before interruption; do not claim the entire proposal is implemented |
| [Single visible sidebar proposal](2026-09-22-single-visible-right-sidebar.en.md) | Outdated direction, partial overlap | Its official-sidebar ownership proposal is not current state; follow the active work-loop card's ui-surfaces ownership and mutual exclusion without disposing of that older proposal in this batch |
| [Performance measurement](../testing/2026-09-20-desktop-performance-measurement.en.md) | Partial overlap | Preserve preregistered measurements and raw samples; new Diff measurements do not rewrite the earlier C1 probe conclusions |
| [Preview permissions](../bug-fix/2026-09-19-preview-permission-origin-scope.en.md) | Partial overlap | Office must not expand path, frame, or resource-owner authority; preserve existing authorization |
| [Packaging plugin reuse](../process/2026-09-22-packaging-plugin-reuse.en.md) | Partial overlap | Reuse requires dependency closure; Office adds checks from the real importer and after archiving and extraction |
| [Nonblocking startup updates](../product/2026-09-22-nonblocking-startup-update.en.md) | Partial overlap | Checks and downloads may precede protection; interruption enters coordination without adding another update channel |

## Proposal

1. Keep Electron with a standalone Node Web profile and desktop-owned overlays. Establish the P0 baseline, then deliver task protection, shortcuts, Office, and Diff. Compatibility checks begin at P0 and continue throughout.
2. Coordinate real quit, restart, stop, reload cleanup, blockmap/full installation, slim external installation, and independent delta updates. Obtain consent before configuration commits, auxiliary before-quit cleanup, stopping, installer launch, or installation-tree mutation. Host admission covers registered API, Schedule, Bots, IM, and job producers; the shell covers PTYs. Ownership/generations, an independent control channel, bounded draining, cancellation, and recovery form one contract. Unknown coverage blocks automatic installation. Delta fallback retains the same exclusive target transaction; unknown recovery preserves backups and blocks mixed-tree startup. The older distribution proposal's Setup reconstruction is not treated as current implementation.
3. Leave Schedule disabled by default. When enabled, inspect all active catalog reminders, including future work and cold Sessions. Bots retains routines. Deduplicate only shared source identities, with no duplicated migration or delivery. Distinguish explicit disablement from unknown failure.
4. Reuse the upstream shortcut registry/protocol through a narrow Whale Isle adapter supplying the desktop runtime, a main-process device file, menus, and guest input. Accepted revisions govern keycaps and dispatch. Do not fabricate the whole official shell bridge; preserve the browser Web path. Separate defaults from precedence: an explicit local-first policy protects terminal Ctrl+C/Ctrl+W, editing, modals, and recording against user-binding overrides. Native input and the dispatcher use the same policy before consumption; consuming a key before an asynchronous refusal is not allowed.
5. The first complete Windows x64 package includes a locked runtime, skills, kit, and native dependency closure. Resolve them in the real extracted Node runtime; install offline on first use atomically while retaining the previous digest. Three-format authoring, editing, structural checking, Files preview, CLI rendering, PDF export, and XLSX recalculation into a new file have explicit completion gates. cli:false is temporary diagnosis only.
6. Integrate Office into Files through slots. Move pure Diff presentation into ui-primitives and retain separate adapters for the two business sources. Follow the prohibition on runtime imports between feature plugins, current sidebar ownership, and the design requirement for highlighting main-thread tasks below 50 ms.
7. Retain the existing Browser and browse picker, preserving remote directory ownership. Rollback units are the stage's baseline files/hunks, overlay, adapter, and runtime/payload combination. User configuration, sessions, and the official home are not cleanup targets.

## Alternatives considered

- **Adopt the official Desktop Host/profile directly**: it supplies integrated assembly, but changes Launcher, remote, and desktop-extension lifecycles beyond selective adoption, so it is rejected.
- **Inspect only at before-quit and fence HTTP**: it minimizes changes, but an installer may already have started and Schedule/Bots can still deliver work, so it cannot meet the protection goal.
- **Retain Web shortcuts and replace only storage**: it reduces native work, but leaves defaults, menus, and guest dispatch inconsistent; use the complete narrow adapter instead.
- **Hide failing Office entries or download resources on first use**: these can contain failures or reduce size, but do not satisfy three-format preview and offline use. Independent containment is allowed, but is not full delivery.
- **Import FileDiff directly or copy the entire component**: the wiring is shorter, but violates feature layering or creates two evolving implementations. Share pure presentation and retain separate business ownership.

## Acceptance criteria

- Every required Q/K/O/D/C ledger entry passes with source and clean Windows installation evidence. Unexecuted checks do not pass.
- Shell/vendor checks, the official build, assembly gates, and documentation gates refer to the same candidate and actual behavior. A source pin is not release verification.
- Interruption, cancellation, disconnection, stale unlock, and installation failure recover correctly. Coverage and unknown states remain explainable.
- Office has evidence for closure from its real importer, the three-format matrix, offline copying, and downgrade recovery. Diff preserves plaintext and keeps highlighting main-thread tasks below 50 ms.
- Task-owned rollback rehearsals preserve existing uncommitted work and user data. Move this proposal to implemented only after the corresponding behavior and verification ship.

## Risks

Process coordination and producer coverage are the main implementation costs; one HTTP middleware cannot erase uncovered paths. Native adaptation affects input precedence and needs real IME, terminal, and guest evidence. Office adds package size, disk peaks, and binary signing work that must be measured. Replacing a runtime or payload does not establish that an older version can read newer persisted data; rehearse on isolated copies until compatibility is known. The dirty working tree and other ongoing changes require rollback by task-owned hunks.

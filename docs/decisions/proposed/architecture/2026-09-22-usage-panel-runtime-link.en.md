# Decision: Link the usage panel runtime instead of keeping a profile copy

Status: proposed

[中文](2026-09-22-usage-panel-runtime-link.md) | English

## Problem

On every start, `src/main/usage-panel-preset.js::ensureDesktopUsagePanel` copied
`vendor/dsh-usage-panel` into `profiles/web/desktop-plugins/dsh-usage-panel` and then linked
`profiles/web/node_modules/dsh-usage-panel` at that copy.

Replacing the main-thread-blocking `fs.cpSync` with an incremental async `fsp.cp` on 2026-09-03
stopped the UI freeze, but the **steady-state cost stayed**: the filter runs one `stat(src)` and one
`stat(dest)` per candidate, so the ~6k-file bundle costs about 12k stats plus one full directory walk
on every start. Measured locally (calling `ensureDesktopUsagePanel` directly against an empty
profile):

| Pass | Previous (incremental async copy) | Link implementation |
| --- | --- | --- |
| First (must write) | 13928 ms | 9.5 ms |
| Steady-state pass 2 | 1129 ms | 9 ms |
| Steady-state pass 3 | 1117 ms | 3 ms |

This work sits before `dsh.start()` in `harness-controller.js::performStartOnce`, so it directly
delays the `dsh` child process. It is a deterministic fixed cost on the startup path that does not
vary with network or machine load.

## Proposal

Link the panel's runtime code from `vendor/dsh-usage-panel` (the same path inside packaged resources)
straight into the profile instead of maintaining a second copy — the mechanism `@xmanrui/dsh-im`
already uses:

- `profiles/web/node_modules/dsh-usage-panel` is a junction/symlink to the runtime directory.
- `profiles/web/desktop-plugins/dsh-usage-panel/` is a **plain directory** holding only the overlay
  file. `node_modules` is a link while the overlay is a directory; the two do not share one shape, so
  do not read this as "both directories are junctions".
- The link is not unlinked/relinked when its target already matches: re-linking moves the ctime and
  briefly leaves package-name resolution with nothing to resolve.
- The overlay is written through a same-directory tmp file plus rename, so the Loader never reads a
  half-written file.
- `missingRuntimeFiles(sourceDir)` stays fail-closed exactly as before: a runtime with missing
  dependencies still blocks startup.

Migration no longer deletes the legacy copy recursively. `isManagedUsagePanelCopy()` only accepts a
real directory whose package name matches, and `isManagedOverlayDir()` only accepts the overlay and
its `.tmp`. When a managed copy is found it is **renamed within the same parent** into a retained
quarantine directory carrying the task's identity, rather than `rmSync` — the startup path performs no
recursive delete and a failure can still restore the previous state:

- `linkToTarget()` returns `{ relinked, quarantine }`. Unknown non-link content is **refused** with
  `{ ok:false, error:'refusing to replace unknown content…' }`; only a broken or dangling link may be
  replaced.
- If creating the link fails, the quarantine rename is rolled back and the previous copy is restored.
- On failure `ensureDesktopUsagePanel()` removes the new link, clears the replaced directory, and
  restores the previous copy, returning `quarantinedCopy` for callers and diagnostics.

The precondition is that the panel's **runtime code is read-only**. Its writable state (`prices`,
`peakValleyEnabled`) lives in the `dsh_usage_panel_billing` storage domain, not in its own install
directory, so there is no per-profile writable-copy semantics to preserve.

## Alternatives considered

- **Keep the incremental copy and compare content hashes** — rejected: hashing reads every byte, which
  is more expensive than 12k stats, and it still maintains a second copy with the same upgrade and
  staleness problems.

- **Add a one-time stamp so later starts skip the copy entirely** — rejected: that is exactly what
  trades missing-file detection for a marker that can lie. Missing files must stay fail-closed.

- **Use `fs.cpSync` with `force:false`** — rejected: `force:false` does not delete extra destination
  files and does not reduce traversal cost, while letting files deleted from the source survive in
  the copy.

- **Mount the panel outside `node_modules` (for example insert a file:// URL)** — rejected: the
  Loader rejects directory-form `file://` imports (`ERR_UNSUPPORTED_DIR_IMPORT`); resolution by
  package name is the workable path.

- **`rmSync` the legacy copy during migration** — rejected (implemented, then overturned): it is
  unrecoverable, reintroduces a large synchronous delete on the startup path, and leaves nothing to
  fall back to when the link fails. It became a same-parent rename into quarantine.

- **Leave the legacy copy in place and just point the link at the runtime** — rejected: a stale bundle
  would survive on disk, and neither later upgrades nor debugging could tell which copy is live.

- **Add a content-manifest cache that copies only changed subtrees** — deferred: the link removes all
  steady-state traversal; finer copying is only needed if single-copy semantics are required again.

## Acceptance criteria

- A steady-state start (second and later) creates no copied files and performs no full-tree stat walk;
  the `ensureDesktopUsagePanel` unit tests keep passing.
- `realpathSync(profiles/web/node_modules/dsh-usage-panel)` equals the runtime directory.
- Runtime edits are visible immediately (the same start reads the new content); no copy step is
  needed.
- A legacy full copy under `desktop-plugins/dsh-usage-panel` is **renamed into a retained quarantine
  copy** on the first start rather than deleted, and the overlay is still written as a plain
  directory.
- Unknown content (neither a managed copy nor a managed overlay) is refused with `ok:false` instead of
  being deleted.
- A failed link creation and a failed overlay write both restore the previous copy, including under
  paths containing spaces.
- `missingRuntimeFiles` keeps returning `ok:false` for missing dependencies and still blocks startup.
- The usage panel opens in the real desktop and reads session data (QA `TC-EXT-008`).

## Risks

- The link model requires the panel not to write into its own install directory; writing mutable data
  there in the future would pollute the vendored runtime. That precondition belongs in the card's
  invariants, and the change would need this decision revisited.
- Windows junctions behave differently from plain directories for relative imports, `node_modules`
  resolution, and permissions; loading has been verified on a real Windows desktop, and macOS still
  needs the same verification.
- The packaged build must ship the complete runtime (`extraResources` already covers
  `vendor/dsh-usage-panel/**`); if packaging prunes `node_modules`, the link target is incomplete and
  `missingRuntimeFiles` blocks startup instead of silently degrading.
- Retaining the copy means the first migration leaves an extra quarantine directory on disk; it is
  named after the task, and how long it should be retained is still an open decision.

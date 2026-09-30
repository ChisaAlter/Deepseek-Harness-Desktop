# Decision: File, remote, update, and build repairs from the project audit

Status: implemented

[中文](2026-09-30-project-audit-fixes.md) | English

## Problem

The project audit found eleven defects, and the user authorized fixing all of them: the Files adapter omitted save protection, selection transfer, and shared path navigation; malformed LAN requests escaped the handler, loopback binding expanded to all interfaces, and port/TLS controls were ineffective; preview URLs remained encoded; failed differential installation reported success and latched shutdown protection; archive and build credentials omitted content identity or real inputs; macOS selected a Windows installer.

Prior-decision audit: [single panel](../architecture/2026-09-28-single-panel-in-place.en.md), [installation recovery](2026-09-29-installation-recovery.en.md), [differential updates](../product/2026-09-17-electron-updater-differential-updates.en.md), and [launcher closeout](2026-09-28-launcher-audit-closeout-fixes.en.md) partially overlap. Their panel, recovery, differential-download, and offline-snapshot rationale remains; this record adds adapter boundaries and failure evidence. No record is wholly superseded. Visual feedback is documented in the design language before component changes.

## Decision

- Files persists browser drafts on every edit and retains mounted file tabs across switches. The existing Sidebar close handler defers closure through the shared save/discard Modal; failure preserves the editor and draft. Selection text enters the composer verbatim; path mentions remain separate. Tree and search use Workspace openPath with the Session preserved.
- LAN request parsing, URL decoding, and file reads catch failures within the request boundary: malformed requests return 400 and missing assets return 404. Bind arguments, pairing URLs, and snapshots agree. remotePort controls the loopback daemon port and participates in restart identity; the separate LAN static page keeps port 3180. The unsupported LAN TLS control is removed and replaced with accurate information about existing end-to-end encryption, relay TLS, and LAN HTTP.
- Preview URLs decode each path segment exactly once before filesystem authority checks. Unicode, spaces, and percent signs work; encoded separators, traversal, and NUL remain rejected.
- electron-updater retains blockmap differential downloads and its fifteen-minute budget, explicitly passes the cancellation token to its download API, and returns only an installer path. Target-version and release SHA512 checks precede the same observed spawn commit used by whole-file installation. Failure releases Host admission, leaves committed false, preserves the application, and never launches another installer during the same click. Terminal cleanups run only after a successful commit; failed commits preserve services and cleanup registrations.
- macOS selects a DMG matching the current architecture, allowing universal and architecture-neutral names. After verification it opens through the system and prompts the user to drag the app into Applications. Opening the image indicates only a manual installation entry; it neither certifies installation nor quits the current app.
- Packaging writes a small archive SHA256 manifest, and extraction stamps include the actual digest. Same-version, equal-length archive changes refresh the runtime; old stamps migrate once. Routine reuse reads only the small manifest; replacement streams and verifies the archive. Build credentials cover script helpers, vendor sources, manifests, and actual native platform outputs while excluding generated directories to prevent repeated invalidation.
- Full-suite verification also confirmed that Windows marketplace rollback snapshots copied existing junctions as privileged symlinks. Snapshot copying intercepts directory links on Windows and reuses ensureDirectoryLink to create junctions without traversing external overlays. Restoration preserves target identity and refuses to overwrite unknown ordinary directories.

## Alternatives considered

- Automatically save every closing file without prompting: fewer interactions, but save failures and intentional discard cannot be expressed. Retain save/discard confirmation and independent draft recovery.
- Add certificate management and HTTPS for LAN: transport TLS would help, but certificate distribution, trust, and phone acceptance require a separate feature. Remove the ineffective control and disclose current behavior accurately.
- Observe quitAndInstall error events to report installation failure: preserves its installation entry, but a void result and asynchronous events cannot prove launch commit. Retain its downloader and share the existing observed spawn instead.
- Stream-hash the full runtime archive on every launch: reliable identity, but repeated reads of a large archive. Use a packaged digest manifest and verification before extraction; only legacy layouts require the streaming fallback.

## Consequences

All eleven defects are repaired in their owning modules while preserving layout, remote v2, differential downloads, task admission, and path authority checks. Unavailable browser storage prevents a guarantee of draft recovery across reloads; LAN pages have no HTTPS; DMG installation remains manual. Source tests do not certify real Windows NSIS installation, macOS mounting/installing, or public-relay phone pairing.

Regressions cover dirty drafts, deferred close and failed saves, selection and Session navigation, real malformed HTTP, encoded file paths, real daemon port restarts, renewed admission after installer spawn failure, platform asset selection, equal-length archive changes, and build-input invalidation. Feature cards, handbook, vendor divergence notes, and bilingual pairing are updated in the same change.

Results and permission limitations are recorded in the [project audit verification](../../../qa/results/2026-09-30-project-audit-fixes/README.md).

# Agent Note: Desktop marketplace discovery and operations

Status: implemented

English | [中文](2026-09-08-desktop-marketplace-discovery-operations.zh.md)

## Problem

The desktop marketplace retained only a subset of dshmarket discovery and maintenance workflows. Importing the complete upstream plugin would replace desktop restart ownership and introduce a second Settings implementation.

## Decision

The desktop adopts selected dshmarket 1.45.0 behaviors without its runtime or styling. Discover supports favorites, star/date sorting and date filters. Baseline Modal, Menu, Tooltip and MarkdownText primitives render confirmations, catalog screenshots, repository README and author-declared npm requirements. Requirements remain informational; they are not a compatibility verdict. Documentation requests accept catalog ids, use fixed public endpoints without user credentials, and enforce body/cache/concurrency bounds.

Desktop IPC owns favorites and the bounded, redacted operation journal. Entries survive renderer reload and Harness restart. Unfinished entries from a prior desktop process are reported as interrupted, never silently replayed. Install and removal require confirmation. Sequential batch updates share the install mutex and restart Harness once after committed writes; rollback failure stops the batch and suppresses restart. Build approval remains per-plugin and cannot hide rollback failure.

Registry updates require registry provenance; a same-named private Git dependency cannot be replaced by an npm package. Known pnpm/network failures receive specific explanations without destructive repairs or release-age bypass.

## Alternatives considered

**Restore the upstream runtime.** Rejected because the desktop owns the profile, restart coordinator, and visual language.

**Loop renderer-side single-update IPC.** Rejected because it would restart after every item and lose progress when the renderer reloads.

**Infer compatibility from a package name.** Rejected because raw author requirements and actual desktop host compatibility are different facts.

## Consequences

Discovery and maintenance gain upstream workflows while preserving desktop integration. Partial batch success is explicit. Rollback still relies on package-manager reconstruction and cannot restore plugin-managed data migrations. Common credentials are redacted, but arbitrary user-defined sensitive text needs review before sharing. Release assets, automated compatibility verdicts, comments and generic cancellable queues remain outside this change.

## Testing

Desktop tests cover source collisions, details caps, favorites/history persistence, redaction, batch locking, interrupted operations, rollback failure and IPC restart/authorization. Client tests cover confirmation, favorites, sorting, screenshots, untrusted README rendering, history, batch ids and approval failures. The owner-local preview fixture exercises the real component and theme sheets with fake mutations for viewport and interaction checks.

## Related

- [Desktop marketplace version updates](2026-09-07-desktop-marketplace-version-updates.md)

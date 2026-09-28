# Decision: Assemble runtime source instances and restore links after extraction

Status: implemented

[中文](2026-09-28-runtime-instance-layout.md) | English

## Problem

After restoring strict checks, the actual installation tree failed because two send peer instances merged. The old flattening model also splits shared dependencies into separate module-cache instances. Identical published files and local nesting cannot always express the original graph. The user then requested comprehensive repairs, authorizing the actual layout correction and remaining pre-release failures.

Record audit: the display and persistence decisions in the [partial rollback](2026-09-24-whale-performance-partial-rollback.en.md) remain valid; this decision replaces only its freeze on further dependency layout work. The [gate repair](../bug-fix/2026-09-28-packaging-identity-gates-and-ws.en.md) retains its strict identity requirements. Publication and production installer acceptance rules are unchanged.

## Decision

- Collect production dependencies, installed optional dependencies and peers by source-directory realpath. Visited instances bound cycles; missing required dependencies, test-only packages, budget exhaustion and target collisions fail.
- Workspace packages keep their original apps, packages and vendor relative locations to preserve relative resources. Each third-party source instance has one short directory keyed by a digest of its relative source path. Consumer edges and root package-name entries link to the corresponding unique directory.
- Version 1 of `.dsh-runtime-links.json` contains only root-relative path/target pairs. Build-time links support independent comparisons of published files and actual resolved edges. Remove links before archiving so tar contains ordinary files and the manifest. Restore links after extraction, before validation and the completion stamp.
- Windows uses directory junctions available to ordinary users; other platforms use directory symlinks. Restoration resolves against the new root without carrying build-machine absolute paths. Reject traversal, duplicates, replacement of ordinary directories and escaping parent links.
- Explicit deploy and full-source assembly share the same instance-graph validation. Keep identity counterexamples instead of adding exemptions or skipping checks.

## Alternatives considered

- Accept byte-identical merging or forced duplicates: this produces an installer but changes shared state, registries and type identity; rejected.
- Increase flattening consolidation passes: this cannot fix graphs without a suitable shared ancestor slot or distinguish merged sources; rejected.
- Archive absolute junctions directly: convenient to build but tied to the build machine. Relative Windows symlinks can require user privileges; rejected.
- Install custom Node resolution hooks: avoids filesystem links but creates new CommonJS, ESM, native-package and child-process resolution semantics; rejected.

## Consequences

The runtime gains a versioned assembly manifest and first-extraction link creation work in exchange for source-equivalent module identity. The closure still depends on declared dependencies and does not guarantee undeclared dynamic imports. Relocation rebuilds Windows junctions; the archive itself requires no symlink privileges. Older archives without a manifest retain their extraction path.

Verification covers real CJS sharing and isolation, cycles, tar relocation, rejected paths, extraction regressions and the complete runtime CLI. Results and release status live in the [release preparation report](../../../qa/results/2026-09-28-release-preflight/RELEASE-STATUS.md). Local packages do not replace acceptance of the exact CI Setup bytes.

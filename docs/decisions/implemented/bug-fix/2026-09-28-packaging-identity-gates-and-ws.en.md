# Decision: Restore package instance gates and declare the account runtime dependency

Status: implemented

[中文](2026-09-28-packaging-identity-gates-and-ws.md) | English

## Problem

The 0.3.3 preflight reproduced three assembly-gate defects: uncollapsible copies of one source instance were accepted, distinct byte-identical source instances could merge, and a successful consolidation that only deleted files was rejected because its copy count did not increase. Mutable-module probes demonstrate lost sharing and lost isolation. The account startup chain also loads `ws`, which was absent from the production manifest, lockfile and asar; an extra local installation masked this omission.

Record audit: the [partial rollback decision](../architecture/2026-09-24-whale-performance-partial-rollback.en.md) already requires identity errors to block builds; this change restores that gate without lifting actual layout blockers. The [manifest contract](../../proposed/bug-fix/2026-09-19-desktop-manifest-runtime-contract.en.md) retains its completeness rationale and gains a runtime-closure correction. [Plugin reuse](../../proposed/process/2026-09-22-packaging-plugin-reuse.en.md) concerns deep dependency closure rather than module identity and is not superseded. After reviewing the findings, the user explicitly authorized these three fixes and the ws manifest and lockfile update.

## Decision

1. Two distinct source instances mapped to one target instance always fail, even with identical files. An uncollapsible split of one source also fails, reporting its sources, targets and consolidation conditions.
2. Consolidation deletions and orphan cleanup both count as dependency-tree changes. Invalidate affected file, graph and visited caches and revalidate on the next pass; copied-file count is no longer the sole progress signal. Keep the twelve-pass bound.
3. Declare and lock `ws@8.21.3` as a root production dependency, matching the locally used version without changing other locked versions. Optional native acceleration peers remain optional.
4. Regression tests use real temporary packages and mutable objects to check sharing and isolation. Retain the three-consumer version-conflict counterexample and verify idempotence after deletion. The manifest test requires both a production declaration and an integrity-bearing ws lock entry.

## Alternatives considered

- Accept same-version, same-byte copies: this lets flattening finish but does not preserve module caches, registries or class identity; rejected.
- Only increase the repair-pass limit: this neither counts deletion as progress nor explains nonconverging graphs; rejected.
- Copy the local ws directory into the existing installation tree: this fills a temporary gap but leaves clean builds broken and changes tested bytes; rejected.
- Rewrite the dependency layout in the same change: this may address the actual packaging blocker, but exceeds this gate repair. Keep it separate and do not describe gate repair as layout repair.

## Consequences

Real dependency trees previously accepted in error now block builds again. This restores protection; it does not complete the release. Declaring ws fixes the confirmed account dependency omission, not every installer startup or product path. Existing GUI failures, exact CI commit requirements and production installer acceptance remain; publication is not triggered.

Verification: four regressions failed before the fix, then all 65 focused packaging, identity and manifest tests passed. Independent probes now reject splitting, reject merging and accept correct consolidation. Full tests, actual packaging and source restart results are recorded in the [release preparation report](../../../qa/results/2026-09-28-release-preflight/RELEASE-STATUS.md).

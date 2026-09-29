# Decision: Optional import does not take over cold start

Status: implemented

[中文](2026-09-29-optional-import-startup.md) | English

## Problem

An empty desktop session store plus shared skills triggered an import hold, sending new users to import even with automatic start enabled. This also displaced the failed-start home diagnostics. The user requested direct desktop entry instead of migration onboarding.

## Decision

Cold start does not probe optional sources. Normal automatic start opens the desktop; manual-start mode and a failed previous start explicitly select home. Interrupted import recovery, recovery errors and unresolved journals still hold at import. Manual import and read-only source protection remain unchanged.

## Alternatives considered

- Excluding only shared skills reduces false triggers, but optional official data still takes over startup; rejected.
- Skipping all import recovery always starts, but permits writes over unresolved transactions; rejected.
- Persisting an import-dismissed flag preserves the old guide, but adds state and still interrupts first start; rejected.

## Consequences

Users must deliberately discover import instead of relying on a first-run prompt. Regressions cover available sources, failed-start home, manual-start mode, unreadable sources and recovery holds. Installed builds require rebuilding to receive this behavior.

Record audit: the [v3 recognition repair](2026-09-23-v3-session-import-gate.en.md) partially overlaps; its format recognition remains, while this record replaces optional-data startup blocking. The [nonblocking update proposal](../../proposed/product/2026-09-22-nonblocking-startup-update.en.md) partially overlaps; parallel update checks remain unchanged.

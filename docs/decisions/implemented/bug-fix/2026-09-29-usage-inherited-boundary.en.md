# Decision: Use the host inherited prefix as the usage accounting boundary

Status: implemented

[中文](2026-09-29-usage-inherited-boundary.md) | English

## Problem

A real desktop conversation displayed 14,284 tokens, but the usage dashboard remained empty after reading four sessions without failures. The plugin ignored inheritedEventCount during projection initialization and waited for session/end-seed before counting. Restoring a session can append that marker after existing replies. The fallback scan selected the last marker and missed the same usage. The original usage records were intact.

Once nonzero statistics returned, repeated refreshes also reproduced double counting: deltaScan merged whole-session projections as deltas into the previous aggregate. A cache-probe miss or changed watermark appended the same session again, doubling 52,146 to 104,292 tokens.

Decision audit: [0.1.7 plugin contract drift](2026-09-25-vendored-plugins-017-contract-drift.en.md) partially overlaps but owns manifest and settings API adaptation; [repair decoder](../product/2026-09-25-usage-heatmap-graph-repair-codec.en.md) addresses damaged-log admission; [runtime links](../../proposed/architecture/2026-09-22-usage-panel-runtime-link.en.md) addresses mounting. The latter two do not own accounting boundaries. No desktop decision in proposed, implemented, or rejected owns this boundary fix; existing decisions remain in force.

## Decision

Projection init(header, inheritedEventCount) initializes the counting boundary from the host's zero-based inherited prefix. When explicit metadata exists, later end-seed markers cannot move that boundary; legacy callers without metadata retain marker semantics. Fallback scanning reads the same boundary from the readSession snapshot. Projection state advances to version 3, invalidating old zero-valued checkpoints and aggregate caches for recomputation from the original log.

Each refresh starts with an empty aggregate, reads current whole-session projections, and merges each session once. The old aggregate delta branch is removed. Per-session checkpoints, cooperative scan pacing, and overview caching remain. Newly added or deleted sessions are naturally reflected by the current scan.

## Alternatives considered

- Clear caches only: triggers another scan, but the old reducer returns zero again; rejected.
- Count every event: restores ordinary sessions but double-counts inherited parent usage in forks; rejected.
- Rewrite logs or move end-seed: healthy logs already have explicit host metadata; rewriting is unnecessary and risks damage; rejected.
- Add a per-session subtraction ledger to the old incremental path: saves scans but must undo every derived day, model, cost, and ranking field consistently. This fix reuses the existing full scan instead of introducing another aggregate state model.

## Consequences

Existing usage returns while fork deduplication remains intact. Only derived caches are recomputed on first read; session logs are not rewritten. Refreshes traverse current sessions in exchange for correct replacement, deletion, and stable repeated refreshes; per-session projections still reuse checkpoints. Regressions cover late markers, markerless owned usage, exact fork prefixes, fallback scanning, and repeated refresh, new usage, and deletion through the actual overview RPC. Plugin typecheck, 191 tests, and build pass. After restarting the desktop, three refreshes consistently report 52,146 tokens across two usage-bearing sessions, including the original conversation's 14,284 tokens.

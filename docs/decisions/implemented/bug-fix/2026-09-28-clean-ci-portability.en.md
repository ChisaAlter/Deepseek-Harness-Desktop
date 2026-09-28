# Decision: Clean CI build prerequisites and physical path consistency

Status: implemented

[中文](2026-09-28-clean-ci-portability.md) | English

## Problem

Remote tests for candidate 89850d10de0 exposed assumptions masked by local artifacts: shortcut and plugin compatibility tests consume upstream libraries that the desktop job did not build. The macOS /var and /private/var temporary-directory aliases caused false identity conflicts, broken relative links and import fault fixtures rejected before reaching their intended operations. Component paths and unreferenced drain timers also differed across platforms.

Record audit: the [instance layout](../architecture/2026-09-28-runtime-instance-layout.en.md) retains one directory per source; this change normalizes physical paths. [Task protection](../architecture/2026-09-25-task-protection-coordinator.en.md) must deliver drain outcomes without changing confirmation policy. [GUI reconciliation](2026-09-28-release-gui-contract-reconciliation.en.md) retains check strength while clean-runner prerequisites become explicit.

## Decision

- Desktop CI explicitly installs upstream dependencies and builds bridge libraries, with a budget covering that work. Tests consuming real bridges are not skipped. Source radius tests remain artifact-independent; built checks run after the vendor build.
- Instance assembly and comparison use physical roots. POSIX relative links are calculated from the physical parent to avoid treating aliases of one target as different instances.
- Workspace authority uses native synchronous realpath to agree with asynchronous file operations, avoiding false rejection of Windows 8.3 paths. It does not re-follow the authorized root during the privileged effect to accommodate aliases; external-link and .git rejection remain intact.
- Import and workspace fixtures use real temporary roots. Malicious child-link cases and production parent-link rejection remain strict. Media tests supply OS authorization facts and await asynchronous callbacks.
- Component entries reject Windows absolute and drive-relative paths on every host, normalize separators and then verify containment.
- Awaited drain timeouts retain a timer reference and clear it in finally, preserving the outcome without keeping an already drained operation alive. A standalone Node regression checks that the timer alone delivers the timeout result.
- The second CI round exposed absolute preview targets still using legacy realpath; preview normalization and editor/preview fixtures now use native spelling. Registry watching reconciles metadata every 2 seconds to recover missed native events, sharing debounce and the last delivered inode/size/nanosecond timestamps to avoid duplicate notifications. Stop clears polling. Deterministic missed-event and path-alias regressions fail before the fix and pass after it, without hiding defects behind longer waits.

## Alternatives considered

- Skip macOS or tests needing lib: this preserves clean-environment and platform defects; rejected.
- Allow every import parent link: this weakens data protection. Normalize fixture roots while retaining the production guard instead.
- Only increase the drain test timeout: this cannot help after the event loop has exited. Correct the timer lifetime.
- Only rerun watcher failures: this cannot guarantee native events on the next startup. Retain the low-latency native path and accept one stat every 2 seconds for single-file reconciliation.

## Consequences

Desktop CI spends more time building bridge contracts to exercise the real runtime interface. Link comparison and creation share physical coordinates; Windows still uses junctions. All 162 focused cases pass. Final platform results are recorded in the [release preparation report](../../../qa/results/2026-09-28-release-preflight/RELEASE-STATUS.md).

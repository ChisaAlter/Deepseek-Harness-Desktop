# Agent Note: User-patch transactions control filesystem event delivery

Status: implemented

English | [中文](2026-09-09-user-patch-hmr-test-delivery.zh.md)

## Problem

The [macOS Sandbox run](https://github.com/deepseek-harness/deepseek-harness/actions/runs/34238200206/job/102101292119) times out while waiting for the first user-patch addition. Concurrent local reproductions show no filesystem notification reaching HMR. A polling variant also misses a subsequent edit while HMR has no pending refresh. These failures prevent the transaction assertions from exercising the parser, activation, and rollback behavior they own.

## Decision

The [user-patch transaction test](../../../../packages/boot/app-boot/tests/user-patches.spec.ts) writes real patch files and delivers their add, change, and unlink events through a Chokidar watcher without native watch handles. HMR registration, refresh serialization, Include recomposition, plugin activation, failure broadcasting, rollback, and recovery remain real. The fixture restores its watcher factory and disposes the Context even when setup fails before the local cleanup block.

The separate [HMR config tests](../../../../packages/boot/app-boot/tests/hmr-config.spec.ts) own native notification delivery, including add/change/unlink, initially absent parents, and filesystem aliases. The transaction test does not establish operating-system delivery guarantees.

## Alternatives considered

**Native notifications for every transaction assertion.** Rejected because it repeats the native delivery dependency across each parser and activation state transition. A missing event obscures which downstream behavior is broken.

**Polling and fixed settling delays.** Rejected because neither acknowledges delivery of the next edit. Chokidar readiness does not expose completion of Node's asynchronous initial polling baseline; a local polling reproduction still misses changes. Increasing the test deadline cannot recover an event that was never emitted.

**Mock HMR registration or Include.** Rejected because the test must retain transactional recomposition and last-good-state assertions after activation and parse failures.

## Consequences

The transaction sequence retains every semantic assertion and removes fixed change-throttle sleeps. Independent concurrent processes exercise isolation, and a forced setup failure verifies watcher closure and factory restoration before the next case. Native watcher failures remain visible in their owning tests and require their own diagnosis.

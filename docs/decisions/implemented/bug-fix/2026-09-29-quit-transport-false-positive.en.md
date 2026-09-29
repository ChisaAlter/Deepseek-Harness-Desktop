# Decision: Ignore local transports and remove redundant quit confirmation

Status: implemented

[中文](2026-09-29-quit-transport-false-positive.md) | English

## Problem

Quitting an empty workspace reported three remote connections. Host inspection counted `upgradedSockets.size`, including local UI, account-watch and background-service streams. Observed peers were all 127.0.0.1 connections from desktop Electron processes. The user requested a counting fix and removal of redundant quit confirmation.

## Decision

Exclude destroyed sockets and loopback addresses (127/8, ::1, IPv4-mapped IPv6) using Node `BlockList`/`isIP`. External and unknown peers remain counted. Local agents/jobs/pending requests remain independently inspected; admission and drain are unchanged.

The shared `finalizeQuit` passes `preConfirmed: true`. Retain inspect→acquire→drain→reinspect→cleanup→shutdown, skipping only work-list confirmation. This covers close configured as quit, menu/tray quit and before-quit; close-to-tray preferences remain unchanged. Lock/drain failure still prevents commit and retains recovery feedback; restart/reload confirmations are unchanged. This expands the opt-in established for [launcher stop](../product/2026-09-27-launcher-stop-preconfirmed.en.md).

## Alternatives considered

Changing copy alone still marks idle internal streams as dirty. Removing confirmation alone leaves misleading counts elsewhere. Neither is sufficient.

Removing all socket counts hides external peers; exiting outside the coordinator bypasses admission/drain. Both are rejected.

## Consequences

Explicit quit no longer asks again before interrupting work. Normal shutdown still cleans resources and shuts down Harness rather than force-killing it. Local proxy forwarding cannot be distinguished by addresses alone, but active tasks remain independently inspected. Regressions cover address variants, unknown/external peers, real local sockets, retained active tasks, production quit wiring and no side effects on drain failure.

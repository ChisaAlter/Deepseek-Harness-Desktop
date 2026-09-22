# Agent Note: Phone remote hydrates after boot, then WebSocket downlinks

Status: implemented

English | [中文](2026-08-15-remote-sse-downlinks.zh.md)

## Problem

Phone remote loads the official web UI through the desktop HTTP reverse proxy. `WorkspaceRuntime` hydrates `session.list` only after `ConnectionController` marks connected. The controller opened `events.mux` and `events.host` before `host.describe`. Two long-lived HTTP downlinks occupy a mobile browser's per-origin HTTP/1.1 slots, so `host.describe` never starts, `onConnected` never fires, and the sidebar stays empty even though unary POST to the same origin returns the Host conversations. Session history is also unary (`session.history`); it never runs if the list handshake never completes. The Host store is not empty: a direct `session.list` against loopback and against the cookie-authenticated relay both return the live rows. A settled remote page on public HTTP is not a secure context: `crypto.randomUUID` is absent, `AbstractApiClient.mintRpcId` throws before `fetch`, and `host.describe` never leaves the client. `WebApiClient` mints through `randomUuid()` (`crypto.getRandomValues`). `connection.start` after `stop` creates a new loop. `client-hmr` opens `GET /plugins/events` only on loopback.

## Decision

`ConnectionController` does not start `host.describe` or either WebSocket until `window.__DSH_BOOT_GATE__` resolves. The shell creates that promise before any plugin `apply` and resolves it only after `loader.await()` — every `/plugins/*/client.js` script has loaded and every fiber is ACTIVE. Opening describe or two CONNECTING WebSockets during that download occupies a mobile browser's per-origin HTTP/1.1 slots, so remaining plugin scripts never finish, `loader.await()` never returns, and the boot spinner stays up for the life of the page. The runtime plugin calls `connection.start` only after that same promise (or immediately when the page has no gate). `start` after `stop` creates a new loop; a second `start` while a loop is running replaces it. `client-hmr` opens `EventSource('/plugins/events')` only on loopback. After the gate, the controller completes `host.describe`, awaits `onConnected` (the runtime waits for `session.list` and `workspace.list`), then opens the sockets. `WebApiClient` mints unary `rpcId`s with `randomUuid()` so public HTTP (no `crypto.randomUUID`) can still call `host.describe`. `WebApiClient` uses WebSocket on every origin, including the phone through the relay. Two HTTP SSE GETs are not the phone carrier. Ordinary network GETs to `/api/events.*` without `Accept: text/event-stream` still return 426.

## Alternatives considered

**Treat empty phone UI as a failed current-session restore.** Rejected: the Host list never arrived. Opening the latest row cannot help when `session.list` did not run.

**Open two SSE GETs on non-loopback instead of WebSocket.** Rejected: live relay probes show authenticated WebSocket upgrades succeed. SSE occupies the same HTTP/1.1 pool as `host.describe` / `session.list` / `session.history`; a mobile browser with few per-origin slots then shows no conversations.

**Wait for both stream onOpen before onConnected.** Rejected: that handshake lets a stuck downlink hide the unary store. Live frames still need the downlinks after connect; list and history do not.

**Leave `connection.start` one-shot and keep HMR SSE on the relay origin.** Rejected: a fiber remount after `stop()` then throws, so describe never runs on a settled page; the EventSource holds a long-lived HTTP GET through the single relay TCP.

## Consequences

Desktop Electron is unchanged aside from opening downlinks after the boot gate, describe, and `onConnected`. Phone remote finishes plugin boot first, then hydrates the Host list, then upgrades two WebSockets. Tests pin the boot gate, restartable `start`, loopback-only HMR EventSource, describe-before-downlinks, `onConnected`-promise-before-downlinks, and non-loopback `ws://` URLs.

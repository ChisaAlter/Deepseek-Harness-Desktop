# Agent Note: MCP settings polls live server state unconditionally

Status: implemented

English | [中文](2026-08-23-mcp-settings-live-tool-count.zh.md)

## Problem

The MCP settings page only polled `mcpServers.list` while some row reported `connecting`/`reconnecting`. A server connected outside the page's own actions — a composition row whose child finished its initial tool sync between polls, or a connection that appeared while nothing was in flight — never triggered another fetch, so its health and the "N tools" count stayed stale until an app restart.

## Decision

While the section is ready, poll `list` every two seconds unconditionally (`HEALTH_POLL_MS`), pausing only while a local mutation (toggle/sign-in) is pending. Late responses are still discarded by the existing load sequence guard. `inFlightHealth` was removed; the poll no longer depends on the previous snapshot.

## Alternatives considered

**A host-push event for status changes** — rejected. No Remote event channel exists for `mcpServers` today, and wiring one (emitter in the mcp-client status registry plus client subscriptions) is a wider contract change than the freshness gap justifies; the local Remote `list` is cheap.

**Poll only while connected rows lack a tool count** — rejected. A brand-new composition row is invisible in the stale snapshot, so conditional polling can never discover it.

## Consequences

- The page fetches a small in-process snapshot every 2s while mounted; the interval mirrors the pre-existing health poll cadence.
- Tool counts, health, and new direct-connect rows now appear within one poll tick without restarting the desktop app.

Related: [MCP and skill settings](../2026-08-14-mcp-and-skill-settings.md), [MCP tool registration survives child remounts](2026-08-23-mcp-remount-tools-strict-get.md).

# Agent Note: MCP tool registration survives child remounts via strict get

Status: implemented

English | [中文](2026-08-23-mcp-remount-tools-strict-get.zh.md)

## Problem

After a managed MCP server was disabled and re-enabled, its remounted `mcp-client` child connected and discovered tools but registered none: `syncTools` read `ctx.tools` through the property proxy and Cordis threw `cannot get property "tools" without inject`, so the registration rollback left the row "connected" with no tool count until the app restarted. The initial mount at startup worked; only post-startup remounts broke.

## Decision

`syncTools` resolves the registry through strict `ctx.get('tools')`, which reads the global service store instead of walking the caller's fiber chain, and throws a dedicated error when the registry is absent. The property proxy path is topology-sensitive (fiber-chain + isolation-map walk); the strict read is stable across remounts and keeps the same traceable/shadow service semantics. The plugin still declares `inject = ['tools']` so the Loader waits for the registry before activation.

## Alternatives considered

**Move the mcp-servers-file children to the host plane** — not applicable: the host row already mounts children on its own context, and the break is in the property-proxy resolution for late-mounted fibers, not in the service location.

**Re-resolve through `ctx.root.tools`** — rejected: `ctx.root` reaches past the isolation topology and would bind the wrong scope semantics for `tools.register()`'s agent-scope detection.

## Consequences

- Disable/enable and remount cycles now re-register the full tool generation; the settings row shows the live tool count without an app restart.
- The strict read returns `undefined` when the registry is absent, so a miscomposed runtime fails with an explicit message instead of the proxy's topology error.

Related: [MCP and skill settings](../2026-08-14-mcp-and-skill-settings.md).

# Server Module Handoff

## Role

`@chisacode/server` is the local daemon. It owns agent lifecycle, WebSocket sessions, provider adapters, file-backed state, MCP tools, terminal services, loops, schedules, chat rooms, relay transport, and daemon configuration.

## Owned Surfaces

- Daemon bootstrap and WebSocket server.
- Session routing and per-client capability handling.
- Agent manager, storage, timelines, archive behavior.
- Provider registry, provider launch config, diagnostics, and runtime adapters.
- MCP server for agent-to-agent control.
- Relay transport from the daemon side.

## Dependencies

`server` depends on `protocol`, `client`-adjacent shared contracts, `relay`, and `highlight`. It should not depend on app UI implementation or desktop renderer details.

## Downstream Consumers

- `app`, `cli`, and `desktop` observe daemon behavior through protocol/client paths.
- Agents and MCP clients interact with daemon-exposed control surfaces.

## Common Work

- Add or change an agent provider.
- Change lifecycle, archive, or timeline semantics.
- Add a daemon RPC handler.
- Change daemon config or provider snapshots.
- Add MCP tools or background services.

## Invariants

- Agent state is daemon-owned and persisted under `CHISACODE_HOME`.
- Timeline fetch is authoritative; live stream is immediate but not the only correctness path.
- Do not restart the main daemon on `localhost:6767` without explicit permission.
- Providers handle their own authentication.
- Storage changes must consider existing JSON records.

## Cross-Cutting Docs

- `docs/cross-cutting/daemon-agent-lifecycle.md`
- `docs/cross-cutting/provider-plumbing.md`
- `docs/cross-cutting/websocket-rpc-protocol.md`
- `docs/cross-cutting/relay-security-boundaries.md`

## Verification

```bash
npm run build:server
npm run typecheck --workspace=@chisacode/server
npm run lint -- packages/server
```

Run only targeted server Vitest files. Real-provider tests require credentials and should not be run casually.

## Graph

Generated graph: `docs/modules/server/knowledge-graph.json`

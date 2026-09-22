# Client Module Handoff

## Role

`@chisacode/client` owns the daemon WebSocket driver and the higher-level `ChisaCodeClient` facade. It is the shared transport boundary between daemon protocol messages and app/CLI/desktop consumers.

## Owned Surfaces

- Direct WebSocket transport.
- Relay E2EE transport integration.
- Request/response correlation and timeout behavior.
- Terminal stream routing.
- SDK-shaped facade exports.

## Dependencies

`client` depends on `protocol` and may depend on `relay` transport primitives. It should not import app screens, server internals, or desktop-only APIs.

## Downstream Consumers

- `app` uses it for host/session runtime state.
- `cli` uses it for command operations.
- `desktop` uses it through the renderer and local daemon connection paths.

## Common Work

- Add a typed helper for a new RPC.
- Adjust reconnect, liveness, or timeout behavior.
- Add relay/direct transport parity.
- Route terminal or file-transfer binary frames.

## Invariants

- Client liveness uses the portable JSON ping/pong envelope, not RFC6455 protocol ping.
- Operation timeouts are not proof that the socket is dead.
- The client should hide transport differences from consumers where possible.
- Do not reintroduce app or daemon internals into the shared client facade.

## Cross-Cutting Docs

- `docs/cross-cutting/websocket-rpc-protocol.md`
- `docs/cross-cutting/daemon-agent-lifecycle.md`
- `docs/cross-cutting/relay-security-boundaries.md`

## Verification

```bash
npm run build:client
npm run typecheck --workspace=@chisacode/client
npm run lint -- packages/client
```

For changed tests, run the specific Vitest file only.

## Graph

Generated graph: `docs/modules/client/knowledge-graph.json`

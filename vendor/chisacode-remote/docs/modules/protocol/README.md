# Protocol Module Handoff

## Role

`@chisacode/protocol` is the shared wire contract. It owns WebSocket message schemas, shared protocol types, provider config schemas, binary frame codecs, endpoint parsing, and compatibility constants consumed by server, client, app, CLI, and desktop.

## Owned Surfaces

- Session message schemas and top-level WebSocket envelopes.
- Provider and runtime config schemas shared across packages.
- Binary frame codecs for terminal and file-transfer streams.
- Compatibility flags and append-only schema defaults.

## Dependencies

This module should stay low in the dependency graph. It may use schema/runtime utilities, but it must not depend on daemon, app, CLI, or desktop behavior.

## Downstream Consumers

- `server` validates and emits protocol messages.
- `client` correlates requests, responses, and stream frames.
- `app`, `cli`, and `desktop` consume protocol-visible state through client/server paths.

## Common Work

- Add a new RPC message pair.
- Add optional fields to existing messages.
- Extend provider config schemas.
- Update binary frame codecs.
- Add compatibility constants or feature flags.

## Invariants

- Schemas are append-only.
- New fields must be optional, defaulted, or transformed from older shapes.
- Do not remove fields, narrow accepted values, or make optional fields required.
- New RPC names use dotted namespaces with `.request` and `.response`.

## Cross-Cutting Docs

- `docs/cross-cutting/websocket-rpc-protocol.md`
- `docs/cross-cutting/provider-plumbing.md`
- `docs/cross-cutting/daemon-agent-lifecycle.md`

## Verification

```bash
npm run build:client
npm run typecheck --workspace=@chisacode/protocol
npm run lint -- packages/protocol
```

For changed tests, run the specific Vitest file only.

## Graph

Generated graph: `docs/modules/protocol/knowledge-graph.json`

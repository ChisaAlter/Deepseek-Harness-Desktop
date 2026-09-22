# Relay Module Handoff

## Role

`@chisacode/relay` owns the encrypted remote bridge between clients and daemons. It provides E2EE channel primitives, relay server adapters, crypto helpers, and handshake behavior.

## Owned Surfaces

- Client and daemon encrypted channel APIs.
- Relay server transport/adapters.
- Crypto primitives and base64 helpers.
- Handshake parity and E2E tests.

## Dependencies

`relay` should remain a transport/security module. It should not own agent lifecycle semantics, app UI state, or daemon storage.

## Downstream Consumers

- `server` uses relay transport for outbound daemon connectivity.
- `client` uses relay transport for remote client connectivity.
- `app` and `desktop` expose relay-backed host workflows.

## Common Work

- Adjust encrypted channel behavior.
- Change relay deployment adapters.
- Update pairing or handshake compatibility.
- Improve relay latency or transport diagnostics.

## Invariants

- Relay is payload-confidential (metadata still visible) by design.
- Encryption and pairing changes need security review.
- Direct and relay transports should preserve client-facing API parity.
- Remote access must not weaken local-first guarantees.

## Cross-Cutting Docs

- `docs/cross-cutting/relay-security-boundaries.md`
- `SECURITY.md`
- `docs/security/relay-auth-handshake-v2-threat-model.md`
- `docs/security/production-hardening-current-state-2026-08-10.md`
- `docs/cross-cutting/websocket-rpc-protocol.md`

## Verification

```bash
npm run typecheck --workspace=@chisacode/relay
npm run lint -- packages/relay
```

Run targeted relay tests for changed crypto, channel, or adapter files.

## Graph

Generated graph: `docs/modules/relay/knowledge-graph.json`

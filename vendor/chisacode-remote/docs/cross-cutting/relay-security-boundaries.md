# Relay Security Boundaries

Use this when changing relay connection behavior, pairing, encryption, key exchange, relay deployment adapters, or remote access UX.

## Modules

- `relay`: encrypted channel primitives, relay server adapters, handshake behavior.
- `server`: daemon relay transport and daemon identity.
- `client`: relay E2EE transport and remote WebSocket abstraction.
- `app`: pairing, remote host UX, connection state.
- `desktop`: local daemon and desktop-hosted remote workflows.

## Existing Docs

- `SECURITY.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/security/relay-auth-handshake-v2-threat-model.md`
- `docs/security/production-hardening-current-state-2026-08-10.md`

## Invariants

- Relay is designed as a payload-confidential (metadata still visible) encrypted bridge.
- Threat-model changes need security review, not only typecheck.
- Pairing transfers daemon identity assumptions to clients.
- Direct and relay transport should preserve the same client-facing API where possible.
- Remote access work must not weaken local-first guarantees.

## Handoff Checklist

1. Read `SECURITY.md`, the Relay threat model, and the current hardening state before editing.
2. Identify whether the change affects cryptography, transport routing, deployment, or UX only.
3. Preserve direct/relay API parity unless intentionally changing the contract.
4. Add targeted tests around handshake, encryption, and transport behavior.
5. Ask for security review before treating the change as ready.

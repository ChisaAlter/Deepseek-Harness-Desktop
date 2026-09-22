# WebSocket RPC Protocol

Use this when adding, renaming, or migrating WebSocket messages, binary frames, request/response pairs, feature gates, or compatibility shims.

## Modules

- `protocol`: schemas, constants, binary codecs, compatibility defaults.
- `server`: session routing and producer behavior.
- `client`: transport, correlation, timeouts, relay/direct abstraction.
- `app`: feature usage and capability handling.
- `cli`: command usage and response rendering.
- `desktop`: desktop client wiring and managed daemon assumptions.

## Existing Docs

- `docs/rpc-namespacing.md`
- `docs/architecture.md`
- `docs/development.md`

## Invariants

- New RPC names use dotted namespaces with `.request` and `.response`.
- Protocol schemas are append-only. New fields are optional or defaulted.
- Old clients and daemons must still parse new messages.
- New features may require capability gates, but the protocol itself stays parse-compatible.
- Back-compat shims must be marked with `COMPAT(...)` and a cleanup target.

## Handoff Checklist

1. Define the protocol shape first.
2. Add server routing and client correlation second.
3. Add app/CLI consumer behavior after the wire contract is fixed.
4. Rebuild producer packages before diagnosing downstream type errors.
5. Test the changed message pair with targeted tests.

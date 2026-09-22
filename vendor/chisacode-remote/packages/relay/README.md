# @chisacode/relay

E2E encrypted relay for remote ChisaCode connections. Bridges daemon and client connections through Cloudflare Workers with X25519 key exchange and XSalsa20-Poly1305 encryption.

## Exports

- `startRelayServer` — Start a relay server
- `connectToRelay` — Connect to a relay as a client
- `e2eeEncrypt` / `e2eeDecrypt` — End-to-end encryption utilities

## Build

```bash
npm run build
```

## Typecheck

```bash
npm run typecheck
```

## Test

```bash
npm run test
```

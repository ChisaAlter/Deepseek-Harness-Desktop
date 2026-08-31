# chisacode-remote — Deepseek-Harness-Desktop fork

Vendored from [ChisaCode](https://github.com/ChisaAlter/ChisaCode) (`packages/{protocol,relay,server,client,highlight,cli,app}`) under **AGPL-3.0-or-later**. See `LICENSE` and `NOTICE`.

## Product role

Desktop remote pairing is the **full** ChisaCode stack:

1. `createChisaCodeDaemon` (`packages/server`) — not a hello/handshake slice
2. Cloudflare Worker relay (`packages/relay`) — self-hosted; never ship `relay.chisacode.sh` or their `account_id`
3. Protocol offer v2 + client E2EE (`packages/protocol`, `packages/client`)
4. Phone = same-protocol client (pairing / reconnect / deviceSecret store / session via `DaemonClient`)

MIT shell chrome (settings copy, Electron IPC) stays MIT. AGPL covers this tree and any modified Worker you deploy.

## Defaults (DSH)

| Knob | Env / file | Notes |
| --- | --- | --- |
| Relay host | `CHISACODE_RELAY_ENDPOINT` / `defaults.json` | **Built-in** `125.124.85.212:8411` (TLS off) |
| App base (QR URL) | `CHISACODE_APP_BASE_URL` | Same host by default |
| Home | `userData/chisacode-home` | Sticky device secrets until user 解除 |

## Packaging

- Electron main uses dynamic `import()` of ESM server exports (or `ELECTRON_RUN_AS_NODE` supervisor).
- Source start builds missing/stale server artifacts before Electron launches.
- Packaged builds run `scripts/prepare-chisacode-remote.mjs --force --runtime`; `extraResources` include the built package tree plus a production-only `node_modules`, and `afterPack` imports the shipped server API as a release gate.
- Corresponding source for AGPL network use: this directory in the public repo / release source archive.

## Fork deltas (packages/server)

- `agent/providers/dsh-agent.ts` — `resolveDshVendorDir` passes explicit `stdio: ["ignore","pipe","pipe"]` to `execSync("npm root -g")`. Node only forwards the child's stderr to `process.stderr` when `stdio` is omitted; in the desktop GUI that fd is often a broken pipe and the forwarded write escapes as an uncaught EPIPE (observed crash). `DSH_VENDOR_PACKAGES` is exported so the shell can decide when its bundled harness qualifies as `CHISACODE_DSH_VENDOR_DIR`.
- `exports.ts` — re-exports `DSH_VENDOR_PACKAGES` for the shell (see `src/main/chisacode-remote.js`).

## Fork deltas (packages/client)

- `daemon-client.ts` / `daemon-client-checkout-subscriptions.ts` / `daemon-client-agent-interaction.ts` — bare `crypto.randomUUID()` call sites route through the existing `safeRandomId()` (`daemon-client-transport-utils.ts`). The desktop pairing page is `http://<lan-ip>:3180` — **not a secure context** — so browsers do not expose `crypto.randomUUID` there (localhost QA masks this; real phones hit it). The E2EE stack itself is tweetnacl and never needs `crypto.subtle`. Same rule for new client code: no secure-context-only crypto APIs.

## Do not

- Point production at `relay.chisacode.sh` / `app.chisacode.sh` / ChisaCode Cloudflare `account_id`
- Ship a “pairing-only” daemon stub
- Keep DSH HTTP `RemoteGateway` / offer v1 as the main phone path

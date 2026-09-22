# Security

ChisaCode follows a client-server architecture, similar to Docker. The daemon runs on your machine and manages your coding agents. Clients (the mobile app, CLI, or web interface) connect to the daemon to monitor and control those agents.

ChisaCode is local-first: the daemon runs on your machine. Relay traffic is end-to-end encrypted, but message metadata (size, timing, serverId) can still be observed by the relay, and prompts/code may be sent to user-selected model providers/gateways.

## Architecture

The ChisaCode daemon can run anywhere you want to execute agents: your laptop, a Mac Mini, a VPS, or a Docker container. The daemon listens for connections and manages agent lifecycles.

Clients connect to the daemon over WebSocket. There are two ways to establish this connection:

- **Relay connection** — The daemon connects outbound to our relay server, and clients meet it there. No open ports required.
- **Direct connection** — The daemon listens on a network address and clients connect directly.

## Relay threat model

For the dated implementation/rollout snapshot, see [Production Hardening Current State](docs/security/production-hardening-current-state-2026-08-10.md). It records the default-auth policy, recovery override, credential storage boundaries, and the explicitly unverified real-surface checks.

The relay is designed to be untrusted. Application traffic between your phone and daemon is end-to-end encrypted. The relay cannot read encrypted messages or alter encrypted payloads without detection. It can still observe metadata, drop connections, or tamper with plaintext handshake frames to cause denial of service. With the default device-auth policy enabled, it cannot turn those actions into an authorized daemon session.

### How it works

1. The daemon generates a persistent Curve25519 keypair on first run and stores it at `$CHISACODE_HOME/daemon-keypair.json` with mode `0600`
2. The pairing URL (rendered as a QR code or opened directly) carries the daemon's public key in its URL fragment (`https://app.chisacode.sh/#offer=...`). Fragments are not sent to the web server, so `app.chisacode.sh` never sees the key.
3. When the phone connects via the relay, it generates a fresh ephemeral Curve25519 keypair and sends an `e2ee_hello` message containing its public key. The daemon returns a fresh authentication challenge with `e2ee_ready`.
4. Both sides perform a Curve25519 ECDH key exchange to derive a shared key. The first encrypted application hello must pair with a one-time token or prove a per-device secret over the daemon identity, the daemon challenge, and the actual client E2EE public key. The daemon will not process commands before this device-auth gate succeeds.
5. All subsequent messages are encrypted with XSalsa20-Poly1305 (NaCl `box`). The wire format is `[24-byte nonce][ciphertext]`, base64-encoded as a WebSocket text frame.

The relay sees IP addresses, timing, message sizes, the stable `serverId` routing key, connection/session identifiers such as `connectionId`, and the plaintext `e2ee_hello` / `e2ee_ready` handshake frames (the ephemeral client public key and a random challenge). Daemon control/data sockets also expose their URL `role`/version and relay-auth fields (public key, nonce, issue time, and signature) to the relay. It cannot read the encrypted device proof or pairing token, forge encrypted application messages, or derive encryption keys from observing the handshake. A compromised relay can still alter plaintext handshake frames to deny service, but the channel-binding check prevents that alteration from becoming an authenticated daemon session under the default policy.

Relay device authentication is required by default. `CHISACODE_RELAY_ALLOW_UNAUTHENTICATED_RECOVERY=1` is an emergency, fail-visible compatibility override for old clients; enabling it accepts only an unauthenticated legacy hello and never upgrades an incomplete device claim to an authenticated identity. The override is scheduled for removal after 2026-11-10.

Per-device secrets are excluded from the host registry. Android and iOS persist them through Expo SecureStore (Keystore/Keychain); Electron encrypts them with `safeStorage` and rejects Linux's unprotected `basic_text` backend; browser web keeps them in session memory only and therefore requires re-pairing after a page reload.

Relay v2 daemon sockets are authenticated before the relay accepts them as `role=server`.
Each daemon persists an Ed25519 relay-auth signing key alongside its E2EE keypair. Server-control and server-data WebSocket URLs include a nonce, issue time, and signature over the server id, role, connection id, nonce, and issue time. The relay rejects missing, invalid, expired, future-dated, or replayed credentials by default, persists the short replay window in Durable Object storage across hibernation, and will not let a socket signed by a different relay-auth public key replace an existing daemon socket for the same relay session. Legacy unsigned server sockets require the explicit `RELAY_ALLOW_UNSIGNED_SERVER_AUTH=1` Worker opt-in.

### Relay Encryption Security Semantics

- **Key exchange**: Static ECDH (Elliptic Curve Diffie-Hellman) with Curve25519. The daemon generates a persistent key pair on first run. Each client connection generates a fresh ephemeral key pair. The shared secret is derived from the daemon's private key and the client's public key (and vice versa).

- **Forward secrecy**: NOT provided. If a long-term private key is compromised, ALL past sessions encrypted with that key can be decrypted. This is the standard limitation of static ECDH. We accept this trade-off because: (1) keys are generated per-daemon-installation, not per-device or per-account; (2) the relay itself is untrusted and cannot decrypt messages regardless; (3) adding ephemeral key exchange (ECDHE) would require additional round-trips per connection, conflicting with the QR-based pairing UX that completes in a single scan.

- **Message authentication**: Provided by Poly1305 MAC embedded in XSalsa20-Poly1305 (NaCl box). Tampered ciphertext will fail authenticated decryption with an error.

- **Nonce selection**: Each channel direction generates a random 16-byte salt from the OS CSPRNG and appends an 8-byte little-endian sequence counter. The receiver locks to the first salt and requires strictly increasing sequence numbers, so nonce reuse, regression, and replay are rejected.

### Why the relay can't attack you

The daemon requires a valid cryptographic handshake and, for Relay connections, a device-auth proof before processing commands. A compromised relay cannot:

- **Impersonate the daemon to your phone** — Without the daemon's secret key, it cannot derive the shared key, so any traffic it injects fails authenticated decryption on the phone
- **Send commands as you** — The daemon requires a one-time pairing token or an HMAC from a previously paired device. That proof is bound to the daemon-issued challenge and the actual ephemeral client key accepted by the E2EE channel, so a relay cannot substitute its own client key and reuse the proof.
- **Read your traffic** — All messages are encrypted with XSalsa20-Poly1305 (NaCl box) after the handshake
- **Forge messages** — NaCl box provides authenticated encryption; tampered messages are rejected
- **Replay old messages across sessions** — Each session derives fresh encryption keys, so ciphertext from one session cannot be replayed into another session. Within a live session, replay protection is enforced: each direction maintains a monotonic 64-bit sequence counter and a per-direction random 16-byte salt locked to the first encrypted frame; the 24-byte nonce is derived as `salt(16)+seq(8)` (little-endian). Reuse, regression, or salt tampering causes a fatal `1011` close — the encrypted channel aborts rather than accept a replayed frame.

### Trust model

The QR code or pairing link is the trust anchor. It contains the daemon's public key, which is required to establish the encrypted connection. Treat it like a password — don't share it publicly.

## Local daemon trust boundary

By default, the daemon binds to `127.0.0.1`. With no password configured, the local control plane is trusted by network reachability — anything that can reach the daemon socket can control the daemon. This is the same security model Docker documents for its daemon: the security boundary is access to the socket or listening address.

The daemon also supports an optional shared-secret password (set via `auth.password` in `config.json` or the `CHISACODE_PASSWORD` env var; stored bcrypt-hashed). When configured, every HTTP request must carry `Authorization: Bearer <password>` and every WebSocket upgrade must include a `Sec-WebSocket-Protocol: chisacode.bearer.<password>` subprotocol. Browser WebSocket cannot set custom headers, which is why the token rides in the subprotocol. Health (`GET /api/health`) and CORS preflight (`OPTIONS`) are exempt. The password is intended for direct-TCP exposure (e.g. `tcp://host:port?ssl=true&password=...`); it is **not** a substitute for the relay's E2E encryption when traversing untrusted networks.

Connected clients are trusted operators of the daemon user. File previews follow that authority: a preview request may read any regular file the daemon process can read, while keeping path normalization and symlink checks in the daemon file service. Workspace-relative paths remain a UI convenience, not a security boundary.

If you expose the daemon beyond loopback, such as by binding to `0.0.0.0`, forwarding it through a tunnel or reverse proxy, or publishing it from a Docker container, you are responsible for restricting and securing that access. Setting a password is strongly recommended in that case.

For remote access, use the relay connection. It is the supported path for reaching the daemon off-machine, and it adds end-to-end encryption plus a pairing handshake before commands are accepted.

Host header validation and CORS origin checks are defense-in-depth controls for localhost exposure. They help block DNS rebinding and browser-based attacks, but they do not replace network isolation.

## DNS rebinding protection

CORS is not a complete security boundary. It controls which browser origins can make requests, but does not prevent a malicious website from resolving its domain to your local machine (DNS rebinding).

ChisaCode validates the complete `Host` authority on every HTTP request and every WebSocket upgrade. By default, only `localhost`, `*.localhost`, and loopback IP literals (`127.0.0.0/8`, `::1`, and IPv4-mapped loopback addresses) are accepted. LAN, VPN, public, and other non-loopback IP addresses must be added explicitly through `hostnames` in `config.json` or `CHISACODE_HOSTNAMES` (comma-separated); the same applies to custom DNS names. Entries beginning with `.` match a domain and its subdomains. The value `true` disables allowlist filtering, but malformed authorities, invalid ports, missing hosts, and suffix-smuggling forms remain rejected. Requests with unrecognized hosts are rejected with `403 Host not allowed`.

## Agent authentication

ChisaCode wraps agent CLIs (Claude, Codex, OpenCode, Pi, Kimi Code, and Grok Build) but does not manage their authentication. Each agent provider handles its own credentials. Provider API keys may be stored locally in daemon configuration and transmitted to user-selected upstream providers/gateways when those integrations are enabled. Keys are not sent to the ChisaCode relay as plaintext application payloads. Agents run in your user context with your existing credentials.

## Reporting vulnerabilities

If you discover a security vulnerability, please report it privately by emailing hello@moboudra.com. Do not open a public issue.

---
title: Security
description: "Security model for ChisaCode: architecture overview, connection methods, relay encryption, and best practices."
nav: Security
order: 12
---

# Security

ChisaCode follows a client-server architecture, similar to Docker. The daemon runs on your machine and manages your coding agents. Clients (the mobile app, CLI, or web interface) connect to the daemon to monitor and control those agents.

ChisaCode is local-first: the daemon runs on your machine. Relay traffic is end-to-end encrypted, but metadata may be visible to the relay and prompts may go to user-selected providers.

## Architecture

The ChisaCode daemon can run anywhere you want to execute agents: your laptop, a Mac Mini, a VPS, or a Docker container. The daemon listens for connections and manages agent lifecycles.

Clients connect to the daemon over WebSocket. There are two ways to establish this connection:

- **Relay connection (recommended)**, The daemon connects outbound to our relay server, and clients meet it there. No open ports required.
- **Direct connection**, The daemon listens on a network address and clients connect directly.

## Relay connections (recommended)

The relay is the simplest way to connect from your phone. It requires no VPN setup, no port forwarding, and no firewall configuration. The daemon can stay bound to localhost or a socket file, it connects _outbound_ to the relay, and your phone meets it there.

> **The relay is designed to be untrusted.** Encrypted application traffic between your phone and daemon is end-to-end encrypted. The relay cannot read or modify those encrypted payloads without detection, but it can observe routing metadata and tamper with the plaintext E2EE handshake to cause a denial of service. With the default device-auth policy enabled, that tampering cannot become an authorized daemon session.

### How it works

1. The daemon generates a persistent ECDH keypair and stores it in `$CHISACODE_HOME/daemon-keypair.json`
2. A pairing offer carries the daemon's public key and a short-lived, one-time bootstrap token
3. Your phone generates a fresh ephemeral keypair and sends its public key in `e2ee_hello`
4. The daemon completes Curve25519 ECDH and returns a fresh per-channel challenge in `e2ee_ready`
5. The first encrypted hello carries either the bootstrap token or a per-device HMAC proof. Both are bound to the actual client public key and daemon challenge before the daemon creates or resumes a session.
6. All subsequent messages are encrypted with XSalsa20-Poly1305 (NaCl `box`).

The relay can observe IP addresses, timing, message sizes, the stable `serverId`, `role`/version, `connectionId`, and the daemon server-socket authentication query fields (public key, nonce, issue time, and signature). It also sees the plaintext `e2ee_hello` / `e2ee_ready` frames. It cannot read encrypted application contents, pairing tokens, or HMAC proofs, and it cannot derive encryption keys from the handshake.

### Why the relay can't attack you

With the default device-auth policy, the daemon requires both the cryptographic handshake and a valid device-auth gate before processing commands. A compromised relay cannot:

- **Send commands**, It cannot substitute a client key or reuse a pairing token/proof because the device-auth proof is bound to the daemon challenge and the actual E2EE client key. An old client connecting to a new daemon is rejected unless the daemon operator explicitly enables the emergency recovery override `CHISACODE_RELAY_ALLOW_UNAUTHENTICATED_RECOVERY=1`
- **Read your traffic**, All messages are encrypted with XSalsa20-Poly1305 (NaCl `box`) after the handshake
- **Forge messages**, NaCl `box` provides authenticated encryption; tampered messages are rejected
- **Replay old messages**, Each session derives fresh encryption keys

### Trust model

The QR code or pairing link is the trust anchor. It contains the daemon's public key, which is required to establish the encrypted connection. Treat it like a password, don't share it publicly.

Treat the pairing offer like a password: anyone who obtains an unexpired offer can enroll one device. Restarting the daemon alone does not rotate its persisted server identity or E2EE keypair, and does not invalidate an unconsumed bootstrap token. The token is one-time and short-lived (10 minutes by default); clear the affected device credential when possible, wait for a compromised unconsumed token to expire, and then issue a new pairing offer.

## Direct connections

By default, the daemon listens on `127.0.0.1:6767` (localhost only). This is safe for local CLI usage but not reachable from your phone or other devices.

### Socket file (CLI only)

For maximum isolation, you can configure the daemon to listen on a Unix socket file instead of a TCP port. This prevents any network access entirely, only processes on the same machine can connect. The CLI supports this mode, but the mobile app and web interface require a network connection.

### VPN access

If you prefer direct connections over the relay, you can use a VPN like [Tailscale](https://tailscale.com). Tailscale creates a private network between your devices, so you can access your daemon without exposing it to the public internet.

To set this up:

1. Install Tailscale on your machine and phone and join them to the same [tailnet](https://tailscale.com/kb/1136/tailnet)
2. Configure the daemon to listen on your Tailscale IP (e.g., `100.x.y.z:6767`)
3. Add your Tailscale hostname to `hostnames` and `cors.allowedOrigins`
4. Add the daemon as a direct connection in the ChisaCode app using the Tailscale address

### Binding to 0.0.0.0

> **Warning:** Binding to `0.0.0.0` makes the daemon reachable on all network interfaces, including public Wi-Fi and local networks. This can expose your daemon to unauthorized access. If you must bind to all interfaces, ensure you have proper firewall rules and review your `hostnames` configuration.

## DNS rebinding protection

**CORS is not a complete security boundary.** It controls which browser origins can make requests, but does not prevent a malicious website from resolving its domain to your local machine (DNS rebinding).

ChisaCode uses a host allowlist to validate the `Host` header on incoming requests. Requests with unrecognized hosts are rejected.

Configure via `daemon.hostnames` in `config.json`:

- Default (`[]`): allow `localhost`, `*.localhost`, and all IP addresses
- `['.example.com']`: allow `example.com` and any subdomain, plus defaults
- `true`: allow any host (not recommended)

## Password authentication

By default, anyone who can reach the daemon's listening address can connect. On localhost this is fine, only local processes have access. But if you bind to a network interface (e.g. your LAN IP or `0.0.0.0`), or if you don't fully trust your local network, you can require a password.

When a password is configured, all HTTP requests must include an `Authorization: Bearer <password>` header and all WebSocket connections must authenticate via subprotocol. Unauthenticated requests receive a `401 Unauthorized` response. Only the `/api/health` liveness endpoint is exempt, so that process supervisors and load balancers can probe without credentials.

The password is stored as a bcrypt hash in `config.json`, the daemon never stores it in plaintext. See [Configuration](/docs/configuration#password-authentication) for setup instructions.

### What password auth does and does not do

- **Does:** Prevents unauthorized clients from controlling your agents, even if they can reach the daemon over the network.
- **Does not:** Encrypt traffic. Password auth protects access, not confidentiality. If you need encrypted connections over an untrusted network, use the relay (which provides end-to-end encryption) or a VPN like Tailscale.

### When to use it

- You want to bind the daemon to a LAN or Tailscale address and restrict who can connect.
- You don't fully trust your local network (shared office, public Wi-Fi with a VPN, etc.).
- You're exposing the daemon via a reverse proxy and want an additional authentication layer.

We still recommend the relay for mobile access, it combines authentication with end-to-end encryption out of the box. Password auth is primarily useful for direct LAN or VPN connections where you want access control without the relay.

## Agent authentication

ChisaCode wraps agent CLIs but does not manage their authentication. Each agent provider handles its own credentials:

- **Claude**, authenticates via Anthropic's OAuth flow or local Claude configuration
- **Codex**, uses your OpenAI API key or OAuth session
- **OpenCode**, configured via provider-specific API keys
- **Pi**, uses the Pi runtime's own authentication and configuration
- **Kimi Code**, uses the Kimi CLI's own authentication and configuration
- **Grok Build**, uses the Grok runtime's own authentication and configuration

Provider API keys may be stored locally and sent to user-selected upstream providers/gateways when enabled. Agents run in your user context with your existing credentials.

## Recommendations

- **Use the relay** for mobile access, it's the simplest option and all traffic is end-to-end encrypted
- **Treat the QR code like a password**, anyone with the pairing offer can connect to your daemon
- **Set a password** if you bind to a network address, it prevents unauthorized clients from controlling your agents
- **Never bind to 0.0.0.0 without a password**, without one, any device on your network can connect
- **Keep your daemon updated**, security improvements are released regularly

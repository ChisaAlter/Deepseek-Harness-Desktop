# Relay Auth Handshake v2: Threat Model and ADR

- Status: implemented in the current hardening worktree; runtime rollout evidence remains open
- Date: 2026-08-10
- Scope: Relay client identity, pairing migration, session resume, and credential storage
- Current-state companion: [Production Hardening Current State](production-hardening-current-state-2026-08-10.md)

## Problem

Relay E2EE protects confidentiality and ciphertext integrity, but ECDH alone does not prove which client supplied the ephemeral public key. An attacker who obtains a connection offer can otherwise complete a fresh E2EE channel and attempt daemon session access.

The threat model treats the relay as fully controlled by an attacker. The relay may delay, drop, reorder, replay, replace, or terminate frames. It can observe routing metadata and the plaintext E2EE handshake, but it cannot read encrypted application payloads or access the client platform secret store.

## Trust boundaries

| Actor             | Trust assumption                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local daemon      | Trusted operator process; holds the persistent daemon key and the server-side device credential store                                                              |
| Paired client     | Holds a per-device secret in platform secure storage, or a one-time pairing token during first pairing                                                             |
| Relay             | Untrusted for payload confidentiality and client identity; it is only a byte forwarder                                                                             |
| Offer holder      | Possesses the daemon public key, server id, endpoint, and possibly a short-lived one-time pairing token; a live token is a one-device bearer enrollment capability |
| Direct/local peer | Trusted by network reachability under the existing daemon security model; this ADR does not authenticate direct/local sockets                                      |

Relay-auth Ed25519 authenticates daemon-to-relay control/data sockets. It does not authenticate a client and is not used as client identity proof.

## Relay-visible metadata

Even with E2EE payload confidentiality, the relay can observe:

- stable `serverId` routing key;
- socket role and Relay protocol version;
- connection id and reconnect correlation;
- connection open/close times and duration;
- message sizes and frequencies;
- daemon server-socket relay-auth public key, nonce, issue time, and signature query fields;
- plaintext `e2ee_hello` containing the client ephemeral public key;
- plaintext `e2ee_ready` containing the daemon-issued random challenge.

The pairing token and HMAC proof are sent only after the encrypted channel is open. They are not relay-visible payloads.

## Selected design

1. **Append-only protocol:** auth fields remain optional in the shared schema so old parsers can decode new messages. Optional wire fields do not imply authorization.
2. **Daemon challenge:** every daemon E2EE channel creates a fresh random challenge and sends it with `e2ee_ready`. A handshake retry reuses that channel challenge; a new socket gets a new one.
3. **Channel binding:** the daemon records the exact client ephemeral public key accepted by ECDH. The client builds its proof from that actual key and the daemon challenge. The server compares both values with channel metadata before consuming a pairing token or checking HMAC.
4. **First pairing:** a short-lived, one-time pairing token is accepted only with the channel binding. The daemon then issues a random per-device secret and returns it over the encrypted channel.
5. **Subsequent connections:** the client proves `deviceId` ownership with a timing-safe HMAC over the version, server id, daemon public key, actual client public key, device id, and daemon challenge. The daemon verifies this before session creation or resume.
6. **Session resume:** the existing client id remains the lookup key for wire compatibility, but an already authenticated Relay session cannot be resumed by a different authenticated device id or by an unauthenticated connection. A client id alone is not a Relay credential.
7. **Transport gate:** the device-auth requirement applies only to `transport === "relay"`. Direct/local hello handling remains unchanged.
8. **Default policy:** new daemons require device auth by default. `CHISACODE_RELAY_ALLOW_UNAUTHENTICATED_RECOVERY=1` is a temporary, explicit, high-severity recovery override. It accepts only a missing-auth legacy hello; incomplete or invalid device claims are rejected and never marked authenticated. Remove the override after 2026-11-10.

## Credential storage

- Android/iOS use Expo SecureStore backed by the platform Keystore/Keychain.
- Electron encrypts the secret with the main-process `safeStorage` API behind sender-validated privileged IPC. Linux `basic_text` and unavailable backends fail closed.
- Web keeps the secret in session memory and requires re-pairing after a page reload.
- The ordinary host registry stores only the device id. A legacy plaintext secret is migrated into the platform store during load and stripped from the registry on the next write. A store failure never causes a plaintext fallback.
- Clearing a Relay credential, removing a connection, or removing a host deletes the secure secret before deleting ordinary metadata.

## Compatibility matrix

| Client             | Daemon                  | Expected behavior                                                                         |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| New                | Old                     | Old `e2ee_ready` has no challenge; new client sends a legacy hello and remains compatible |
| Old                | New                     | Rejected by default with an upgrade/re-pair reason before any session handler runs        |
| New, first pairing | New                     | One-time token + channel binding; daemon issues device secret                             |
| New, paired        | New                     | Challenge + channel-bound HMAC proof                                                      |
| Legacy offer-only  | New + recovery override | Missing-auth legacy hello may pass; no authenticated device id is attached                |
| Direct/local       | Any                     | Existing network-reachability trust remains unchanged                                     |

## Failure and replay behavior

- A missing proof, missing binding, unknown device, revoked device, invalid HMAC, or mismatched channel binding closes the Relay socket before session creation.
- A pairing token is consumed only after binding checks; it is single-use and short-lived.
- A proof challenge is daemon-generated per channel and is also checked by the server-side replay protection in the device credential store.
- Replaying a proof on another channel fails because the challenge and actual client public key differ.
- Replacing the client public key after the channel is open causes the E2EE channel to close rather than re-key.
- A stolen, unexpired pairing offer can still enroll one device. Channel binding prevents a Relay from copying a token out of encrypted traffic; it does not make a deliberately shared offer non-transferable.

## Non-goals and residuals

- This design does not hide Relay metadata or add forward secrecy to the daemon's persistent E2EE key.
- Device-list revoke UI is incomplete; local credential clearing is available.
- New channel-binding and platform-store behavior has passed static checks but still needs real Relay compatibility and Electron/native surface verification before release approval.

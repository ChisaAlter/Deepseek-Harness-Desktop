# Agent Note: Desktop remote-access pairing

Status: implemented

English | [中文](2026-08-14-desktop-remote-access.zh.md)

## Problem

The desktop shell binds `dsh web` to `127.0.0.1` and the CLI refuses `--host 0.0.0.0` because `/api` has no authentication. Users still need a phone or another browser to continue sessions away from the desk.

## Decision

The Electron main process owns an outbound relay sidecar. `dsh web` stays on loopback. A paired client reaches the sidecar through a product-hosted WebSocket relay; the sidecar unwraps an E2EE channel, authenticates a one-time pairing token or a returning device HMAC, and proxies only an office RPC allowlist onto `http://127.0.0.1:<port>/api`. Privileged methods (`settings.*`, `credentials.*`, `host.pickDirectory`, and the rest of the loopback-only set) return 403 in the sidecar and never reach Harness.

`ui-settings-general` registers a General row with id `remote-access` only when `window.shell` exposes `getRemoteAccess`, `setRemoteEnabled`, and `revokeRemoteDevice`. The row toggles `remoteAccessEnabled`, shows the pairing QR / fragment URL, and revokes devices. A plain browser never sees the row.

## Alternatives considered

**Bind `dsh web` to `0.0.0.0` and load the existing SPA on the phone.** Rejected: that is remote code execution on the LAN, and the CLI already blocks it.

**Put the preference in Host `settings.yaml`.** Rejected: relay lifetime and device secrets are Electron userData, and a remote browser must not mint pairing tokens.

## Consequences

Enabling the row starts the sidecar without restarting Harness. Pairing URLs keep the offer in the URL fragment. Web clients store device secrets only in session memory; Android uses the platform keystore. Port 3080 never leaves loopback.

## Testing

`ui-settings-general` client specs pin registration only when the remote-access shell methods exist, and they drive enable / copy / revoke on the row. Desktop `npm test` covers offer encoding, E2EE, relay-auth replay, the RPC allowlist, and a loopback relay echo that proxies `session.list` while refusing `settings.describe`.

# Decision: Human error and dropdown marking for a stale remote listen address

Status: implemented

[中文](2026-09-25-remote-stale-bind-address.md) | English

## Problem

"Listen scope" persists one NIC address (`remoteBindAddress`). NIC addresses are volatile — WSL `vEthernet` subnets regenerate per reboot, DHCP re-leases, adapters go down. Once the saved value goes stale, every remote save re-runs `listen(3180, <stale-ip>)` and a raw `EADDRNOTAVAIL` crosses the `shell:save-remote` IPC boundary onto the settings page (`Error invoking remote method …`) — unreadable and seemingly unrecoverable; the popup's `humanizeRemoteError` folded it into "turn off then on to retry", which cannot help.

## Decision

- `ensureMobileWebServer` translates `EADDRNOTAVAIL` into "listen address X is gone — pick another under Listen scope", alongside `EACCES` (Windows reserved port ranges), matching the existing `EADDRINUSE` humanization. Config is never rewritten; every save re-runs sync, so picking a live address recovers immediately.
- The settings dropdown marks a persisted address missing from the live NIC scan as "unavailable", so the stale selection explains itself.
- `humanizeRemoteError` gains a `bindGone` kind (matching `EADDRNOTAVAIL` or the human message), so the sidebar popup points at Settings → Remote instead of advising a useless retry; `ipcErrorMessage` strips the `Error invoking remote method` wrapper.
- The thrown message keeps the `(EADDRNOTAVAIL)` code — a diagnostic clue and a stable anchor for the popup classifier.

## Alternatives considered

- **Auto-fallback to `0.0.0.0`** — rejected: the user picked a single NIC to narrow exposure; silently rebinding to wildcard widens the pairing page to every interface (including untrusted networks) without telling anyone.
- **Auto-fallback to `127.0.0.1`** — rejected: safe direction but equally silent; the pairing page becomes unreachable to phones and the user just sees pairing broken.
- **Reset out-of-scan values to default during normalize** — rejected: an adapter may be down only temporarily (Wi-Fi toggled); resetting permanently discards a still-recoverable explicit choice.
- **Filter virtual adapters out of the dropdown** — rejected: `tailscale|wireguard`-class overlay NICs are legitimate single-interface picks (a phone on the tailnet can reach them), and real NICs go stale via DHCP too — filtering fixes only half.
- **Validate the address against the live scan at save time** — rejected: existing stale configs still fail and still need explaining; validation only blocks new picks, duplicating the error translation's benefit.

## Consequences

A stale listen address now surfaces as an actionable human error plus an "unavailable" mark in the dropdown, and stale configs no longer wedge every remote save (picking a live address recovers). Cost: one new error kind and two locale keys; `ipcErrorMessage` becomes the shared unwrap point. Security semantics are unchanged — the listen surface is never silently widened — while self-service recovery is restored.

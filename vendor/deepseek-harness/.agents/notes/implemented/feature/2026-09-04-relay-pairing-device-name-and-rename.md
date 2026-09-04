# Agent Note: Relay pairing device names and renameable device labels

Status: implemented

English | [中文](2026-09-04-relay-pairing-device-name-and-rename.zh.md)

## Problem

Every row of the desktop device-management dialog read "relay-pair". The pairing offer always routes through the relay transport, so the daemon never sees a device WebSocket handshake and has no User-Agent to parse; the relay device-auth proof carries only cryptographic material. At issue time `websocket-server.ts` stamped the constant label `relay-pair`, the desktop shell mapped `device.label || device.deviceId` to the displayed name, and the credential store had no rename path — so identical names were unrecoverable by the operator, leaving the 4-hex shortId suffix as the only differentiator.

## Decision

**The client reports its name at pairing, and the desktop owns renames.** The `WSHelloMessageSchema.relayDeviceAuth` object gains an optional `deviceName` (trimmed, 1–120 chars, append-only — old daemons ignore it); the client library carries it on the first-pairing payload; the daemon stores it as the device label, keeping `relay-pair` as the legacy fallback. The mobile pairing page derives the name from `navigator.userAgent` (`iPhone · iOS 18.2`, `Android 15 · Pixel 8`, `电脑`, `设备` fallback), mirroring the desktop `remote-devices.js` naming contract.

On this side, `DesktopShell` grows `renameRemoteDevice(id, name)` and `hasRemoteApi` requires it alongside `unbindRemoteDevice`; the sidebar popup injects it through `RemoteSectionInjected`; the device-management rows gain an inline rename editor (input prefilled with the current name, `maxLength` 120, save/cancel). A rename commits through the new `shell:rename-remote-device` IPC, which writes `RelayDeviceCredentialStore.renameDevice` — file-backed, idempotent, capped at 120, and refused for revoked devices. Both label write paths (issue and rename) normalize to the same 1–120 budget, because `DeviceRecordSchema` caps `label` at load and an overlong persisted label would drop the whole store file.

## Alternatives considered

**Parse the device User-Agent server-side.** Rejected: pairing always rides the relay transport (`attachExternalSocket` carries no device request), so the daemon never receives a device User-Agent to parse.

**Rename-only, without a pairing-reported name.** Rejected: every fresh pairing would still read `relay-pair`; the operator would rename each device by hand.

**Fold the name into the HMAC proof transcript.** Rejected: the transcript binds channel material (`deviceId`, challenge, keys); display-only data must not enter the cryptographic transcript.

**Expose rename as a Settings → Remote tab instead of the device dialog.** Rejected: the device list lives only in the popup's device-management dialog; `GatewaySettingsTab` renders no device rows.

## Consequences

New pairings display a real device name; existing `relay-pair` rows keep their stored label until the operator renames them — rename is the migration path. A preload without `renameRemoteDevice` now fails `hasRemoteApi`, hiding the Remote surface in mixed builds; the desktop ships preload and UI together, so only mismatched desktops notice. Deployment note, recorded because it shaped verification: client bundles are served `Cache-Control: immutable` under URLs that do not change when a rebuilt bundle changes, so the rebuilt UI reaches the renderer only after the Electron `Cache` / `Code Cache` directories are cleared and the app restarted; already-paired phones need no re-pair — their stored label simply stays until renamed.

## Testing

`NODE_ENV=test pnpm exec vitest run packages/client/ui-settings-remote --testTimeout=30000` → 5 files / 44 tests green. New cases: the inline editor opens prefilled and cancels without a call; a submit calls `renameRemoteDevice('dev-1', 'Pixel 8')`, closes the editor, and renders the new name; a throwing rename surfaces `statusErrorGeneric`; `hasRemoteApi` rejects a preload missing `renameRemoteDevice`; the injected face plumbs the new callback. Cross-repo: the chisacode store spec pins the 120-cap and rename semantics (idempotent, empty-label no-op, revoked/missing refused, file re-open); the client-lib spec pins the `deviceName` on the pairing hello; the mobile pairing spec pins the UA-derived name and the `pairFromOfferUrl` payload; the desktop-shell spec pins the IPC passthrough and the preload's flag-gated exposure.

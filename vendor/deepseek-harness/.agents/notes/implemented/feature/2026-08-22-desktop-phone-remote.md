# Agent Note: Desktop phone Remote gateway is composed

Status: implemented

English | [中文](2026-08-22-desktop-phone-remote.zh.md)

## Problem

The mobile Web SPA under `mobile/web` can pair through `#offer=` and talk Host unary plus WebSocket, but the desktop process passed `createDisabledRemote()` into HarnessController and commented `ui-settings-remote` out of the web-app patch. A user could not open the pairing QR or reach that SPA.

## Decision

`src/main/index.js` constructs `RemoteGateway` with `getConfig` / `saveConfig` / `getTarget`. `getTarget` returns `{ host: '127.0.0.1', port: dsh.port }` only when `dsh.state === 'ready'`. `RemoteGateway.snapshot()` sets `available: true`. Default `remoteEnabled` stays false, so the process does not listen until the user turns Remote on. The harness preload exposes `getRemote`, `saveRemote`, `rotateRemoteToken`, and `unbindRemoteDevice`. `packages/bundle/web-app/cordis.patch.yml` loads `@deepseek-ai/dsh-client-ui-settings-remote`. The trigger carries `data-dsh-remote-trigger`. Authenticated HTML still comes from `mobile/web`; `/api/*` and WebSocket upgrades still proxy to loopback Host. Relay origins still pass only after `normalizeRelayOrigin` (HTTPS). `createDisabledRemote` remains a test helper and is not the production remote object.

## Alternatives considered

**Keep the stub until Android native ships.** Rejected: the Web SPA is the v1 client; hiding the QR blocks the shipped pairing path.

**Listen whenever `REMOTE_FEATURE_ENABLED` is true, ignoring `remoteEnabled`.** Rejected: the product default is off; a silent 3180 listener is not pairing.

**Serve official four-column `dsh web` on 3180.** Rejected: the mobile design is an independent SPA under `mobile/web`.

## Consequences

Release UI walk requires `remote.available` and `remote.notListening` on a default config (`remoteEnabled: false`). Composer official QA sets `remoteEnabled: true` and requires `case.remote.available` plus `case.remote.listening`. `assertDesktopForks` requires composition id `ui-settings-remote`. Phone Remote product contract lives in the desktop Feature Spine card `mobile-remote`.

## Related

[Remote pairing lives on a phone control beside Settings](2026-08-14-settings-remote-section.md). [Desktop composer draft lookup and official triggers](../bug-fix/2026-08-21-desktop-composer-draft-and-official-triggers.md).

# Agent Note: Remote pairing lives on a phone control beside Settings

Status: implemented

English | [中文](2026-08-14-settings-remote-section.zh.md)

## Problem

A Settings → Remote page with ports, LAN addresses, raw pairing URLs, and token rotation taught a technical pairing flow. Users need to turn remote on, pick LAN or a server relay, and scan a QR. Burying that in Settings made the control look unfinished and hid the only thing a phone user must see.

## Decision

Remote is a desktop-gated `sidebar.footer.action` (`id: 'remote'`) in `@deepseek-ai/dsh-client-ui-settings-remote`, rendered next to the Settings gear. The trigger and heading copy is **远程** / **Remote**. The phone glyph uses the tertiary label color while the gateway is off and the primary label color while it is on. The popup exposes On/Off and LAN versus server relay as two pairs of `ui-primitives` `Button`s (`size="sm"`: selected `primary`, unselected `ghost`), the pairing QR, and a bordered **已连接设备** row with `IconChevronRightOutline14` that opens device management. Changing mode writes `snap.mode` first and does not set the popup-wide busy flag, so the On/Off buttons stay enabled. Mode only changes the pairing QR; the LAN gateway and outbound relay stay up while remote is on and stop only when it is off. Ports, addresses, copy, rotate, and the relay URL editor are not on this face. Registration still requires `desktopShell()` `getRemote` / `saveRemote` / `rotateRemoteToken` / `unbindRemoteDevice`. Pairing URLs put the secret in `#offer=`. A successful scan mints a long-lived per-device credential distinct from the QR secret; Unbind drops that device. Relay is an outbound desktop connection to a `normalizeRelayOrigin` HTTPS origin. dsh still binds `127.0.0.1`. The web-app patch loads the `ui-settings-remote` row. The trigger carries `data-dsh-remote-trigger`. The desktop main process constructs `RemoteGateway` ([Desktop phone Remote gateway is composed](2026-08-22-desktop-phone-remote.md)).

## Alternatives considered

**Keep the full Settings → Remote page.** Rejected: that page leaked gateway internals to every pairing. The gear remains for product settings; Remote is a pairing action.

**Put the control in Electron chrome.** Rejected: the official sidebar already owns the Settings trigger; a second chrome button repeats the pairing-window mistake.

**Bind `dsh web` to `0.0.0.0` or rebuild a native chat client.** Rejected: the Host fence has no auth, and the product wraps the official page.

## Consequences

GUI tests must prove absence without `window.shell`, a dim trigger while off, a QR plus connected-device row while on, On/Off and LAN/Relay as radio `Button`s, and Unbind. Mode saves must leave the On/Off buttons enabled and must not start or stop the LAN gateway or relay. Main-process IPC still owns listen/token/relay/devices. The title bar and tray do not open a Remote settings section.

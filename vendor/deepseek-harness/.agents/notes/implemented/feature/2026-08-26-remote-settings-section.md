# Agent Note: Settings → Remote hosts gateway advanced knobs and IM channels

Status: implemented

English | [中文](2026-08-26-remote-settings-section.zh.md)

## Problem

Phone pairing belongs next to Settings as a quick on/off + QR action, but gateway advanced fields (port, bind, TLS, relay URL/token, rotate pairing token) and mature IM bots (QQ / Feishu / WeChat via community `@xmanrui/dsh-im`) needed a durable Settings home without burying the QR or inventing a second IM protocol stack.

## Decision

Desktop `ui-settings-remote` keeps the sidebar footer Remote popup for enable/QR/devices, and additionally registers Settings section id `remote` with child list slot `settings.remote.tab`. Tab `gateway` (order 0) owns the advanced RemoteGateway fields (including LAN/relay mode) over existing `window.shell` Remote IPC. Tab `channels` (order 10) is first-party `@xmanrui/dsh-im` from `vendor/dsh-im`, loaded by `dsh-im-desktop.js` via managed cordis `file://` (not a soft desktop-plugins copy); missing deps block Harness start. It no longer registers a standalone `settings.section`「IM机器人」row.

## Alternatives considered

**Keep everything in the sidebar popup.** Rejected: ports, relay secrets, and multi-channel IM UI overload the pairing face.

**Marketplace-only install of dsh-im with a deep-link CTA.** Rejected for v1: product asked to integrate the mature plugin directly; desktop preset mirrors usage-stats.

**Fork dsh-im to trim to QQ/Feishu/WeChat only.** Rejected: maintenance cost; the upstream nine-channel UI already includes those three.

## Consequences

GUI tests cover Settings → Remote registration and gateway saves; preset tests cover copy/junction/disable. Pin bumps must replay the `settings.remote.tab` retarget documented in `vendor/dsh-im/DESKTOP-FORK.md`. Partially supersedes the “no Settings → Remote page” stance in [Remote pairing lives on a phone control beside Settings](2026-08-14-settings-remote-section.md): pairing stays on the phone control; Settings owns advanced gateway + IM only.

# Agent Note: The preview-automation IPC chain is removed

Status: implemented

English | [中文](2026-08-25-preview-automation-chain-removed.zh.md)

## Problem

The desktop shell exposed eight `shell:preview-automation-*` channels (status, snapshot, click, type, press, scroll, evaluate, wait-for) driving arbitrary `executeJavaScript` and CDP `Input.*` dispatch against preview guests. No production consumer existed: `ui-preview` bound the callbacks into `PreviewShellInjected` but no component or plugin called them. Any code in the harness renderer — including marketplace-installed plugins — could reach a JS-evaluation primitive on logged-in preview sessions through `window.shell`.

## Decision

Delete the whole chain: the main-process controller methods and IPC handlers, the preload bindings, and the `ui-preview` types and injected callbacks. Tests now pin the absence (no `shell:preview-automation-*` handler registered, no `previewAutomation*` key on any preload role, no `automation*` method on the controller). `ensureDebugger` stays for `setColorScheme`'s CDP emulation call. Reintroducing browser automation requires a new feature card with an explicit permission model (approval flow, loopback-only guests, no raw evaluate).

## Alternatives considered

**Keep the chain behind a config flag** — rejected: a dormant high-privilege surface still ships, still needs auditing, and invites silent re-enablement. With zero consumers the correct baseline is absence.

## Consequences

- The harness renderer can no longer evaluate JS or synthesize input in preview guests; the remaining preview surface is navigation, capture, pick, PiP, and recording.
- `PreviewShellInjected` no longer carries automation members; desktop preloads built before this change expose dead `previewAutomation*` functions that nothing calls.

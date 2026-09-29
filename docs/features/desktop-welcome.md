# Feature: Desktop welcome

| Field | Value |
| --- | --- |
| **id** | `desktop-welcome` |
| **status** | `active` |
| **last verified** | 2026-09-29 — original installed app.asar fails rendering guard; repaired source passes real Electron light/dark and Chinese/English entry/skip, with layout/image fault detection; 8 focused tests passed. Replacement candidate pending. |

## User paths

1. Without account credentials or a provider key, the native welcome window holds workspace entry.
2. Sign in, save an API key, or choose set up later from the API key page to enter the workspace.

## Invariants

- Pinned upstream page layout, material CSS, brand image, compiled styles and fonts form one resource closure.
- Welcome preserves the upstream appearance and desktop-owned credential operations.
- Source and packaged smoke validate loaded images, full-window layout and reachable actions before clicking through welcome.

## Allowed touch

- `src/renderer/welcome.html`, `welcome-layout.css`, `welcome/`, `assets/welcome-brand.svg`, `assets/window-material.css`.
- `src/main/welcome-window.js`, `src/main/welcome*.test.js`, `src/main/smoke/client-ready.js` and its tests.
- `src/main/smoke/welcome-presentation.js`, `src/renderer/welcome-renderer.test.js`, `src/renderer/welcome-renderer.child.cjs`.
- This card, design language, build-release handbook and release QA evidence.

## Gates

- Real Electron welcome renderer test, including broken-layout and broken-image detection.
- Source and packaged smoke exercise the first-run key-page/skip flow.

## Sources

- Decision: [Upstream desktop bridges](../decisions/implemented/architecture/2026-09-26-upstream-desktop-bridges.md)
- Decision: [Welcome resource closure](../decisions/implemented/bug-fix/2026-09-29-welcome-resource-closure.md)
- Design: [Desktop welcome](../design-language.md#桌面欢迎窗)
- Implementation entry: `src/main/welcome-window.js`, `src/renderer/welcome.html`

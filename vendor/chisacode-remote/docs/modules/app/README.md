# App Module Handoff

## Role

`@chisacode/app` is the Expo React Native client for iOS, Android, browser web, and the desktop renderer UI. It owns user-facing host connections, workspaces, agent screens, composer flows, settings, voice UX, timeline rendering, and cross-platform layout behavior.

## Owned Surfaces

- Expo Router routes and screens.
- Host/session runtime state.
- Workspace, sidebar, tabs, panels, and composer UI.
- Provider/model/settings UI.
- Voice and dictation UX.
- Cross-platform style, layout, and interaction behavior.

## Dependencies

`app` depends on `client`, `protocol`, `highlight`, and `expo-two-way-audio`. It must not reach into daemon internals when a client/protocol surface exists.

## Downstream Consumers

- `desktop` packages the exported web build as its renderer.
- End users interact with daemon state through this module.

## Common Work

- Add or change a screen, setting, composer behavior, or provider selector.
- Consume a new daemon feature through `client`.
- Add cross-platform UI behavior.
- Fix native/web/electron divergence.

## Invariants

- App code is cross-platform by default.
- Import platform gates from `@/constants/platform`.
- Guard DOM APIs with `isWeb`.
- Prefer `.web.ts(x)`, `.native.ts(x)`, and `.electron.ts(x)` for platform-specific implementations.
- Hover-revealed controls need always-visible native or compact alternatives.

## Module Docs

- `docs/modules/app/sidebar-archive-ux.md` — soft-sidebar archive presentation (pending spinner on control, silent success, merged failure toast).

## Cross-Cutting Docs

- `docs/cross-cutting/app-platform-boundaries.md`
- `docs/cross-cutting/provider-plumbing.md`
- `docs/cross-cutting/daemon-agent-lifecycle.md`
- `docs/cross-cutting/websocket-rpc-protocol.md`

## Verification

```bash
npm run build:app-deps
npm run typecheck --workspace=@chisacode/app
npm run lint -- packages/app
```

For UI behavior, use targeted tests and browser/device verification for the affected platform. Do not run the full Playwright suite locally unless explicitly asked.

## Graph

Generated graph: `docs/modules/app/knowledge-graph.json`

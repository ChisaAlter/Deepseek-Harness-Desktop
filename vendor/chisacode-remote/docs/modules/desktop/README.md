# Desktop Module Handoff

## Role

`@chisacode/desktop` is the Electron wrapper. It owns Electron main/preload behavior, window management, managed daemon startup, desktop routing, desktop build packaging, and desktop-only integration points.

## Owned Surfaces

- Electron main process and preload bridge.
- Managed daemon process lifecycle.
- Desktop windows and compositor watchdog behavior.
- Desktop-specific project opening and shell environment handling.
- Packaged desktop build integration.
- Win/Linux custom title-bar chrome (no native `titleBarOverlay`): main process
  frameless window + IPC for minimize/maximize/close; the **renderer** paints
  Soft caption buttons (`packages/app` `DesktopWindowControls`).

## Dependencies

`desktop` depends on the exported app web renderer, the server daemon, and client/protocol contracts. It should not own generic app UI that must also run on mobile/browser web.

## Downstream Consumers

- Desktop users run ChisaCode through this shell.
- The app renderer runs inside the Electron environment.

## Common Work

- Change managed daemon startup or shutdown.
- Add Electron bridge behavior.
- Change desktop project routing or shell env handling.
- Adjust desktop packaging or window behavior.

## Invariants

- Electron desktop uses `CHISACODE_WEB_PLATFORM=electron` for renderer export.
- Managed desktop daemon behavior is distinct from arbitrary dev daemon state.
- Do not restart the main daemon without permission.
- Packaging logs may contain noisy metadata warnings; decide from exit code plus artifact existence.
- On Windows/Linux, do **not** reintroduce native `titleBarOverlay` for the main
  window; caption buttons must stay in the Web layer so Soft dimmers (Command
  Center) cover them without color flash. macOS keeps traffic lights.

## Cross-Cutting Docs

- `docs/cross-cutting/desktop-daemon-spawn.md`
- `docs/cross-cutting/websocket-rpc-protocol.md`
- `docs/cross-cutting/daemon-agent-lifecycle.md`

## Verification

```bash
npm run build:desktop
npm run typecheck --workspace=@chisacode/desktop
npm run lint -- packages/desktop
```

For focused work, run targeted desktop tests or `npm run dev:desktop`.

## Graph

Generated graph: `docs/modules/desktop/knowledge-graph.json`

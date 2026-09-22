# Desktop Daemon Spawn

Use this when changing Electron startup, daemon subprocess management, desktop renderer export, window/preload behavior, or desktop-specific environment handling.

## Modules

- `desktop`: Electron main process, preload bridge, windows, daemon spawn, packaging.
- `server`: daemon entrypoint and runtime behavior when spawned by desktop.
- `app`: exported web renderer and Electron platform paths.
- `client`: local WebSocket connection and reconnect behavior.
- `protocol`: handshake and feature contracts used by the renderer.

## Existing Docs

- `docs/development.md`
- `docs/architecture.md`
- `docs/release.md`

## Invariants

- Desktop may manage its own daemon subprocess.
- Electron renderer uses the app web build with `CHISACODE_WEB_PLATFORM=electron`.
- Do not assume a timeout means the daemon must be restarted.
- Windows packaging can emit noisy metadata warnings while still producing usable artifacts.
- The desktop daemon path is not the same as arbitrary dev daemon state.

## Desktop Hard-Bind Contract (2026-08-09)

The desktop Electron app is **hard-bound** to its built-in daemon. The following contract is invariant and must not be regressed:

### Startup binding

- `shouldStartBuiltInDaemon()` in `BootstrapProvider.tsx` returns `shouldUseDesktopDaemon()` (always true on Electron). It does **not** read `manageBuiltInDaemon`.
- `startDaemon()` in `daemon-manager.ts` does **not** call `assertBuiltInDaemonManagementEnabled`. Cold start always spawns the daemon, regardless of the `manageBuiltInDaemon` setting.
- `restartDaemon()` in `daemon-manager.ts` **does** call `assertBuiltInDaemonManagementEnabled`. Runtime manual restart is still gated by the setting.
- `manageBuiltInDaemon` is a runtime-only toggle: it controls whether the desktop may manually stop/restart the daemon during a session. It does **not** affect cold start.

### No welcome fallback on desktop

- `resolveStartupRedirectRoute` accepts `isDesktop?: boolean`. When `isDesktop === true`, it **never** returns `WELCOME_ROUTE` — even if `hasGivenUpWaitingForHost` is true. The app stays on `StartupSplashScreen`.
- `shouldArmStartupGiveUpToWelcome({ isDesktop, waitForConfiguredLocalDaemon })` returns `false` for desktop. The give-up timer is not armed on desktop.
- `index.tsx` hard-escape: when `isDesktop && !anyOnlineHostServerId`, returns `StartupSplashScreen` (not `<Redirect href="/welcome" />`).

### Connecting timeout

- `DaemonStartService.start()` succeeds → `startConnectingWatch(serverId)` subscribes to the store.
- If `connectionStatus` reaches `"online"` within `connectingTimeoutMs` (default 20s), the watch clears.
- If not, `lastError` is set to `"Desktop daemon started but the connection was not established."` → `hasSettledWithError()` returns true.
- This unlatches `storeReady` so `/settings` becomes reachable without redirecting to `/welcome`.

### Retry semantics

- `BootstrapProvider.retry`: if `service.hasEverSucceededCheck() && !anyOnlineHostServerId` → calls `service.restart()` (stop + spawn). Otherwise calls `startDaemonIfGateAllows` (fresh start).
- `DaemonStartService.restart()` calls `restartDesktopDaemon` IPC (not `startDesktopDaemon`).

### storeReady unlatch

- Desktop: `storeReady = online || splashError || daemonStartSettledError || hasGivenUpWaitingForHost`
- `daemonStartSettledError` = `service.hasSettledWithError()` (start failed or connecting timed out)
- This ensures `/settings` is reachable from the splash screen even when the daemon fails, without redirecting to `/welcome`.

### Splash screen

- `StartupSplashScreen` shows a "打开设置" (Open Settings) button on desktop (`shouldUseDesktopDaemon()`) so the user can navigate to `/settings` to add a remote host or fix config.

### Files enforcing this contract

| File                                                 | Role                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/app/src/utils/host-runtime-bootstrap.ts`   | `resolveStartupRedirectRoute` isDesktop rule + `shouldArmStartupGiveUpToWelcome`                  |
| `packages/app/src/runtime/daemon-start-service.ts`   | Connecting watch + `restart()` + `hasEverSucceededCheck()` + `hasSettledWithError()`              |
| `packages/app/src/app/_layout/BootstrapProvider.tsx` | Gate bypasses `manageBuiltInDaemon` + give-up not armed + retry uses restart + storeReady unlatch |
| `packages/app/src/app/index.tsx`                     | Hard-escape desktop stays on splash                                                               |
| `packages/desktop/src/daemon/daemon-manager.ts`      | `startDaemon` no assert; `restartDaemon` keeps assert                                             |
| `packages/app/src/screens/startup-splash-screen.tsx` | "打开设置" button                                                                                 |

## Handoff Checklist

1. Separate Electron main/preload changes from renderer UI changes.
2. Check whether the change affects daemon startup, app export, or both.
3. Verify generated desktop artifacts by exit code and artifact existence.
4. Avoid restarting the main daemon unless explicitly approved.
5. Refresh graphs if imports or package dependencies changed.
6. **Desktop hard-bind**: after any change to daemon startup, bootstrap, or redirect logic, rebuild `packages/app/dist` (expo export) **and** `packages/desktop` (tsc) before packaging with electron-builder. The `app.asar` contains both the renderer export and the compiled desktop main process — stale dist in either will cause silent runtime failures that don't show as type errors.
7. **Desktop hard-bind verification**: verify on real win-unpacked that (a) cold start with `manageBuiltInDaemon=false` still starts the daemon, (b) no `/welcome` redirect appears in `main.log`, (c) `daemon status --json` reports `running`/`reachable`/`desktopManaged:true`.

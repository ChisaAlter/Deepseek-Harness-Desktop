# ChisaCode Agent Notes

Maintenance authority: [WhaleIsle sole project policy](../../docs/maintenance/README.md). This file locates module contracts and mechanics; it cannot add independent maintenance gates, approvals or execution order.

## Sources Of Truth

- Project build/validation Node is pinned by the enclosing WhaleIsle root `.nvmrc`; package engines describe compatibility. This is an npm workspace monorepo with `package-lock.json`, not pnpm/yarn.
- `docs/` holds repo-specific architecture, workflow, and gotcha docs. For non-trivial work, list it and skim the relevant file before editing.
- `CLAUDE.md` has longer standing guidance; prefer this file for the compact checklist and consult the docs it references for details.

## Package Map

- `packages/server`: local daemon, WebSocket API, MCP server, agent lifecycle, file-backed state under `$CHISACODE_HOME/agents/`. Session class is being decomposed into per-domain handlers under `src/server/session-handlers/` (see `docs/refactors/session-decomposition-plan.md`).
- `packages/protocol`: shared WebSocket schemas/types and binary frame codecs; server, app, CLI, and client depend on it. Uses explicit exports map (not wildcard) — new public entries must be added to `package.json` `exports`.
- `packages/client`: daemon WebSocket driver plus `ChisaCodeClient`; app/CLI may still import internal daemon client paths during migration.
- `packages/app`: Expo app for iOS, Android, browser web, and the desktop renderer UI.
- `packages/cli`: Commander CLI; run the checkout version with `npm run cli -- ...`, not a globally installed `chisacode`.
- `packages/desktop`: Electron wrapper that can spawn/manage its own daemon.
- `packages/relay`: E2E encrypted relay; see `SECURITY.md` before changing relay/auth behavior.

## Commands

- Install with `npm ci`; host CI uses the enclosing root Node pin.
- Dev all surfaces: `npm run dev` on macOS/Linux, `npm run dev:win` on Windows.
- Focused dev: `npm run dev:server`, `npm run dev:app`, `npm run dev:desktop`.
- Build dependency stacks instead of guessing order: `npm run build:client` (`protocol -> client`), `npm run build:server-deps` (`highlight -> relay -> protocol -> client`), `npm run build:server` (`server-deps -> server -> cli`), `npm run build:app-deps` (`highlight -> protocol -> client -> expo-two-way-audio`).
- Available checks include `npm run typecheck` and targeted lint/format scripts; choose them for the actual change under host maintenance policy, without an every-edit matrix.
- Targeted lint accepts file paths through the npm script, e.g. `npm run lint -- packages/app/src/file.tsx`; do not call `npx oxlint`/`npx oxfmt` directly for normal checks.

## Build And Runtime Gotchas

- Workspace package exports resolve to compiled `dist/`, not sibling `src/`; rebuild producer packages before diagnosing cross-package type/runtime errors.
- `npm run dev`, `dev:server`, and `dev:app` do initial builds and then watch `protocol` and `client`; outside those workflows, rebuild after changing protocol/client code.
- On macOS/Linux `npm run dev` uses portless names such as `https://daemon.localhost` / `https://app.localhost` with ephemeral ports; Windows dev binds the daemon to `localhost:6767`.
- Daemon logs are in `$CHISACODE_HOME/daemon.log`; set `CHISACODE_LOG_LEVEL=trace` before launch for provider/session/agent-manager traces.
- **Desktop packaging rebuild order**: `app.asar` contains both the renderer web export and the compiled desktop main process. After changing app or desktop source, rebuild both: `expo export` to `packages/app/dist` **then** `tsc` in `packages/desktop`, before running `electron-builder`. Skipping either rebuild produces a package with stale code that fails silently at runtime (no type error, just wrong behavior).

## Testing

Select necessary local tests and real operations under host maintenance policy, after implementation is complete. Existing server categories are test:unit/test:e2e in @chisacode/server; provider tests need their actual credentials. App/browser checks use targeted existing Playwright scenarios when relevant. Missing prerequisites and skipped required scenarios remain unverified; final CI cannot fill local gaps.

### Fixed Waits

- Avoid `setTimeout` / `sleep`-based fixed delays in tests. They make suites slower, flaky under CI load, and hide real timing bugs.
- Prefer deterministic alternatives:
  - `vi.waitFor(() => expect(...))` for assertion polling (built into Vitest)
  - Event/observable-driven resolution: `await new Promise(r => emitter.once("ready", r))`
  - Mock clock (`vi.useFakeTimers()`) when testing timeout/deadline logic itself
- When a fixed wait is truly unavoidable (e.g. waiting for an OS-level side effect with no event hook), wrap it in a `vi.waitFor` with a generous timeout and document why polling is not possible.

## Protocol And Compatibility

- Wire schemas live in `packages/protocol`; old clients and daemons must still parse new messages.
- Schema additions are optional/defaulted; do not remove fields, make optional fields required, or narrow accepted types.
- New RPCs use dotted names with direction suffixes: `domain.feature.operation.request` paired with `.response`; see `docs/rpc-namespacing.md`.
- New feature support gates live under `server_info.features.*`; tag compatibility shims with `COMPAT(name)` plus added version/removal target.

## App Platform Rules

- App code is cross-platform by default. Import `isWeb`/`isNative` from `@/constants/platform`; use `getIsElectron()` for desktop bridge behavior and `useIsCompactFormFactor()` for layout.
- Prefer `.web.ts(x)`, `.native.ts(x)`, and `.electron.ts(x)` files over large runtime platform branches; Electron sets `CHISACODE_WEB_PLATFORM=electron`.
- Guard DOM APIs with `isWeb`; raw `document`, `window`, DOM refs, and browser event APIs crash native.
- Hover is web-only; for hover-revealed controls use an always-visible native/compact path. Do not use `onPointerEnter`/`onPointerLeave` for native behavior.

## Desktop Security Decisions

- **AppImage disables Chromium sandbox** (`packages/desktop/src/main.ts`): Linux AppImage runs from a FUSE-mounted `/tmp` path where the SUID `chrome-sandbox` helper cannot function. Only AppImage sets `--no-sandbox`; `.deb`/`.rpm` keep the sandbox on. This is consistent with VS Code and accepted across the Electron ecosystem. The remaining defense-in-depth layers (contextIsolation, nodeIntegration:false, webview will-attach validation, privileged IPC sender checks) must not be weakened. Do not extend `--no-sandbox` to other distributions.
- **Privileged IPC commands validate sender URL** (`packages/desktop/src/daemon/daemon-manager.ts`): commands that start/stop the daemon or write attachments check `event.senderFrame.url` against `chisacode://app` (packaged) or `localhost:8081`/`file://` (dev). New privileged commands must be added to `PRIVILEGED_COMMANDS` and use `isMainAppSenderUrl`.
- **Webview attachment is hardened** (`packages/desktop/src/main.ts` `will-attach-webview`): `src` must be `http`/`https`/`about:blank`; `sandbox`, `webSecurity`, `disableDialogs` are forced true; preload is stripped. Do not relax these.

## Desktop Daemon Hard-Bind Contract

The desktop Electron app is hard-bound to its built-in daemon. See `docs/cross-cutting/desktop-daemon-spawn.md` for the full contract. Key invariants:

- **Cold start always starts the daemon**: `shouldStartBuiltInDaemon()` returns `shouldUseDesktopDaemon()` (always true on Electron); it does not read `manageBuiltInDaemon`. `startDaemon()` does not call `assertBuiltInDaemonManagementEnabled`. `manageBuiltInDaemon` only gates runtime manual stop/restart, not cold start.
- **Desktop never falls back to `/welcome` on timeout**: `resolveStartupRedirectRoute` with `isDesktop=true` never returns `WELCOME_ROUTE`. `shouldArmStartupGiveUpToWelcome` returns `false` for desktop. Hard-escape returns `StartupSplashScreen`, not a welcome redirect.
- **Connecting timeout**: `DaemonStartService` watches the store after a successful start; if `connectionStatus` does not reach `"online"` within 20s, `lastError` is set and `hasSettledWithError()` unlatches `storeReady` so `/settings` is reachable.
- **Retry uses restart when daemon is running**: `BootstrapProvider.retry` calls `service.restart()` (stop + spawn) when `hasEverSucceededCheck() && !online`.

### Desktop Hard-Bind Test Gate

When changing daemon startup, bootstrap, redirect, or daemon-manager code:

- [ ] Run `npx vitest run packages/app/src/utils/host-runtime-bootstrap.test.ts --bail=1` — must include desktop+giveUp→null, desktop+online→Soft Home, non-desktop+giveUp→welcome (regression), `shouldArmStartupGiveUpToWelcome` branches.
- [ ] Run `npx vitest run packages/app/src/runtime/daemon-start-service.test.ts --bail=1` — must include connecting timeout, online clear, restart call, `hasEverSucceededCheck`.
- [ ] Run `npx vitest run packages/desktop/src/daemon/daemon-manager.test.ts --bail=1` — must include start with `manageBuiltInDaemon=false` succeeds, restart with `manageBuiltInDaemon=false` still throws.
- [ ] Typecheck + lint all modified files (`npm run typecheck`, `npm run lint -- <paths>`).
- [ ] **Rebuild both layers before packaging**: `expo export` to `packages/app/dist` **then** `tsc` in `packages/desktop` — `app.asar` contains both; stale dist in either causes silent runtime failures.
- [ ] Real win-unpacked verification: cold start with `manageBuiltInDaemon=false` still starts daemon; `main.log` has no `/welcome` redirect; `daemon status --json` reports `running`/`reachable`/`desktopManaged:true`.
- [ ] E2E mocks that simulate desktop bridge must handle `start_desktop_daemon` and return a valid `listen` address (not `null`), since the bootstrap now always calls start on desktop.

## Style

- Formatting is oxfmt: 2 spaces, double quotes, semicolons, trailing commas, 100-column width; generated `*.gen.ts(x)` files are ignored by formatter config.
- Prefer `function` declarations and `interface` when both work; oxlint enforces no explicit `any`, no array index keys, no nested ternaries, React hook rules, and low nesting/complexity.
- Do not add barrel `index.ts` re-export files just for convenience.
- If a Zod schema exists, derive the type with `z.infer<typeof schema>` instead of hand-writing a parallel type.

### JSDoc

- Add JSDoc for public APIs exported from packages: functions, classes, interfaces, and type aliases that other packages or external consumers depend on.
- Required tags: `@param` for each non-obvious parameter, `@returns` for non-void functions, `@throws` when a function explicitly throws errors callers should handle.
- Omit JSDoc on React component props (self-documenting via TypeScript), trivial getters/setters, and internal helpers whose name and signature are unambiguous.
- Format: `/** ... */` style, each tag on its own line, description in sentence case, no trailing period on `@param`/`@returns` single-line descriptions. Example:

```typescript
/**
 * Connects to the daemon and establishes a WebSocket session.
 * @param url The daemon WebSocket URL
 * @param options Connection options including auth token and reconnect policy
 * @returns A promise that resolves once the handshake completes
 * @throws {ConnectionError} If the daemon is unreachable or rejects the handshake
 */
export async function connect(url: string, options: ConnectOptions): Promise<Session> { ... }
```

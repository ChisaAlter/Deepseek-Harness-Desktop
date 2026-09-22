# ChisaCode Agent Notes

## Sources Of Truth

- Use Node.js 22 or newer from the active `PATH`; the repository does not pin an exact Node version. This is an npm workspace monorepo with `package-lock.json`, not pnpm/yarn.
- `docs/` holds repo-specific architecture, workflow, and gotcha docs. For non-trivial work, list it and skim the relevant file before editing.
- `CLAUDE.md` has longer standing guidance; prefer this file for the compact checklist and consult the docs it references for details.

## Production-Grade Development Rules

These rules apply to every development task in this repository. No minimal-plan shortcuts, no downgraded delivery.

1. **Review before planning**: before any task, review the relevant code (the whole project when necessary — delegate to subagents) before producing a plan.
2. **Complete plans only**: plans must target the fully complete, commercial, production-delivery level. Minimal plans are not allowed.
3. **Adversarial review of plans**: every plan must pass an adversarial review (find loopholes, downgrade points, omissions) before it is shown to the user. Only the revised plan is presented.
4. **HTML prototype gate for UI**: any UI-layout work requires an HTML prototype first (landed in `prototypes/`), reviewed and approved by the user, before implementation.
5. **Per-module gates**: for multi-module plans, each finished module must be re-reviewed (code review + adversarial review for downgrade) before the next module starts.
6. **Final adversarial review**: after all modules complete, one more overall adversarial review must confirm the task is truly done and not downgraded.
7. **Real-machine verification is required**: development is not complete without real-surface verification (QA-tester-level coverage). Static checks / unit tests passing ≠ verified. Anything not verified on the real surface must be explicitly labeled as unverified. UI changes must match the approved prototype pixel-for-pixel.
8. **Tests are still written**: unit tests follow the Testing section below; real-machine verification covers UI/end-to-end behavior. The two layers are not conflated.

These align with the Quick Check before Any Change, Improvement Tracking, and Testing sections below — they do not replace them.

## Package Map

- `packages/server`: local daemon, WebSocket API, MCP server, agent lifecycle, file-backed state under `$CHISACODE_HOME/agents/`. Session class is being decomposed into per-domain handlers under `src/server/session-handlers/` (see `docs/refactors/session-decomposition-plan.md`).
- `packages/protocol`: shared WebSocket schemas/types and binary frame codecs; server, app, CLI, and client depend on it. Uses explicit exports map (not wildcard) — new public entries must be added to `package.json` `exports`.
- `packages/client`: daemon WebSocket driver plus `ChisaCodeClient`; app/CLI may still import internal daemon client paths during migration.
- `packages/app`: Expo app for iOS, Android, browser web, and the desktop renderer UI.
- `packages/cli`: Commander CLI; run the checkout version with `npm run cli -- ...`, not a globally installed `chisacode`.
- `packages/desktop`: Electron wrapper that can spawn/manage its own daemon.
- `packages/relay`: E2E encrypted relay; see `SECURITY.md` before changing relay/auth behavior.

## Commands

- Install with `npm ci`; CI uses Node 22 and npm cache.
- Dev all surfaces: `npm run dev` on macOS/Linux, `npm run dev:win` on Windows.
- Focused dev: `npm run dev:server`, `npm run dev:app`, `npm run dev:desktop`.
- Build dependency stacks instead of guessing order: `npm run build:client` (`protocol -> client`), `npm run build:server-deps` (`highlight -> relay -> protocol -> client`), `npm run build:server` (`server-deps -> server -> cli`), `npm run build:app-deps` (`highlight -> protocol -> client -> expo-two-way-audio`).
- Verify after edits with `npm run typecheck` and `npm run lint`; format with `npm run format` or targeted `npm run format:files -- <paths>`.
- Targeted lint accepts file paths through the npm script, e.g. `npm run lint -- packages/app/src/file.tsx`; do not call `npx oxlint`/`npx oxfmt` directly for normal checks.

## Build And Runtime Gotchas

- Workspace package exports resolve to compiled `dist/`, not sibling `src/`; rebuild producer packages before diagnosing cross-package type/runtime errors.
- `npm run dev`, `dev:server`, and `dev:app` do initial builds and then watch `protocol` and `client`; outside those workflows, rebuild after changing protocol/client code.
- On macOS/Linux `npm run dev` uses portless names such as `https://daemon.localhost` / `https://app.localhost` with ephemeral ports; Windows dev binds the daemon to `localhost:6767`.
- Daemon logs are in `$CHISACODE_HOME/daemon.log`; set `CHISACODE_LOG_LEVEL=trace` before launch for provider/session/agent-manager traces.
- **Desktop packaging rebuild order**: `app.asar` contains both the renderer web export and the compiled desktop main process. After changing app or desktop source, rebuild both: `expo export` to `packages/app/dist` **then** `tsc` in `packages/desktop`, before running `electron-builder`. Skipping either rebuild produces a package with stale code that fails silently at runtime (no type error, just wrong behavior).

## Improvement Tracking

The master improvement roadmap lives at `docs/refactors/comprehensive-improvement-roadmap.md`. It tracks known tech debt, refactors, and quality improvements across packages with priorities and status.

### How to Update

- When you identify a systemic issue worth tracking (not a one-line bugfix), add an entry to the roadmap: describe the problem, affected packages, suggested approach, and current status.
- When starting work on a tracked item, move it to in-progress and link the branch/PR.
- When completing a tracked item, move it to done with a brief note on the resolution.
- Do not delete entries; completed items stay for historical context.

### Quick Check Before Any Change

- [ ] Is there already a roadmap entry for the area you're touching? Read it first.
- [ ] Could your change create new tech debt (e.g., workaround for a known limitation)? Add a roadmap entry before moving on.
- [ ] Did your change resolve a tracked item? Update the roadmap entry to done.

## Testing

- Never run full workspace/package test suites locally unless explicitly asked; they are heavy and can freeze the machine.
- Run the changed Vitest file only: `npx vitest run <path> --bail=1`.
- For broad output, redirect to a file and inspect it afterward: `npx vitest run <path> --bail=1 > /tmp/test-output.txt 2>&1`.
- Do not re-run a suite another agent already reported green; use CI for full-suite confidence.
- Server test categories: `npm run test:unit --workspace=@chisacode/server`, `npm run test:e2e --workspace=@chisacode/server`, real-provider tests use `*.real.e2e.test.ts` and credentials.
- App Playwright E2E is `npm run test:e2e --workspace=@chisacode/app`; do not run the full Playwright suite locally, only targeted specs when needed.
- Tests should be either unit tests with injected real-world ports/fakes or real E2E; avoid `vi.mock`, JSDOM/component mounting, private-state assertions, and auth/env skips in normal tests.
- Surface-specific UI verification must use the real target surface. Desktop testing means the Electron desktop app only; mobile testing means the native mobile app/device or emulator only. Do not use the web app/browser preview as a substitute for desktop or mobile verification, and do not claim desktop/mobile validation from web results.

### Client Test Coverage

- The `packages/client` test suite (`daemon-client.test.ts`, `daemon-client-transport.test.ts`, `terminal-stream-router.test.ts`, `index.test.ts`) currently has gaps around edge-case error paths, reconnection state machines, and binary frame encoding boundaries. When working in client code, add targeted unit tests for the changed paths.
- Priority order for new client tests: (1) error/reconnect paths that could cause silent failures in production, (2) binary frame encode/decode edge cases, (3) public `ChisaCodeClient` method contracts that app/CLI depend on.

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

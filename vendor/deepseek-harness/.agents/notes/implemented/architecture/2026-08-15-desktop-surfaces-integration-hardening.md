# Agent Note: Desktop surfaces integration hardening

Status: implemented

English | [中文](2026-08-15-desktop-surfaces-integration-hardening.zh.md)

> Scope: production hardening applied while integrating the titlebar / Git / terminal / right-panel surfaces into the desktop shell. The composition lives in the [surfaces note](2026-08-14-desktop-surfaces-and-titlebar.md); this note records the defects that only a real desktop run exposed, and the trust / lifecycle / packaging decisions that make the feature safe to ship.

## Problem

The surfaces branch passed its unit and browser suites, but a real Electron launch surfaced four gaps: session-scope stores never bound under `session-maybe`, several slots were declared by more than one package, the terminal was a raw buffer rather than a VT, and packaged first-run hung while extracting the runtime archive. Desktop capabilities also accepted any renderer-supplied `cwd`, so a marketplace plugin could drive `shell.gitPush` / `shell.readFile` against arbitrary directories.

## Decision

**Session-maybe stores bind to the empty key.** `standardKit` skipped the store seat for `session-maybe` entries while no session was current, so `SurfacesRoot` and the terminal workspace mounted before a session existed and never received `useStore`. The renderer now resolves a `session-maybe` store with the empty string as the scope key; the surfaces and terminal stores key their own buckets by `sessionId ?? ''`, so the empty instance is correct until a session resolves. (`packages/client/ui-renderer/src/client/scoped-slots.tsx`)

**One package owns each slot.** The catalog gate rejects a slot declared in two places. `ui-surfaces` owns the `surfaces.*` children and `ui-layout` owns `shell.titlebar.trailing` / `shell.terminalDrawer`; occupants import those owners' slot types instead of re-declaring the `SlotMap` keys.

**The terminal is a real VT.** The raw `<pre>` replay view was replaced with `xterm` + `addon-fit` (`TerminalPane`); the store's replay buffer seeds and backfills the terminal, live PTY bytes flow straight into it, and the fitted geometry drives `ptyResize`. `@xterm/xterm` is a dependency of both `ui-user-terminal` and `dsh-client-web` (which imports `xterm.css`).

**All filesystem-backed desktop IPC is workspace-scoped.** A `workspace-authority` module authorizes the configured boot workspace plus every path in the running harness workspace registry (`$DSH_HOME/storages/workspace.json`, the JSON unit `dsh-workspace` persists). A renderer-supplied `cwd` must resolve inside one of those roots (`..`, absolute escapes, missing/non-directory targets still reject). The registry file is re-read on each authorize so a folder added in the official sidebar is live without recreating the authority object. `git.js`, `pty.js`, and `workspace-fs.js` all authorize through it; tests inject temporary roots because `node:test` runs outside Electron.

**PTY and BrowserView tear down with the renderer.** `createPtyController` gains `killAll()` and `createPreviewController` gains `closeAll()`; `registerIpc` returns both controllers and the main process sweeps them on quit, harness restart, and reload.

**The packaged runtime archive extracts with portable tar args.** GNU tar (Git for Windows) treats a `C:` drive prefix on `-f` and `-C` as a remote host or fails to open backslash paths, while Windows' bundled bsdtar rejects GNU's `--force-local`. `harness-extract.js` and `after-pack.js` run tar from the archive directory and spell both `-f` and `-C` as forward-slash relative paths, the one form both implementations accept. `build.npmRebuild` is disabled so electron-builder ships node-pty's N-API prebuild instead of invoking node-gyp (which requires Visual Studio). A `DSH_SMOKE=1` launch probe exercises the real Electron shell: assembled chrome, and a PTY create/write/kill round trip.

## Alternatives considered

**Keeping the raw buffer terminal.** It dropped arrows, Home/End, Delete, and paste; an interactive shell was unusable. Full VT rendering is the shipped contract.

**Re-declaring slot keys per occupant.** TypeScript merges the duplicates, but the client-catalog gate cannot attribute documentation and fails the build. The single-owner rule is the only form the catalog accepts.

**Letting the renderer pick the filesystem root.** A third-party plugin runs with the renderer's privileges; trusting its `cwd` would let it commit, push, or read files anywhere. The main process resolves the boot workspace and the harness-registered paths; it does not accept an arbitrary renderer cwd.

**Recompiling node-pty with node-gyp.** Unnecessary: node-pty ships N-API prebuilds that load in Electron unchanged. Forcing the rebuild both requires Visual Studio and breaks the default prebuild path.

## Consequences

The surfaces shell, terminal, and filesystem-backed controls now behave the same in a packaged install as in a unit test. First run extracts the runtime archive, then the terminal round-trips a shell and the titlebar renders its cluster. Packaged smoke (`DSH_SMOKE=1`) is reproducible in CI on any Windows runner with Git for Windows installed.

## Testing

`workspace-authority.test.js` pins root/subdirectory acceptance, a second harness-registered root, outsider rejection, and `..` / absolute / missing / file rejection. `pty.test.js` and `preview.test.js` pin `killAll` / `closeAll` and the IPC controller hand-back. `terminal-drawer` mocks xterm and asserts the write/data/resize wiring. Root `npm test` covers the desktop main-process modules and `src/shared/post-merge-ui.test.js` source markers. `desktop-chrome.e2e.ts` pins the assembled titlebar and five-card grid in the browser lane. `post-merge-desktop-ui.e2e.ts` walks composer mention, Files/Agents/terminal work loops, Appearance gallery sources, and MCP/Skills on that same lane. `DSH_SMOKE=1` pins launch chrome, titlebar hits, and a PTY round trip in real Electron. `DSH_QA=1` (`npm run qa:source`) walks the assembled desktop UI in that same `webContents`: composer, terminal drawer, Files/Agents/Diff/Browser/Terminal, Appearance gallery sources, MCP/Skills/Plugins/Market, and the dshbot plugin's sidebar contribution.

## Related

[Slot system standard](2026-07-22-slot-type-chain-implementation.md) owns the composition model. [Desktop surfaces and titlebar](2026-08-14-desktop-surfaces-and-titlebar.md) owns the layout, titlebar cluster, and window-control inset.

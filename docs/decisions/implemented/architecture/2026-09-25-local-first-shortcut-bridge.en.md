# Decision: Local-first shortcut bridge

Status: implemented

[中文](2026-09-25-local-first-shortcut-bridge.md) | English

## Problem

Upstream 0.1.7-rc.2's shortcut stack is the `ctx.shortcuts` registry plus the official `apps/desktop` keyboard bridge: under the native-priority policy, Electron `before-input-event` intercepts physical keys and ports them to the BrowserView for registry arbitration. Whale Isle's shell has no such bridge, and the official policy lets desktop bindings override local semantics in terminal/editable regions (Ctrl+C/Ctrl+W). Vendoring the upstream package alone activates nothing; without the bridge, keycaps, the settings editor, and command dispatch are all absent.

## Decision

The implementation is split into four layers, with the input policy explicit rather than inferred:

1. **Explicit policy bit**: a new upstream `policy.ts` (`ShortcutInputPolicy = 'native-priority' | 'local-first'`); the registry and DOM installer read the `data-shortcut-policy` document mark. Absence preserves official behavior — never inferred from `runtime === 'desktop'`. Under `local-first`, physical keys are never preventDefault'd by the main process: the top-frame DOM dispatcher arbitrates region/modal synchronously, and protected chords (Ctrl+C/Ctrl+W in editable/terminal, bare Ctrl+R in terminal) always pass to the local control.

2. **Shell service** `src/main/shortcuts.js` + protocol snapshot `src/main/shortcuts-protocol.mjs`: the protocol layer is a desktop-side snapshot of the upstream compiled module — after packaging the vendored Harness tree is archived into `deepseek-harness.tar`, so `vendor/.../shortcuts/lib/protocol.js` does not exist inside `app.asar` and a direct import fails at startup with `ERR_MODULE_NOT_FOUND`; the snapshot replaces its two vendored deps (`assertNever`, `randomUUID`) with local equivalents while keeping upstream semantics. Sole writer of `userData/keybindings.json` (atomic writes); `ShortcutPersistence` supplies revision/sequence. Missing file → official defaults; corrupt/future schema → unreadable and never rewritten by Restore All. IPC accepts only the trusted main frame (sender + mainFrame + origin triple check). `before-input-event` does exactly two things: swallow all input and suppress menu accelerators while the overlay blocks; suppress a same-chord menu accelerator when the key is an accepted binding (one physical input, one owner). Menu clicks go through `dispatchMenuCommand` as `{kind:'menu', commandId, revision}` into `registry.invoke` with revision/focus/recording/overlay checks; `closeWindow` re-validates the revision and calls `win.close()` — the P1 guard stays in force.

3. **Narrow preload facade**: the harness main frame marks `data-platform` + `data-shortcut-policy="local-first"` and exposes `window.dshDesktop` containing only `keyboard`/`shortcuts` (never browser/updates), routed through `shell:shortcuts-*` IPC. A legacy web-localStorage config migrates once — only when the target file is absent and the schema validates — leaving `keybindings-migration.json` as the receipt and the source intact.

4. **Desktop fork retires direct DOM listeners**: the `PanelToggles` keydown listener is disabled under the desktop runtime; Ctrl+\ / Ctrl+` become registry commands (`surfaces.toggle`/`terminal.drawer.toggle`). `pane.split`/`terminal.new` yield to primary+shift; `TerminalPane` gains the `xterm` class so region detection holds. Menu keycaps for 打开工作区/设置 follow the effective binding, and an unbound command shows none once config is accepted; 重新加载界面 yields Ctrl+R and moves to F5. All fork edits are registered in `harness-desktop-forks.js` markers.

## Alternatives considered

- **Adopt official native-priority as-is**: the main process intercepts keys and ports them — comparable effort, but it violates the plan §7.2 policy table (protected local chords must stay local) and cannot guarantee "synchronous arbitration before consumption", so it was rejected.
- **Fake a complete `dshDesktop` object**: less adapter code, but unrelated plugins would misdetect capabilities (browser/updates do not exist); the facade is narrowed to keyboard + shortcuts.
- **Keep menu items wired to the old local handlers**: menu keycaps would drift from user configuration; routing through `dispatchMenuCommand` makes invoke run the modal/revision checks uniformly, with the local handler only as a dispatch-failure fallback.
- **Keep Ctrl+R as window reload**: upstream `page.refresh` owns Ctrl+R and means "refresh the focused panel"; two owners on one chord violates single-ownership, so window reload moved to F5.
- **Forward iframe/webview keys**: the official 'iframe'/'webview' input kinds need synchronously trustworthy ownership proof; under local-first, unprovable context means the input stays with the guest (the plan's allowed default) rather than being dropped asynchronously.

## Consequences

- User edits apply immediately and persist to `keybindings.json`; write failures keep the accepted configuration and recording drafts; menu keycaps rebuild on config change.
- `Ctrl+\` / `Ctrl+`` have exactly one owner on desktop (the registry) and never fire inside terminal/editable regions.
- The `page.close` (Ctrl+W) chain is registry → `keyboard.closeWindow(revision)` → shell revalidation → `win.close()` → P1 task protection; closing never bypasses inspection.
- Recording suppresses both the DOM and menu paths; while the overlay is up, physical input and menu accelerators are both swallowed.
- Web deployments are unchanged (webShortcutStorage + localStorage + the PanelToggles DOM listener).
- Test surface: `src/main/shortcuts.test.js` covers persistence/migration/sender rejection/overlay/recording/menu dispatch/closeWindow revision; the vendored client policy branch keeps regressing under existing upstream specs.

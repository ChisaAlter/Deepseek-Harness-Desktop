# Agent Note: Interactive PTY panes use T3code's libghostty-vt adapter

Status: implemented

English | [中文](2026-08-19-terminal-ghostty-libghostty-vt.zh.md)

## Problem

CodeBuddy's slash menu marks the selected row with Ink `bold` plus `colors.info` (cyan) and unselected rows with dim / secondary. There is no inverse cell, no background bar, and no `>` prefix. Desktop panes used `@xterm/xterm` and spent days retuning theme tokens, `minimumContrastRatio`, well opacity, and guessed overlays. Unit tests and bundle hashes went green while the live slash menu stayed unusable: xterm's DOM/canvas path was not the renderer T3code ships.

## Decision

`ui-user-terminal` panes copy T3code's web Ghostty adapter (`libghostty-vt` WASM + Canvas 2D `GhosttyTerminalSurface`) instead of retuning xterm. The copied modules are `core.ts`, `runtime.ts`, `renderer.ts`, `surface.ts`, and `keyCodes.ts`, plus the pinned wasm/font artifacts. Wiring-only files supply Vite `?url` replacements (`assets.ts` served at `/plugins/<id>/assets/`), `isMacPlatform`, and T3code's `isMonospaceFamily` probe. `terminalThemeFromApp` is T3code's fg/bg/cursor/selection override (this desktop's dark flag is `data-ds-dark-theme` in addition to T3code's `html.dark`). Seed replay calls `resetAndWrite`. `beforeKey` copies T3code's navigation/delete/clear helpers; T3code-app-only chords (`ResolvedKeybindingsConfig`) are omitted because this shell has no such config. The pane does not attach an xterm DA1 parser; Ghostty answers device attributes internally with the PTY writer detached during replay.

## Alternatives considered

**Keep xterm and keep tuning Pierre / contrast / opacity.** Rejected: that loop already claimed "fixed" against vitest, and live slash-menu pixels did not change.

**Use `coder/ghostty-web` as an xterm-like API.** Rejected: the product choice is T3code's adapter, not a third Ghostty wrapper.

**Rewrite a smaller Canvas VT in this package.** Rejected: the rule is to copy the working adapter, not reimplement it.

## Consequences

Plugin `client.js` fetches `ghostty-vt.wasm`, `ghostty-write-pty.wasm`, and the symbols Nerd Font from `/plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/`. `@xterm/xterm` is no longer a pane dependency. Chat bash cards (`TerminalBlock`) are unchanged. Windows PTY spawn copies T3code `createTerminalSpawnEnv` and `name: xterm-color`. Electron's `TERM=dumb` is dropped on Windows; T3code's Windows node-pty never writes `name` into `$TERM`. Selection Copy / Add to chat / Open stays the existing work-loop bar. A live slash menu is only proven by a CDP screenshot of the selected row, not by unit tests.

## Testing

Copied T3code helper/ABI specs live under `tests/ghostty/`. `terminal-drawer.client.spec.tsx` mocks `GhosttyTerminalSurface.create` and pins seed `resetAndWrite`, PTY input, selection actions, Ctrl-click links, and settle-fit follow. `node-half.client.spec.ts` serves `/plugins/<id>/assets/ghostty-vt.wasm`. Coverage excludes the vendored adapter directory; glue in `TerminalPane.tsx` and `terminal-theme.ts` stays gated.

## Related

[PTY ANSI colors follow T3code Pierre, not UI state tokens](2026-08-19-terminal-ansi-pierre-palette.md) described the abandoned xterm Pierre mapping; Ghostty's engine palette owns ANSI 1–15 here. [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md) owns `--dsw-alias-terminal-pane`. [ConPTY spawn matches T3code; DA1 is one-shot per PTY](2026-08-18-terminal-conpty-oneshot-no-dll.md) owns Windows spawn; the xterm DA1 latch is unused by this pane.

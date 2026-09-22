# Agent Note: PTY ANSI colors follow T3code Pierre, not UI state tokens

Status: implemented

English | [中文](2026-08-19-terminal-ansi-pierre-palette.zh.md)

## Problem

CodeBuddy's slash menu marks the selected row with Ink `bold` plus `colors.info` (cyan) and unselected rows with dim / secondary. T3code's web terminal is Ghostty: it only overrides fg/bg/cursor from the app, leaves ANSI 1–15 on the engine's vivid palette, and does not remap contrast. T3code's Windows PTY `name` is `xterm-color`, so Ink emits 16-color SGR. Desktop xterm mapped cyan to `--dsw-alias-state-success-secondary` (green-400), blue to business-primary, and set `minimumContrastRatio` 4.5, which boosted dim rows toward the same luminance as normal text. Selection was then bold-on-nearly-the-same-color, which is invisible at 13px. Making the pane opaque did not restore the T3code look because the palette and contrast remapping were still wrong.

## Decision

Windows `ptySpawnOptions` copies T3code `NodePtyAdapter`: `name` is `xterm-color` on Windows (`xterm-256color` elsewhere) and env is `createTerminalSpawnEnv`. Electron's `TERM=dumb` is dropped on Windows so Node color depth matches T3code's unset `$TERM`. The interactive pane is T3code's Ghostty adapter, which leaves ANSI 1–15 on the engine palette and only overrides fg/bg/cursor/selection; see [Interactive PTY panes use T3code's libghostty-vt adapter](2026-08-19-terminal-ghostty-libghostty-vt.md). `TERMINAL_MINIMUM_CONTRAST` remains `1` for any leftover xterm caller. The pane does not paint a guessed selection bar.

## Alternatives considered

**Keep UI-token ANSI and only drop contrast boosting.** Rejected: cyan would still be green-400, which is not T3code and not Ink `info`.

**Import xterm's default 16-color theme wholesale.** Rejected: Pierre is the T3code-named palette already used on mobile; cyan `#08c0ef` is the color that menu selection needs.

**Restore a client-side selected-row overlay.** Rejected: the TUI already emits the highlight; the renderer was washing it out.

## Consequences

Chat and settings chrome are unchanged. Windows PTY `name` is `xterm-color`; `TERM` is whatever the host process already has. Interactive PTY glyphs are Ghostty's engine ANSI, not a client Pierre table.

## Testing

`ptySpawnOptions(..., 'win32')` pins `name` `xterm-color` and inherited `TERM`; omitted size is 120×30; Linux keeps `name` `xterm-256color`. `TERMINAL_MINIMUM_CONTRAST` is 1. Ghostty theme tests pin fg/bg/cursor without an ANSI table.

## Related

[Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md) owns well opacity. [Terminal panes render TUIs verbatim with minimum contrast](2026-08-19-terminal-verbatim-tui-contrast-and-follow.md) owns the deleted row painter; contrast remapping is retired here. [ConPTY spawn matches T3code; DA1 is one-shot per PTY](2026-08-18-terminal-conpty-oneshot-no-dll.md) owns ConPTY without the DLL.

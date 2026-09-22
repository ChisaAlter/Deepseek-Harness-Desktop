# Agent Note: Terminal canvas uses the app background

Status: implemented

English | [中文](2026-08-18-terminal-canvas-app-background.zh.md)

## Problem

The conversation-column terminal drawer and the right-panel Terminal occupant paint an opaque xterm canvas. AppFrame already fills `--dsw-alias-bg-base`, including a wallpaper `color-mix` against transparent. Copying that computed rgba into xterm's `theme.background` while `allowTransparency` is false makes xterm replace the color with `#000000`. The pane also painted `--dsw-alias-bg-layer-2` (and the workspace root painted a second `--dsw-alias-bg-base`), so the PTY sat on a raised or stacked fill instead of the same canvas as chat.

## Decision

`TerminalWorkspace` `.root` stays `background: transparent`. The PTY well is the `--dsw-alias-terminal-pane` fill owned by [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md), which now mixes toward the backdrop at the dedicated `terminalOpacity` slider value (default `TERMINAL_PANE_MIN_SOLIDITY`) per [Terminal pane carries wallpaper glass at a floored solidity](../feature/2026-09-17-terminal-pane-glass-floor.md): no `backdrop-filter`, and the Ghostty canvas clears to that DOM fill when it carries alpha. `#dsh-wallpaper::after` paints `--dsw-alias-bg-mask-1` as T3code's 0.28 photo scrim. `theme.cursorAccent` and ANSI 0 (`black`) use that opaque RGB. Mouse `selectionBackground` is `--dsw-alias-interactive-bg-hover-solid`. ANSI 1–15 and contrast remapping on the well are owned by [PTY ANSI colors follow T3code Pierre, not UI state tokens](2026-08-19-terminal-ansi-pierre-palette.md). Inverse-cell CSS is owned by [Terminal panes render TUIs verbatim with minimum contrast](2026-08-19-terminal-verbatim-tui-contrast-and-follow.md). `TerminalPane` reapplies the theme after `open()` and observes wallpaper / color-scheme mutations. Toolbar and session-list chrome keep `--dsw-alias-bg-base`. `.xterm-viewport` stays transparent over the opaque pane.

## Alternatives considered

**Always opaque the mixed chat canvas, including without a wallpaper.** Rejected: chat should still show wallpaper around the PTY; the opaque well is only `.paneTerminal`, recorded in [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md).

**Always paint a dark well when wallpaper sits on a light canvas.** Rejected: the well follows the theme half (light well / dark well). Hiding the photo behind the PTY is owned by [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md); forcing dark-on-light is a second skin.

**Keep `--dsw-alias-bg-layer-2` on the pane and only enable `allowTransparency`.** Rejected as a chat-matching fill: layer-2 is the raised dialog token. The well uses `--dsw-alias-terminal-pane` as the opaque canvas family, not a stacked dialog.

**Leave the workspace root on `--dsw-alias-bg-base` and only clear the xterm cell fill.** Rejected: stacking two `color-mix` fills over AppFrame hides wallpaper the same way a second conversation fill would.

**Keep `theme.background` as `rgba(0, 0, 0, 0)` and map mouse selection to `--dsw-alias-interactive-bg-hover`.** Rejected: xterm `opaque(background)` becomes `#000000`, and blending 8% white onto that black is a near-black bar TUI selected rows cannot show on wallpaper.

**Keep `.paneTerminal` fully transparent so only AppFrame's mix shows through.** Rejected: T3code's `.terminal-pane` is `var(--glass-pane)` plus blur under a transparent xterm. A hole to the raw photo leaves CodeBuddy's bold-plus-info slash row without a stage.

## Consequences

Empty cells, the 4px pane inset, and unused space around the fitted grid sit on `.paneTerminal`'s opaque `--dsw-alias-terminal-pane`. The wallpaper bitmap is dimmed by `--dsw-alias-bg-mask-1` on `#dsh-wallpaper::after` and still shows through the chat canvas, not the PTY well. Toolbar chips and the session list stay on `--dsw-alias-bg-base`. The workspace `.root` stays transparent.

## Testing

`readXtermTheme` pins an opaque `rgb(...)` cell fill from `--dsw-alias-bg-base` RGB (including under `data-dsh-wallpaper`), an opaque `--dsw-alias-interactive-bg-hover-solid` selection, and ANSI 0 equal to that canvas RGB rather than the glyph color. It parses `color-mix(in srgb, #hex …)` canvas tokens. The drawer spec pins `allowTransparency: false`, CSS that keeps `.root` transparent, paints `--dsw-alias-terminal-pane` on `.paneTerminal` without `backdrop-filter`, and does not use `--dsw-alias-bg-layer-2` on the pane. Inverse-cell token CSS is pinned in the verbatim-TUI note. `mixWallpaperSurfaces` pins `--dsw-alias-terminal-pane` to the opaque canvas fallback. The wallpaper sheet pins `#dsh-wallpaper::after` to `--dsw-alias-bg-mask-1`.

## Related

[Right-panel and terminal work loops](../feature/2026-08-16-surfaces-terminal-work-loops.md) seats this pane. [Terminal pane fit and focus](2026-08-17-terminal-pane-fit-and-focus.md) owns FitAddon and the unstretched `.xterm-screen`. [Appearance nav contrast and wallpaper canvas cap](2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.md) owns the rule that nested chrome does not restack `--dsw-alias-bg-base`. [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md) owns PTY well opacity. [PTY ANSI colors follow T3code Pierre, not UI state tokens](2026-08-19-terminal-ansi-pierre-palette.md) owns ANSI 1–15 and contrast remapping. [Terminal panes render TUIs verbatim with minimum contrast](2026-08-19-terminal-verbatim-tui-contrast-and-follow.md) owns inverse cell fill.

# Agent Note: Terminal panes are opaque canvas wells

Status: implemented

English | [中文](2026-08-19-terminal-pane-opaque-tui-stage.zh.md)

> The readability rationale remains current and now owns the `TERMINAL_PANE_MIN_SOLIDITY` bound (the `terminalOpacity` slider's default and hint line); the "never mixes" clause is superseded by [Terminal pane carries wallpaper glass at a floored solidity](../feature/2026-09-17-terminal-pane-glass-floor.md).

## Problem

CodeBuddy's slash menu marks the selected row with Ink `bold` plus `colors.info` and `showIndicator: false` — no inverse, no cell background, no `>` prefix. Desktop panes sat those glyphs on an alpha-0 xterm fill over 12% wallpaper frost, so info versus secondary washed out and selection was indistinguishable. A client-side overlay that guessed the row from regexes and a local arrow index painted the wrong bar. `minimumContrastRatio` against an alpha-0 canvas RGB made letters readable without creating a selected row.

## Decision

The PTY well is opaque enough to read TUI selection. `--dsw-alias-terminal-pane` is `var(--dsw-alias-bg-base)` on the design sheet; while a backdrop is live `mixWallpaperSurfaces` mixes it at the dedicated `terminalOpacity` setting (40–100, default `TERMINAL_PANE_MIN_SOLIDITY` = 75, which the Appearance hint treats as the readability bound) — see the supersession note above. `.paneTerminal` paints that token and has no `backdrop-filter`. `terminalThemeFromApp` reports the computed fill's alpha as `backgroundOpacity` so the Ghostty canvas clears to the DOM fill instead of compositing a second mix. Wallpaper still mixes the chat canvas and sidebar deeper than the well ever goes. The pane still does not paint a guessed selection bar; TUI selection stays the TUI's own SGR. ANSI cyan/blue are Pierre, owned by [PTY ANSI colors follow T3code Pierre, not UI state tokens](2026-08-19-terminal-ansi-pierre-palette.md).

## Alternatives considered

**Keep wallpaper glass and paint an adaptive hover wash on a guessed row.** Rejected: the wash color is controllable, but the row is not; a local arrow index desynchronizes from the TUI, and SGR scraping misfires on ordinary output.

**Thicken the 12% frost until bold-plus-info reads.** Rejected: that still leaves a translucent photo behind the glyphs and trades wallpaper globally for one menu.

**Leave cells alpha-0 and rely on `minimumContrastRatio` alone.** Rejected: contrast against canvas RGB does not reconstruct a selected row when the TUI never paints a background.

**Fill the pane with `--dsw-alias-bg-layer-2`.** Rejected: layer-2 is the raised dialog token; the well follows the canvas family, not a stacked dialog.

## Consequences

CodeBuddy's native bold-plus-info highlight sits on a well that defaults to three quarters solid, so selection stays the TUI's own SGR on a readable stage; dragging the dedicated slider below the bound is the user's explicit trade, flagged by the Appearance hint. Chat, sidebar, and raised chrome keep the full glass slider; the well follows its own setting.

## Testing

`terminalThemeFromApp` pins `backgroundOpacity` from the computed pane fill and the sentinel fallback for unpaintable colors. The drawer spec pins `.paneTerminal` background `--dsw-alias-terminal-pane` with no `backdrop-filter`. `mixWallpaperSurfaces` pins the pane at the explicit `terminalSolidity` argument at, above, and below the bound, including the transparent-theme 0% surface input; `renderGhosttySnapshot` clears repaint regions under a translucent base. `wallpaper.css` has no `--dsw-terminal-pane-blur`.

## Related

[Terminal canvas uses the app background](2026-08-18-terminal-canvas-app-background.md) owns the transparent workspace root, wallpaper mask, and the rule that nested chrome does not restack `--dsw-alias-bg-base` on the chat canvas. [Terminal panes render TUIs verbatim with minimum contrast](2026-08-19-terminal-verbatim-tui-contrast-and-follow.md) owns the deleted row painter and inverse-cell CSS. [PTY ANSI colors follow T3code Pierre, not UI state tokens](2026-08-19-terminal-ansi-pierre-palette.md) owns ANSI 1–15 and `minimumContrastRatio`.

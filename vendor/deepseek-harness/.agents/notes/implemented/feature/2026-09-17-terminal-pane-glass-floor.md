# Agent Note: Terminal pane carries wallpaper glass at a floored solidity

Status: implemented

English | [中文](2026-09-17-terminal-pane-glass-floor.zh.md)

## Problem

[Terminal panes are opaque canvas wells](../bug-fix/2026-08-19-terminal-pane-opaque-tui-stage.md) pinned `--dsw-alias-terminal-pane` solid because TUIs like CodeBuddy mark selection with bold plus a foreground color and no cell background — deep translucency made the selected row indistinguishable. That also left the terminal the only chrome surface a live wallpaper or gradient could never reach, and users read the opaque well as the background not applying.

## Decision

The pane joins the wallpaper mix but takes its own persisted `terminalOpacity` setting (40–100, default `TERMINAL_PANE_MIN_SOLIDITY` = 75) instead of the glass slider — the well's solidity is a dedicated Appearance「终端透明度」slider so the terminal can sit calmer or more see-through than the surrounding chrome, including under the transparent theme where the pane would otherwise inherit a 0% input. Below 75 Appearance shows the TUI-selection readability hint instead of clamping: the bound is the default and the warning line, not a hard floor. `.paneTerminal` keeps painting the token; `terminalThemeFromApp` probes the computed fill and reports its alpha as `GhosttyTheme.backgroundOpacity`. The Ghostty canvas is alpha-capable (`getContext("2d", { alpha: true })`), and `renderGhosttySnapshot` clears each repaint region back to the DOM fill instead of repainting the translucent base — one tint layer, so DOM and canvas never double-composite. Explicit SGR cell backgrounds still paint solid, as do the cursor and selection overlays.

## Alternatives considered

**Let the pane take the raw glass slider.** Rejected: under the transparent theme that input is 0, reproducing exactly the alpha-0 CodeBuddy wash-out the opaque well fixed; a dedicated setting owns the pane in every backdrop mode.

**Floor the mix at 75 with no separate control.** Rejected: it made the terminal the one surface the user could not tune, so a high glass opacity still read as "the background does not apply". The slider keeps the readability bound as the shipped default while honoring an explicit choice.

**Repaint the translucent base on the canvas as well.** Rejected: compositing the same color-mix twice squares the transparency (an 80% DOM fill under an 80% canvas fill reads about 96% solid), so the pane would sit denser than the slider says.

## Consequences

Out of the box the terminal well shows a quarter of the wallpaper or gradient — enough that the pane visibly participates, bounded enough that bold-plus-color selection stays readable. Dragging below 75 trades that readability for more translucency by the user's own choice; Appearance warns rather than forbidding. The transparent theme keeps no special terminal rule: the pane applies its own setting like everywhere else. Any `backgroundOpacity < 1` path must clear before repainting, or stale glyphs linger where a transparent frame no longer paints.

## Testing

`mixWallpaperSurfaces` specs pin the pane at the explicit `terminalSolidity` argument — at, above, and below `TERMINAL_PANE_MIN_SOLIDITY`, including the transparent-theme 0% surface input. `terminalThemeFromApp` specs pin `backgroundOpacity` read from the computed fill and the sentinel-pixel fallback for unpaintable colors. `renderGhosttySnapshot` specs pin `clearRect` on the canvas and dirty rows under a translucent base while an explicit cell background still fills. The Appearance spec pins the slider write plus the live / below-bound / no-backdrop hint switching.

## Related

[Terminal panes are opaque canvas wells](../bug-fix/2026-08-19-terminal-pane-opaque-tui-stage.md) owns the readability rationale the 75 bound preserves; this note supersedes its "never mixes" clause. [Terminal canvas uses the app background](../bug-fix/2026-08-18-terminal-canvas-app-background.md) owns the transparent workspace root and the wallpaper mask.

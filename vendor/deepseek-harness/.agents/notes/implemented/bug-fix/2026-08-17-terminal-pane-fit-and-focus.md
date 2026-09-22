# Agent Note: Terminal pane fit and focus

Status: implemented

English | [中文](2026-08-17-terminal-pane-fit-and-focus.zh.md)

## Problem

Opening four tiled PTYs in the right-panel Terminal surface leaves only some panes with a complete PowerShell prompt and a working input caret. Earlier panes clip `PS C:\…` at a column boundary; a later pane can show the full prompt while keystrokes still go to a different xterm. The conversation-column drawer uses the same `TerminalWorkspace`, so a four-way split there fails the same way.

Without a used CSS box, FitAddon still reports the xterm default 80×24 (or a 2×1 minimum). That size is forwarded to ConPTY immediately. PowerShell then prints the prompt against the wrong column count. Stretching `.xterm-screen` to 100% hides the mismatch. Clicking a pane's canvas stops propagation so `activate` never runs, and `Terminal.focus()` is never called when `activeId` changes, so the sidebar highlight and the focused xterm diverge.

## Decision

`TerminalPane` fits only when `hostHasFitSize` is true (both `clientWidth` and `clientHeight` > 0). It refits on rAF, after 30 ms, on `ResizeObserver`, and on `document.fonts` `loadingdone`. `ptyResize` is debounced 150 ms and skipped when the grid is unchanged. The local xterm grid still updates on every successful fit. The active pane calls `term.focus()` on rAF. Pointerdown on the host activates the session; click still stops at the host so the chrome `tabIndex` group does not steal caret focus. `.xterm-screen` and `.xterm-viewport` are not stretched to 100%. Drawer and surface share this pane.

## Alternatives considered

**Spawn the PTY only after the first successful fit.** Rejected because create already races the shell banner; delaying spawn adds a blank pane without removing the need to skip zero-size fits and debounce later splits.

**Keep immediate `ptyResize` and only fix focus.** Rejected because ConPTY reprints the prompt against a 1-row grid during a four-way split even when the later pane is focused.

**CSS-scale the 80×24 canvas to the pane.** Rejected because glyph cells then no longer match the PTY grid, so clicks and wrapping stay wrong.

## Consequences

A collapsed drawer or an in-flight grid cell does not resize ConPTY. After layout settles, every visible pane reports the same fitted grid, and the sidebar's active row owns xterm input. The first PowerShell prompt can still print at the spawn default 80×24 if the shell is faster than the 150 ms debounce; xterm rewraps locally once the host has a box. Four stacked panes in a short column can still be one or two rows tall; that is the tile, not a fit skip.

## Testing

`ui-user-terminal` pins a zero-size host that does not call `ptyResize`, a sized host that debounces `ptyResize(id, 80, 24)` and does not re-notify the same grid, FitAddon throw and 0×0 grid skips, a missing `ResizeObserver`, buffer replay on remount, active-pane `focus()` following sidebar activation, pointerdown activation, and CSS that does not stretch `.xterm-screen`. `hostHasFitSize` rejects 0×0 and a zero height. `sessionBuffer` returns the record bytes or `''`.

## Related

The work loops that seated this pane are [Right-panel and terminal work loops](../feature/2026-08-16-surfaces-terminal-work-loops.md).

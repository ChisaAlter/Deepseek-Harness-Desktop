# Agent Note: Terminal panes render TUIs verbatim with minimum contrast

Status: implemented

English | [中文](2026-08-19-terminal-verbatim-tui-contrast-and-follow.zh.md)

## Problem

The desktop terminal panes (conversation drawer and right-panel surface) tried to make CodeBuddy's slash menu legible over wallpaper glass by scraping DomRenderer rows, regex-classifying "menu lines", and painting an info-fill bar onto the row a locally tracked arrow index guessed was selected. That mirror misfired in both directions: the `MENU_COMMAND` regex (a lowercase word followed by two spaces) matched ordinary column-aligned output such as `git status` and directory listings, so random lines got blue bars, and the local arrow index desynchronized from the TUI's real selection on filtering, remount, or any missed key, so the painted bar sat on the wrong menu row. The repaint loop (MutationObserver plus `onRender` plus rAF second pass) also reprocessed every viewport mutation. Independently: every successful refit forced `scrollToBottom()`, yanking the user out of scrollback on any layout change; `pty.js` still spawned with `useConptyDll: true` against the shipped [one-shot DA decision](2026-08-18-terminal-conpty-oneshot-no-dll.md); and the 256 KiB replay-buffer cap cut at an arbitrary byte, so a remount replay could start mid-escape-sequence and garble the parse.

## Decision

The pane renders what the PTY sent, verbatim, and never repaints rows a TUI drew. `tui-selected-row.ts`, its overlay layer, the arrow-key tracker, and the mutation/repaint loop are deleted. The PTY well is opaque, owned by [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md). ANSI 1–15 and contrast remapping are owned by [PTY ANSI colors follow T3code Pierre, not UI state tokens](2026-08-19-terminal-ansi-pierre-palette.md). xterm's `minimumContrastRatio` is 1; the TUI's real highlight (bold + info/cyan) is whatever the TUI painted. A refit calls `scrollToBottom()` only when `shouldFollowOutput` sees the viewport already resting on the last line (`viewportY >= baseY`); anywhere above, scrollback holds. `ptySpawnOptions` on win32 is `{ useConpty: true }` with `useConptyDll` absent, matching the one-shot DA note; the DA1 latch in `conpty-da.ts` stays because replay buffers still contain `CSI c`. `appendData` realigns the buffer-cap head cut to the next line start or ESC within `BUFFER_REALIGN_WINDOW` (4096) so a replay never begins inside an escape sequence. `hostHasFitSize` measures the padding-less content box: a terminal mounted in a collapsed surfaces column keeps only its 4px inset (`clientWidth` 8), and fitting that clamped the grid to FitAddon's 2-column minimum and squeezed the live ConPTY to 2 columns (observed live before the fix).

## Alternatives considered

**Keep the painter and follow arrows harder (capture keydown, clamp the index).** Rejected: the index is a client-side guess of remote TUI state; typing that filters the menu, mouse selection, Home/End, or one missed key desynchronizes it permanently, and the row regexes still misfire on ordinary output. No amount of key tracking fixes a mirror without a source of truth.

**Thicken the pane frost so raw ANSI reads.** Rejected: that still leaves a photo behind the glyphs. The well is opaque instead, recorded in [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md).

**Restyle `.xterm-bold` or inverse classes to mark selection.** Rejected previously and still: CodeBuddy sets bold on hundreds of nodes, and its menu never sets inverse.

**Follow output by always scrolling on data instead of on fit.** Rejected: xterm already follows on write when at the bottom; the bug was only the forced scroll inside `fitNow`.

## Consequences

Ordinary output (`git status`, aligned listings, man pages) can never acquire a phantom selection bar. CodeBuddy's menu selection is exactly what CodeBuddy paints, moves with its own arrow handling, and cannot drift. Dim-vs-info contrast is the Pierre cyan versus dim SGR that Ink emitted; `minimumContrastRatio` is 1 and does not remap those hues. Scrollback reading survives splits, drawer resizes, and font loads. Windows spawns system ConPTY without the bundled DLL, so live SGR matches the T3code reference. Remount replays start at a clean boundary; at most `BUFFER_REALIGN_WINDOW` bytes beyond the cap cut are dropped to reach one.

## Testing

`terminal-drawer.client.spec.tsx` pins `minimumContrastRatio` on the constructed terminal, refit-follow only from the bottom (`keeps the scrollback position on refit unless the viewport was at the bottom`), the inverse-cell token CSS, and the absence of `data-dsh-tui-selected` / `dsh-tui-selected-bar` from the stylesheet. `fit.client.spec.ts` covers `shouldFollowOutput` (bottom, above-bottom, missing buffer/fields) and `TERMINAL_MINIMUM_CONTRAST` 1. `terminal-session-store.client.spec.ts` covers `realignBufferStart` (earliest of newline/ESC, window fallback) and the overflow paths through `appendData`. `fit.client.spec.ts` also rejects a padding-only host (collapsed column) in `hostHasFitSize`. `src/main/pty.test.js` asserts `useConpty: true` with `useConptyDll` absent.

## Related

[Terminal canvas uses the app background](2026-08-18-terminal-canvas-app-background.md) owns the transparent workspace root and wallpaper mask. [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md) owns `--dsw-alias-terminal-pane` opacity. [PTY ANSI colors follow T3code Pierre, not UI state tokens](2026-08-19-terminal-ansi-pierre-palette.md) owns ANSI 1–15 and contrast remapping. [ConPTY one-shot DA without the DLL](2026-08-18-terminal-conpty-oneshot-no-dll.md) owns the DA1 latch this note's spawn options now match. [Terminal pane fit and focus](2026-08-17-terminal-pane-fit-and-focus.md) owns FitAddon gating and the resize debounce.

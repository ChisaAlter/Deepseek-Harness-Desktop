# Agent Note: Ctrl+` toggles the drawer with focus inside the Ghostty terminal

Status: implemented

English | [中文](2026-08-25-terminal-drawer-chord-ghostty.zh.md)

## Problem

The titlebar drawer shortcut broke exactly while the terminal had focus. Two independent breaks: `keybindings.isEditableKeyboardTarget` still matched the retired `.xterm` container (Ghostty renders into `[data-terminal-pane]`), and the drawer listener's `isTextEntryTarget` treated Ghostty's hidden input `textarea` as a text entry field, so Ctrl+` was skipped. On top of that, the Ghostty surface's `onKeyDown` encoded the chord and called `stopPropagation`, so the window listener never saw it. The keybindings fixtures pinned the dead `.xterm` DOM, keeping the tests green while production was broken.

## Decision

Three aligned changes. `keybindings.ts` pins `[data-terminal-pane]`: inside the pane, `isEditableKeyboardTarget` is true (Ctrl+\ stays with the PTY) and `isTextEntryTarget` is false (the hidden textarea is the terminal, not a text field). `terminalKeyShortcuts.isTerminalDrawerShortcut` mirrors the titlebar predicate, and `TerminalPane.handleBeforeKey` returns false for the chord with `preventDefault` only — no `stopPropagation` — so the event bubbles to the titlebar window listener, which performs the toggle; returning false routes the release through `suppressedKeyCodes` so a Kitty report-event-types session never sees a lone keyup. Fixtures now build the production DOM: `[data-terminal-pane]` plus a textarea inside it.

## Alternatives considered

**Have the pane call `toggleTerminalDrawer` directly from `beforeKey`** — rejected: the toggle lives in ui-titlebar's inject face and cross-package imports of another plugin's symbols are forbidden; letting the existing window listener consume the bubbled event needs no new seam.

## Consequences

- Ctrl/Cmd+` opens and closes the drawer regardless of focus; Ctrl/Cmd+\ inside the terminal still reaches the PTY (SIGQUIT et al.).
- No production selector or fixture references `.xterm` anymore; tests pin the Ghostty DOM.
- Composer and other text fields keep both chords exempt, unchanged.

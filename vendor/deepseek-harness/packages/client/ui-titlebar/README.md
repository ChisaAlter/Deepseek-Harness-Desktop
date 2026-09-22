# @deepseek-ai/dsh-client-ui-titlebar

English | [中文](README.zh.md)

Titlebar trailing plugin: two ghost toggles that write `ctx.layout.toggleTerminalDrawer` and `ctx.layout.toggleSurfaces`. The entry sits in `shell.titlebar.trailing` at `id: 'panel-toggles'`, `order: 40`, so it stays visible on the blank home and lands to the right of Session log (`order: 10`) with a gap for Git (`order: 20`). Interface Settings `ui-titlebar.terminalToggle` and `surfacesToggle` (default true) hide the matching buttons; `Ctrl+\`` and `Ctrl+\\` still toggle the panels. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

Pressed state follows the layout owner widths (`surfaces` / `terminalDrawer`; 0 is closed). The terminal toggle is disabled when `useWorkspaces` reports no workspace. The surfaces toggle stays available on the blank home. Ctrl/Cmd+` toggles the terminal drawer and Ctrl/Cmd+\\ toggles the surfaces column. The surfaces shortcut yields to inputs, textareas, contenteditables, and Ghostty terminal panes (`[data-terminal-pane]`); the terminal-drawer shortcut yields only to text entry outside the terminal, so it still toggles while focus is inside a terminal pane (Ghostty's hidden input textarea included — `ui-user-terminal` refuses the chord in `beforeKey` and lets it bubble here).

`PanelTogglesProps` composes the titlebar trailing owner share, the global `useWorkspaces` hook, injected toggle callbacks, and the `titlebar` locale seat. There is no plugin store.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; PanelToggles remains package-internal behind the slot registration.

## Model Experience

None, as the titlebar toggles only write layout panel geometry; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Git is a sibling titlebar entry** — this package does not render Git actions; a later `ui-git` entry occupies `order: 20`.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.

# Decision: non-conversation main panels live in the content row below the title bar

Status: implemented

[中文](2026-09-19-main-panel-titlebar-row.md) | English

## Problem

The plugin-manager page opened from the sidebar's Plugins entry conflicted with the desktop title bar: its content painted into the 48px drag band / title-bar trailing cluster, and plugin list cards did not respond to clicks. The root cause is `AppFrame`'s center-column grid contract — the desktop merge gave `.frame` a multi-row grid (title-bar `auto` row + content `minmax(0, 1fr)` row + terminal-drawer row), and the `conversation` panel owns the whole column via `grid-row: 1 / -1` plus an inner subgrid. Other keyed `main` slot panels (the plugin manager and future global panels) rendered straight into the center-column grid, and since slot anchors are `display: contents`, the panel root landed in row 1 (the title-bar row), inflated the `auto` track, and reached into the title-bar region — visually overlapping it and stealing pointer events, which presented as "page hugs the title bar and ignores clicks".

## Decision

`AppFrame`'s `MainPanel` now branches on the resolved panel key: `conversation` (including the `activePanelId === null` default) keeps rendering directly and continues to own the full-column subgrid; every other key is wrapped in a new `.mainPanel` container that occupies row 2 of the center column, constrains its box, and lets the page scroll itself. The `main` slot contract comment now states that `conversation` is the reserved full-conversation key while other keys are global panels rendered through the mainPanel container. `FORK_FILE_MARKERS` gains entries for `AppFrame.tsx` / `AppFrame.module.css` so an upstream sync cannot silently revert this desktop layout contract; a `ui-layout` spec now covers the row contract. The design-language document records the same invariant — non-conversation panels mount only in the content row, conversation alone spans both rows.

## Alternatives considered

- **Let each global panel declare its own grid-row / constraints** — rejected: the contract must live in `AppFrame` so no panel can miss it; per-panel declarations would reproduce the same defect the next time a main panel is registered.
- **Wrap at the slot renderer layer** — rejected: the renderer is a generic `display: contents` mechanism and should not carry grid-row semantics; row placement is `AppFrame`'s responsibility.
- **Put conversation inside the container too and offset it internally** — rejected: that breaks conversation's existing full-column subgrid contract; normalizing the special panel only buys a second regression.

## Consequences

The plugin manager and all future non-conversation `main` panels land in the content row below the title bar, no longer overlapping the drag band / trailing cluster, and their cards are clickable again. Conversation layout is unchanged. An upstream sync that drops this layout fix is caught by `assertDesktopForks`. Verified: 80 `ui-layout` client tests (including the new contract case), 15 shared fork-validation tests, and the package typecheck all pass; live Electron + CDP verification shows the plugins page `mainPanel` starting at top=48 (exactly below the title bar), a list card click opening the detail page, and the「‹ 插件列表」link navigating back to the list.

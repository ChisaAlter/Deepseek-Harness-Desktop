# Right Panel Below Topbar Design

Date: 2026-08-13
Status: Approved design

## Summary

On desktop, the workspace right panel currently shares the 48px caption strip with
Windows/Linux window controls. Opening it splits the topbar and places「右侧面板」in the
same row as ─ □ ×. This change keeps the desktop topbar spanning the full app-content
width (center + right) and starts the right panel below that bar. Close is the same
topbar toggle that opens the panel. Left sidebar and mobile layout stay as they are.

## Decision

Lift `WorkspaceDesktopSoftTopbar` out of `WorkspaceCenterColumn` so it is a sibling
above the center/right row in `workspace-screen.tsx`. Remove the right panel's own
header row (title + close). Delete the `rightPanelHeader` window-controls padding
role, which exists only to share the caption strip.

Do not overlay the panel with a hardcoded `top: 48` offset, and do not keep a
full-height rail that merely indents around caption buttons.

## Goals

- Desktop topbar stays one continuous 48px strip from the left-sidebar edge to the
  window's right edge while the right panel is open or closed.
- The right-panel toggle stays immediately left of ─ □ ×. It does not jump left when
  the panel opens.
- The right panel occupies the remaining height below that topbar. It never paints
  into the caption strip.
- Opening and closing the panel uses only `workspace-right-panel-toggle`.
- Window-control hit targets and Electron drag/no-drag regions stay on the topbar.

## Non-Goals

- Pulling the left session rail below a window-wide title bar.
- Changing mobile / compact explorer, which still uses `ExplorerSidebar`.
- Changing right-panel surfaces (browser, terminal, files, diff) or how they are
  created, focused, or torn down.
- Changing the floating environment inspector, except that it remains exclusive
  with the right panel as today.
- Restyling empty-state cards, surface bodies, or the topbar's other actions.
- Adding a second close control anywhere in the right panel.

## Layout

Desktop workspace chrome after the change (app-content only; left rail is outside):

```
┌─────────────────────────────────────────────┐
│  topbar (title · tools · toggle · ─ □ ×)    │  48px, full app-content width
├──────────────────────────┬──────────────────┤
│  center content          │  right panel     │
│  + terminal drawer       │  empty or surface│
└──────────────────────────┴──────────────────┘
```

`workspace-screen.tsx` ready tree becomes:

1. Optional reconnecting banner (unchanged).
2. Desktop only: `WorkspaceDesktopSoftTopbar`.
3. Existing `threePaneRow`: `WorkspaceCenterColumn` then `WorkspaceRightPanel`.

`WorkspaceCenterColumn` keeps rendering the compact `ScreenHeader` on mobile. It
stops rendering `WorkspaceDesktopSoftTopbar`. Desktop header props stay on the
center column for the mobile path; the screen also passes the same desktop props
into the lifted topbar.

`WorkspaceScreenGateShell` stays a center-column `ScreenHeader` with no right
panel. Do not lift a topbar there.

## Right Panel Chrome

`WorkspaceRightPanel` renders the rail shell and body only:

- No 48px header.
- No `workspace-right-panel-close` button.
- No `useWindowControlsPadding("rightPanelHeader")`.

Empty state still starts with「选择要打开的面板」and the four surface cards.
An active surface still uses that surface's own chrome (`FileExplorerPane`,
`TerminalPane`, `BrowserPane`, `GitDiffPane` with `hideHeaderRow` as today).

Keep the current `visible ? rail : null` mount. Do not add overlay positioning,
slide-over chrome, or a second animation system. Rail width, left border, and
background stay as they are; only the header row goes away.

`workspace.rightPanel.close` remains the toggle's accessibility label when the
panel is open. `workspace.rightPanel.title` remains the toggle tooltip and the
label when the panel is closed. Those strings are not deleted.

## Window Controls

`SOFT_TOPBAR_ELECTRON_RIGHT_PAD` stays on the desktop topbar. After this change
the topbar always reaches the window's right edge, so that pad is required
whether the panel is open or closed.

Remove:

- `WindowControlsPaddingRole` member `"rightPanelHeader"`
- The `rightPanelHeader` branch in `resolveWindowControlsPadding`
- The two `desktop-window.test.ts` cases that assert caption width on that role

No other padding role changes. Titlebar drag continues to live on
`WorkspaceDesktopSoftTopbar` via `TitlebarDragRegion`. Native caption buttons
remain the `DesktopWindowControls` overlay in `AppContainer`.

## Prototype Gate

Before implementation, land `prototypes/right-panel-below-topbar.html` showing
Windows desktop chrome in two states: panel closed and panel open. The prototype
must show:

- A continuous 48px topbar over center + right, with the toggle left of ─ □ ×
- The right panel starting below that bar, with no header title and no close
- The left session rail still full-height

Implementation must match this prototype. Web preview is not desktop acceptance.

## Tests And Verification

Unit / source-boundary:

- Update `packages/app/src/utils/desktop-window.test.ts` after removing
  `rightPanelHeader`.
- Update `workbench-fidelity-style-boundaries.test.ts` so it no longer expects
  `workspace-right-panel-close`, and so it asserts the lifted topbar lives in
  `workspace-screen.tsx` (desktop) while `WorkspaceCenterColumn` still hosts the
  compact header.
- Keep `packages/app/e2e/helpers/file-explorer.ts` on
  `workspace-right-panel-toggle` plus the files card. Do not add a close-button
  helper.

Targeted Vitest only for files that change. Do not run the full app or workspace
suite locally.

Real-surface acceptance is Windows Electron only:

- Closed: topbar toggle sits left of ─ □ ×; no right panel.
- Open empty: topbar still full-width; toggle stays put; panel content starts
  below the topbar; no「右侧面板」caption row; no × in the panel.
- Open a surface, then click the same toggle: panel closes.
- Drag the window from the topbar, including the strip above the open panel.
  Caption buttons still hit-test.

Web or Android results must not be reported as desktop verification.

## Files

Expected touch list (implementation may add a small helper test, not new
packages):

- `packages/app/src/screens/workspace/workspace-screen.tsx`
- `packages/app/src/screens/workspace/workspace-center-column.tsx`
- `packages/app/src/screens/workspace/workspace-right-panel.tsx`
- `packages/app/src/utils/desktop-window.ts`
- `packages/app/src/utils/desktop-window.test.ts`
- `packages/app/src/screens/workspace/workbench-fidelity-style-boundaries.test.ts`
- `prototypes/right-panel-below-topbar.html`
- This spec

## Out Of Scope Recap

Left rail full-height appearance, compact explorer, right-panel surface
behavior, floating inspector behavior, and topbar actions other than remaining
visible in the spanning strip are unchanged.

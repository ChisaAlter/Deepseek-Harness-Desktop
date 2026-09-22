# Agent Note: Desktop surfaces column, titlebar trailing cluster, and window-control padding

Status: implemented

English | [中文](2026-08-14-desktop-surfaces-and-titlebar.zh.md)

> Scope: the shipped four-column AppFrame, the `shell.titlebar.trailing` list slot, desktop `git` / `pty` / `preview` IPC, and the measured window-control pad. The [slot system standard](2026-07-22-slot-type-chain-implementation.md) owns composition; the [web client architecture note](2026-07-19-gui-web-client-architecture.md) owns loading and the object layer. This note does not replace those decisions.

## Problem

The desktop shell needed titlebar Git, a bottom terminal, and a far-right surfaces column without moving Inspect or rebuilding the left sidebar. A frameless window also has to keep that growing titlebar cluster clear of the painted minimize / maximize / close controls.

## Decision

AppFrame is four columns, `sidebar | conversation | details | surfaces`, plus a conversation-only terminal drawer. A shared titlebar row sits on the conversation and details columns; surfaces spans every row to the window top; the sidebar still spans full height with its logo row. Closed `details` and `surfaces` are width 0. Concession shrinks surfaces to its minimum, then details, then derived-closes surfaces, then details; the sidebar never concedes. `ctx.layout` writes surfaces and the drawer independently of details: titlebar toggles never open or close the details column, and closing one column does not close the other.

The titlebar cluster is the layout-owned list slot `shell.titlebar.trailing`, wrapped as `#dshd-shell-titlebar-trailing`. Contributors inject with [slot declaration injection](2026-08-05-slot-declaration-injection.md). Left to right: Session log (`id: 'session-log-download'`, `order: 10`), Git (`id: 'git-actions'`, `order: 20`), panel toggles (`id: 'panel-toggles'`, `order: 40`), then the Electron window controls. Toggles write only `toggleTerminalDrawer` and `toggleSurfaces`. Session log remains the same download control; it renders only while a Session is current.

Harness client plugins own the UI. Electron exposes `window.shell.git*`, `window.shell.pty*`, and `window.shell.preview*` only; the inject script does not paint Git, the terminal, or the right panel. The drawer and the Terminal surface each own a PTY session table for the workspace cwd; a pane opened in one shell does not appear in the other. The five surfaces are Browser, Terminal, Files, Diff, and Agents. Outside the desktop app, Git IPC no-ops and the Browser card is disabled.

The inject script paints only the frameless window-control plate (`#dshd-shell-controls`) and publishes `--dshd-wco-controls`. AppFrame owns caption hit testing: a 48px `.captionDrag` grid item spanning columns 1–end is the sole `-webkit-app-region: drag` rectangle (first child, so columns paint above it). Clickable breadcrumb rows, `header.actions`, utilities, tabs, surface-tab controls, `#dshd-shell-titlebar-trailing` (`width: max-content`), the sidebar wordmark and collapse toggle, and the window-control plate are `no-drag` holes. The wordmark box is `width: max-content` so the logo-row gap stays in the band. Conversation `.titleRow` / `.blankCaption` and the surfaces tab bar are not drag regions. Chromium subtracts `no-drag` rects geometrically, ignoring stacking, so every layer that can cover the band's top 48px punches its own hole: the column resize handles, `overlayLayer` entries, open phone drawers and their backdrop, and every `position: fixed` layer in client stylesheets (Modal, Menu portal, tooltips, hover cards, toasts, banners, onboarding, lightbox, drop mask, settings overlays, CordisPanel). The wallpaper background is the one exemption; it is `pointer-events: none` and a hole there would cover the viewport. Blank and draft sessions keep the header as grid row 1 so the titlebar track stays tall. AppFrame measures `#dshd-shell-titlebar-trailing` for `--dshd-titlebar-conversation-reserve`; inject does not measure the cluster. AppFrame has a shared titlebar grid row (`auto` + body + drawer). The conversation header and scroll body are subgrid items of that row pair (`ConversationRoot` is `display: contents`). Details occupies the body row, so its hairline and occupant start below the titlebar band. Surfaces spans every grid row to the window top. When surfaces is open the trailing cluster occupies columns 2–3 (`margin-right: 8px`) so Session log, Git, and panel toggles stop before column 4; window controls clear the surfaces tab bar via `margin-right: var(--dshd-wco-controls)` on that tab bar (ui-surfaces). When surfaces is closed the cluster spans to the right edge (`margin-right: var(--dshd-wco-controls, 8px)`). The trailing cluster is a grid item of that titlebar row (`justify-self: end`; `width: max-content`), not an overlay on column content. Phone and compact-header frames hide the cluster; a closed column is width 0 with no hairline, so it does not leave a hole. When the cluster remains visible over a squeezed conversation column, AppFrame publishes `--dshd-titlebar-conversation-reserve` and a `full` / `cozy` / `compact` density so the header pads and labels collapse instead of overlapping; the [titlebar crowding note](../bug-fix/2026-08-17-titlebar-crowding-density.md) owns that. The inject script is a re-runnable IIFE: a second `executeJavaScript` of the same file must not throw.

## Alternatives considered

**Paint Git, the terminal, or the right panel in `harness-chrome-inject.js`.** That file is evaluated twice (`dom-ready` then `did-finish-load`); top-level bindings throw and the catch paints the window white. Desktop chrome also has no slot, locale, or store seats.

**Replace the details column with surfaces, or let the titlebar toggles drive details.** Inspect, the trajectory TOOL inspector, and existing details open/close stay on `details`. A shared toggle would couple two independent columns.

**Import a GPU terminal emulator plus an Effect / zustand right-panel stack.** The client already composes through slots and `defineStore`. A second state stack would duplicate ownership and break the four-share props rule.

**Absolutely position the trailing cluster over the frame and inset surfaces with `margin-top`.** An overlay sits on empty-state cards and tab chrome; a 56px column spacer leaves a hole above the right column while conversation still has its own header. Surfaces spans to the window top instead; the trailing cluster stops before column 4 when that column is open so it does not overlay the tab bar.

**Inject a high-z-index 48px drag overlay.** `no-drag` on elements below cannot restore clicks. AppFrame owns one behind-the-columns caption rectangle instead. A second disjoint drag region on the surfaces tab bar is not added: Chromium then drops the earlier rectangle, so opening surfaces would stop conversation-titlebar window moves.

**Scatter `-webkit-app-region: drag` on conversation caption rows and the surfaces tab bar.** Two sibling rectangles look correct in CSS and fail as one window-move region on Windows once the right column opens.

**Position the trailing cluster with `--dshd-wco-pad`.** The pad includes the cluster's own width, so the cluster would walk left on every measure. `--dshd-wco-controls` is the controls-only inset.

**Hard-code a trailing width instead of measuring `#dshd-shell-titlebar-trailing`.** Session log, Git, and the toggles change width with locale, status, and occupancy. A constant either overlaps the window controls or leaves a permanent hole.

## Consequences

The web composition and the desktop window share the same client plugins; Electron is an IPC host, not a second UI tree. Details and surfaces can be open or closed independently. Window-control inset is the fixed controls width. AppFrame's trailing ResizeObserver is the only live cluster measurement, so adding a titlebar occupant does not require a new inject constant.

The inject script remains a closed chrome IIFE that owns only the window-control plate. Contributors that need a new titlebar control register into `shell.titlebar.trailing` with an `order` and keep Node helpers out of that file.

Desktop PR CI in `.github/workflows/test.yml` runs unit tests, vendor GUI suites, and Windows source Electron smoke. The installer workflow in `release.yml` runs the same hit probe on the packaged app. Neither workflow runs harness `test:coverage`, `typecheck`, `lint`, or `doc-sync`. New client packages stay under the harness per-file 100% coverage gate locally, with `/* v8 ignore -- <reason> */` on genuinely unreachable arms.

The user terminal is an `@xterm/xterm` VT emulator in both the conversation drawer and the Terminal surface.

## Testing

Package suites pin concession, store actions, titlebar inject/dispose, Git state, independent PTY ownership, and the five-card empty state. `src/main/harness-chrome-inject.test.js` pins the IIFE form, double-eval, pointerdown on the window-control plate, `--dshd-wco-controls` only, and the absence of a drag strip, MARK/HIT attributes, and DOM sniffing. AppFrame CSS pins one caption drag band (columns 1–end) and a max-content trailing no-drag hole; conversation and surfaces CSS pin control no-drag without a second drag rectangle. Sidebar CSS pins a max-content wordmark hole and a collapse-toggle hole so the logo-row gap stays in the band. `ui-layout/tests/caption-drag-regions.client.spec.ts` scans every stylesheet under `packages/client` and `packages/extensions`: exactly one `drag` block (`.captionDrag`) and a `no-drag` in every `position: fixed` block, with the wallpaper background as the recorded pointer-inert exemption. `apps/web/tests/desktop-chrome.e2e.ts` is the keyless assembled layout assertion that the titlebar shows Session log, Git, and the two toggles without overlapping boxes, that the right panel empty state shows the five cards, and that the branch menu opens while surfaces is open. That lane does not execute Electron `-webkit-app-region` hit testing. Source and packaged Electron smoke send `Input.dispatchMouseEvent` at real button centers after opening surfaces and require the branch and Git menus to change.

## Related

The [surfaces and terminal work-loops note](../feature/2026-08-16-surfaces-terminal-work-loops.md) owns the work loops and the capabilities this desktop does not ship. The [web GUI browser e2e lane](../testing/2026-07-24-web-gui-browser-e2e-lane.md) owns snapshot mechanics. The [slot declaration injection decision](2026-08-05-slot-declaration-injection.md) owns contributor lifetimes on `shell.titlebar.trailing`. The [titlebar crowding density note](../bug-fix/2026-08-17-titlebar-crowding-density.md) owns conversation-header reserve and label collapse.

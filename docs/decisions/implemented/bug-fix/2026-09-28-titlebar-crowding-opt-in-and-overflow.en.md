# Decision: Session log defaults to opt-in plus an overflow seat for collapsed Agent actions

Status: implemented

[中文](2026-09-28-titlebar-crowding-opt-in-and-overflow.md) | English

## Problem

On a live window the conversation title row is routinely short on space: the trailing cluster (Session log capsule, Git capsule, terminal/right-panel toggles) already consumes about 500px, and once window-control clearance is added the `conversation.session.header.actions` badges — subagent count, Agent Team, mode label — are dropped entirely by `display:none` at cozy/compact density and the 520px container breakpoint, with no way to reach them. The Session log button is also a low-frequency secondary action that permanently occupies the widest segment of the trailing cluster.

## Decision

Two separate changes:

1. **The Session log capsule becomes an Interface Settings opt-in.** `titlebarAction` in the `session-log-download` settings section flips its default from `true` to `false`; `ChromeVisibility` gains an initial-default parameter (this plugin passes `false`) and, when the initial is `false`, tightens its predicate to `value[field] === true` so loading and remote-memory snapshots cannot flash the button. The `shell.titlebar.trailing` slot registration, `/export` command, and download dialog are untouched; "Settings → Interface → Session log export" re-enables the button, and release QA verifies that path in the `interface.sessionLogSwitch` step before restoring the switch.
2. **Collapsed header actions get an overflow seat.** `ConversationSessionHeader` mounts a 28px chevron button ahead of utilities only while `data-titlebar-density` is `cozy`/`compact` — the same predicate that hides the inline band. Hover/focus previews the `conversation.session.header.actions` slot in a `role="group"` panel; clicking pins it open until Escape, an outside pointerdown, or a second click; returning to `full` density unmounts the seat and clears its state. The panel portals inside the button's own container (same escape route as the jobs menu, past `headerActions`' `overflow:hidden`) and uses the `--dsw-specific-menu` + `--dsw-elevation-panel` menu surface.

## Alternatives considered

- **Move the badges into the utilities slot**: utilities stays visible while narrow, so moving badges there means never collapsing them — against the earlier decision that the title wins; and every present or future actions entry should share one overflow destination.
- **Overflow only the subagent badge**: the band is a plugin slot — the host cannot know which entries exist; overflowing the whole band benefits every registration uniformly.
- **Move the Session log button into the overflow panel**: it belongs to the trailing cluster, not session header actions, and toggling it inside the panel would change the measured trailing width and feed back into density selection — the opt-in switch has no such feedback loop.
- **Wrap the popover in `role="menu"`**: actions entries are badge controls with their own menus and dialogs, not menuitems, so `role="group"` is the correct semantics.

## Consequences

The default titlebar loses a ~120px capsule, and crowded windows no longer silently drop the subagent/team/mode badges — when collapsed, a chevron shows them on hover and pins them on click. Existing users who never wrote `titlebarAction` land on the new hidden default; anyone who explicitly enabled it is unaffected. Two new `skeleton.client.spec.tsx` cases cover hover preview, click-to-pin, Escape close, and density round-trips; `chrome-visibility`/`client-apply`/`host`/`route`/`archive` tests track the flipped default, and `desktop-chrome.e2e.ts` uses the `sessionLogTitlebarAction` scaffold option to verify the opt-in cluster layout.

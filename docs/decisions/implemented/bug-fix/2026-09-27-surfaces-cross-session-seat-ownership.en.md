# Decision: Route classic right-panel opens by seat ownership

Status: implemented

[中文](2026-09-27-surfaces-cross-session-seat-ownership.md) | English

## Problem

`workspaces.openPath` callers (chat file mentions, terminal links) pass the originating Session explicitly. After the classic surfaces track was restored, `openClassicSurfaces` answered every session's request with the single store-action pair captured by the host's inject: a file for session B was written into the mounted seat's (session A's) store instance under a B-named bucket — the seat neither renders nor persists that bucket, so the column opened with nothing new inside and the tab was dropped on persist. The ownership guard then added exposed a deeper defect: `entry.inject` is memoized per binding object and runs once per session, so a single-slot `live` stays pinned to the old seat after a routine A→B→A switch, and every openPath for the current session is refused and silently falls back to Host opens. The same kind of cross-session leak existed on the `dshd-open-surface` preview event: `PreviewPanel` ignored `detail.sessionId`, so a foreign-session event navigated the current session's mounted Browser; and the panel's identity was derived from the main view instead of its own seat, so a Browser tab in a background session's native sidebar would accept/reject the wrong events. The global `dshd-pending-preview-url` sessionStorage slot likewise carried no session ownership, letting one seat drain a preview queued for another.

## Decision

`live` becomes `actionsBySeat`, a Map of writers keyed by seat binding key: inject runs once per binding, so the map naturally keeps each seat's writer under its own session and never stales on revisit; "current seat" is judged by the main-view retained session (the same source as the interceptor's `currentSessionId`). Requests resolve the writer for the target session:

- Target is the main-view session: write to its bucket and raise the surfaces column (collapsing the native dock).
- Target is another session whose seat was mounted: silently queue through that seat's writer into its own bucket without raising the column — matching the classic baseline of "cross-session opens don't raise the column but appear on switch-back"; what is fixed is writing into the wrong instance, not the semantic itself.
- Target seat was never mounted: return false so the caller falls back to the previous `openPath` (Host open), keeping the file visible rather than lost.
- Missing writer for the main-view session is broken wiring and keeps the original throw contract.

`PreviewPanel`'s `dshd-open-surface` listener ignores events whose `detail.sessionId` names another session; main-process popup events without a sessionId still broadcast to the current seat. The panel's session identity now reads the slot runtime's injected `sessionId` prop (session-maybe standard props, including native-sidebar seats), falling back to main-view derivation only outside seat contexts. The `dshd-pending-preview-*` sessionStorage slot gains a `dshd-pending-preview-session` tag: the three writers (surfaces, terminal, chat links) stamp the originating session next to the URL and clear any stale presentation marker, and the consumer claims the pending entry only when the tag is absent (the established sessionless contract) or equals its own seat session; a mistagged pending entry is left for the right seat to drain on mount. Session-tagged `dshd-open-surface` events get a central route that completes delivery: mounted seats only accept their own events, so the router writes a foreign event's surface into the target seat's bucket through `actionsBySeat` without raising the column, and the terminal link only raises when the target is the current or sessionless seat; a never-mounted foreign seat still has no queue path, leaving the pending slot behavior as the documented residual.

## Alternatives considered

- **Refuse every foreign-session request**: fixes the ghost write but removes the upstream baseline's cross-session queueing, losing the "tab is there when you switch back" product semantic.
- **Write `live` back from a `useEffect` in SurfacesRoot**: also fixes the stale slot, but threads an extra write-back channel through injected props and adds a React lifecycle dependency the Map avoids.
- **Leave PreviewPanel unfiltered**: keeps the cross-session navigation leak, asymmetric with the session filtering SurfacesRoot already applies.

## Consequences

After an A→B→A revisit, openPath still lands in the current session; opens originating from another session quietly queue into its tab bucket without disturbing the current column; opens for never-mounted sessions fall back to visible Host opens. Preview events and pending URLs are routed by seat ownership, so a background sidebar Browser tab no longer mis-navigates. New specs pin the main→background→main revisit, foreign-session queueing without raise, never-mounted fallback, the PreviewPanel session filter, and the pending session tag; the contract test gains `actionsBySeat`/`currentSessionId` sentinels. Leftovers: the `mini-player` restore event has no session field (pre-existing, low risk); `actionsBySeat` entries are not pruned on seat teardown (reachability is already gated by the `byId` check).

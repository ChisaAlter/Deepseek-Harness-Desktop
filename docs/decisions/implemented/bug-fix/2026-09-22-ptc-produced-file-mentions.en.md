# Decision: PTC-produced files join the closing-prose click vocabulary

Status: implemented

[中文](2026-09-22-ptc-produced-file-mentions.md) | English

## Problem

An inline-code filename in the closing prose becomes a clickable code chip only when it exists in `ui-deliverables`' produced-file vocabulary. That vocabulary previously recorded only successful root `tool/call` mutations named `write`, `edit`, or a mutating `str_replace_editor`. When the file was actually created by a `run_code`/PTC child call, the chat UI rendered the child's tool row, but an inline token such as `pelican-bike.html` had no matching path and stayed inert, so clicking it did nothing.

The real `tool/ptc-dispatch` and `tool/ptc-dispatch-start` events have no `turn` field. An earlier test fixture added `turn: 1`, hiding that contract mismatch. `ConversationNodeDefinition.match` also received only the event, so it could not place a coordinate-free PTC event into the correct turn.

A second restriction sat in the desktop open funnel: when the client Session summary temporarily had no `cwd`, `ui-surfaces` returned before resolving an absolute path, sending a target that could safely preview as a Session file resource back to the Host opener.

## Decision

Successful PTC child mutations join the produced-file vocabulary, and turn attribution comes only from the canonical Conversation assembler Location:

- `ConversationNodeDefinition.match` gains an optional `location` parameter; the assembler passes `locationIndex.locationOf(event)` on both the ordinary-Definition and fallback paths. Existing one-argument Definitions are unaffected.
- After a Location change, the assembler revisits loaded events that previously matched nothing: the boundary rebuild in `prepend` and `append` backfills only Definitions that returned null before and can match now. A Definition that already owns the event is not rematched, preserving `mergeMatches`' duplicate detection and target/fallback arbitration. Events that arrive in a recent page as `session`/`unresolved` and later gain a Location from an older page's `turn/start` therefore reach their correct turn.
- `ui-deliverables` consumes only settled `tool/ptc-dispatch`, and derives the turn from `location.turn.turn` when `location.kind === 'turn' | 'step'`. `unresolved`, `session`, and missing Locations contribute nothing; the code never guesses from neighboring events, `rootCallId`, the current turn, or UI order.
- PTC and root calls share the same mutation-argument validators. Only `isError === false` with a `name` of `write`, `edit`, or a mutating `str_replace_editor` records the normalized `arguments` path at the event's real `seq` in its owning turn.
- When the Session is known but its `cwd` is absent, `ui-surfaces` accepts an absolute path by calling `fileAddressFor(sessionId, undefined, path)` for the Session file resource. It does not require `relativeTo` and does not call `previewWorkspaceFile`, which needs a trusted `cwd + relativePath`. A relative path with no `cwd` keeps its safe Host fallback instead of guessing the scratch root.

A real no-workspace scratch Session supplies its `cwd` from the Host (for example, `dsh-home/no-workspace`); the implementation must not identify no-workspace Sessions by matching that directory name.

## Alternatives considered

- **Add a `turn` field to PTC events** — rejected: that changes the durable event contract and existing Session logs, and conflicts with the architecture's construction-guaranteed execution-enclosure relationship; old logs could not be backfilled.
- **Rebuild the tool tree from `rootCallId`/`subCallId` inside `ui-deliverables` to infer the turn** — rejected: it duplicates the assembler's tool-tree and paging semantics inside a business Definition, and can diverge on nesting, replay, and future PTC changes.
- **Match start events too, or fall back to the current turn** — rejected: a start has no success/failure fact, and "current turn" misattributes during asynchronous work or historical replay; a settled event plus the canonical Location is the authoritative source.
- **Cache only the pre-Location-change verdict inside the Definition** — rejected: `refreshMatchLocations` can only update the `location` of Matches a Context already owns, so it cannot recover an event that matched nothing and therefore belongs to no Context; attribution has to be reconsidered in the assembler.
- **Turn inline code into links by filename shape or per-token `stat()` probes** — rejected: commands, package names, configuration values, symbols, and same-named files would become buttons; only authoritative produced or delivered facts may define a file mention.
- **Bind a relative path to `$DSH_HOME/no-workspace` when `cwd` is missing** — rejected: the client cannot prove that directory is the target Session's root; relative paths keep their safe fallback while absolute paths use the Session resource.

## Consequences

Files successfully created or modified by PTC `write`/`edit`/`str_replace_editor` now enter their turn's produced vocabulary, so an exact path or unique basename in the closing prose renders as the existing code chip and opens the right Sidebar document preview through `workspaces.openPath`; repeated opens reuse the tab. During real paged loading, an event that arrives before its Turn/Step Location is known is re-attributed once an older page supplies the `turn/start`, so the produced path is not lost permanently. Failed PTC calls, reads, views, unknown tools, and malformed arguments contribute nothing, and a basename shared by two paths stays inert so the wrong file cannot open.

An absolute path with no `cwd` can still enter the Sidebar's Session file resource; a relative path with no `cwd` keeps the Host fallback. `ui-deliverables` gains a compile-time dependency on `@deepseek-ai/dsh-tools/types`. Tests cover real `turn`-less PTC start/settle events, cross-turn isolation, unresolved non-attribution, success/failure/read/unknown/malformed cases, PTC basename resolution, a known scratch `cwd` with a relative path, and missing-`cwd` absolute and relative paths.

`ConversationNodeAssembler` now backfills null→match after a Location change: the boundary rebuild in `prepend` and `append` re-evaluates only Definitions that previously declined, an event already owned by a Definition is not rematched, and `mergeMatches`' duplicate detection plus target/fallback arbitration stay intact. A focused test covers a recent page containing only a PTC settlement, an older page supplying `turn/start` to give it its correct turn, and a later Location refinement that must not duplicate the Match.

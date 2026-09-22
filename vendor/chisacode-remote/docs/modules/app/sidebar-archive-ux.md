# Sidebar archive UX

How the soft-sidebar archives sessions without flashing the list, without success
banners, and without raw RPC error strings. Server lifecycle remains
`docs/agent-lifecycle.md`; this document is the **client presentation contract**.

## Goals

- Archive feels local and quiet: the control that was pressed is the only loading surface.
- The session list does not jump while an archive is in flight.
- Success is silent: the row leaving the list is the confirmation.
- Failures are human language, mergeable, and retryable.
- Timeout is not treated as failure when the daemon may still be archiving.

## Non-goals

- No top-of-sidebar “已归档 N 个会话” success capsule.
- No optimistic hide on click (that caused the list flash users rejected).
- No raw daemon / transport error text in the primary toast path.
- No change to archive as a soft-delete on the server (`archivedAt`).

## Surfaces

| Surface              | Control                    | Loading                                          | Success                   | Failure                                                 |
| -------------------- | -------------------------- | ------------------------------------------------ | ------------------------- | ------------------------------------------------------- |
| Desktop session row  | Hover quick-archive button | Button icon → spinner; control disabled / `busy` | Row removed after confirm | Merged error toast + row stays                          |
| Compact session row  | Overflow menu “归档”       | Menu item `status="pending"` + pending label     | Row removed after confirm | Same toast path                                         |
| Desktop context menu | Context “归档”             | Same pending menu item                           | Row removed after confirm | Same toast path                                         |
| Project group menu   | “归档项目会话”             | Menu item pending for the group action           | Confirmed rows removed    | Same toast path; partial success keeps failures visible |

Prototype used while iterating: `prototypes/archive-flow-ux-prototype.html`.
**Shipped UX diverges** from that prototype on success and pending visibility
(see “History / prototype divergence” below).

## Client state model

Two independent react-query caches in `packages/app/src/hooks/use-archive-agent.ts`:

| Cache key                  | Meaning                                                                      | List visibility                                          |
| -------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `archive-agent-pending`    | RPC is in flight for this agent                                              | **Still visible** so the archive control can spin        |
| `archive-agent-suppressed` | Confirmed (or timeout-accepted) archive should stay hidden from active lists | **Hidden** until unarchive / list revalidation converges |

`useSuppressedArchiveAgentIds(serverId)` returns **only** the suppressed set.
Pending ids are **not** merged into suppression; that merge was the flash.

Helpers:

- `isArchivingAgent` / `usePendingArchiveAgentIds` — button / menu pending UI, subagent track filtering
- `setAgentArchiving` / `clearArchiveAgentPending` — pending lifecycle
- `setAgentArchiveSuppressed` / `applyArchivedAgentCloseResults` — hide + store `archivedAt` + list cache edits
- `unmarkAgentArchivedInStore` — genuine failure rollback (clear `archivedAt` + unsuppress)

## Sequence

### Single session (quick button / menu)

```
click archive
  → set pending (isArchiving = true)
  → row stays; button/menu shows spinner
  → archive_agent_request (client timeout 30s)
     success / not-found-as-success / timeout-as-in-flight
       → applyArchivedAgentCloseResults (archivedAt + suppress + drop from list caches)
       → clear pending
       → invalidate sidebar/history queries
       → row disappears (silent)
     real failure
       → clear pending (no suppress)
       → row remains
       → outcome.failedCount → merged toast with Retry
```

### Batch (project archive)

```
confirm dialog
  → filter out already-archived agents
  → prefer close_items batch RPC; fall back to sequential archiveAgent
  → pending on all targets while in flight
  → on success: apply only confirmed agent ids
  → on timeout: accept as background (suppress + hide), no error toast
  → on partial missing ids: count as failed, leave those rows visible
  → outcome drives one failure toast if failedCount > 0
```

`ArchiveAgentsOutcome`:

- `archivedCount` — confirmed / accepted
- `failedCount` + `retryInputs` — user-visible failure toast
- `backgroundCount` — timeout accepted; daemon may still be working; no error toast

## Authoritative snapshot races

Archiving bumps store `updatedAt` with the archive timestamp so pre-archive
snapshots lose the staleness race. Equal-timestamp races still happen when a
snapshot without `archivedAt` arrives with the same `updatedAt` as the
optimistic/confirmed archive.

`resolveAuthoritativeAgentSnapshot` in
`packages/app/src/utils/agent-snapshots.ts`:

- reject when `incoming.updatedAt < current.updatedAt`
- if `current.archivedAt` and `!incoming.archivedAt` and timestamps equal →
  apply incoming fields but **preserve** `archivedAt` (monotonic archive)
- otherwise apply incoming as-is (explicit unarchive uses a newer `updatedAt`)

Used by `SessionProvider`’s `applyAuthoritativeAgentSnapshot`.

## Transport

`packages/client/src/daemon-client-agent-lifecycle.ts` `archiveAgent`:

- request timeout **30s** (was 10s)
- under load the daemon commonly needs 10–12s+ (close runtime, persist, cascade)
- short timeouts produced false client failures and list flicker

Timeout classification still exists on the app side (`isArchiveTimeoutError`) for
batch/path ambiguity: treat as “still processing”, not “failed”.

## Copy

Human strings live under `sidebar.*` in `packages/app/src/i18n/index.ts`:

| Key                                                                        | Role                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `sidebar.archiving`                                                        | Menu pending label                                                                           |
| `sidebar.archiveFailedSessions`                                            | Toast title with count                                                                       |
| `sidebar.archiveFailedRestored`                                            | Toast subtitle                                                                               |
| `sidebar.retry`                                                            | Toast action                                                                                 |
| `sidebar.archivingSessions` / `archivedSessions` / `archivingInBackground` | Reserved copy from the capsule exploration; **not** shown in the shipped silent-success path |

No raw `Error.message` from the daemon on the primary archive failure path.

## Visual polish (same change set)

Desktop project header actions (⋯ / new draft) used absolute `top: 1` against
asymmetric soft padding (`paddingTop: 10` / `paddingBottom: 4`), so controls sat
above the folder label. Shipped styles:

- compact: `groupActions` → `top/bottom: 0` (full header height, centered)
- desktop: `desktopGroupActions` → `top: 10`, `bottom: 4`, `right: 10`

## Tests

- `packages/app/src/hooks/use-archive-agent.test.ts` — pending without hide, timeout accept, batch partial, snapshot `updatedAt` bump
- `packages/app/src/components/sidebar-session-list.test.tsx` — pending row stays visible; archive control busy/spinner; failure toast path
- `packages/app/src/utils/agent-snapshots.test.ts` — monotonic archive on equal timestamps

## History / prototype divergence

Early design (`prototypes/archive-flow-ux-prototype.html`) used:

1. Optimistic remove on click
2. Top progress capsule (“正在归档…”)
3. Green success capsule (“已归档 N 个会话”)
4. Neutral background capsule on timeout

Production feedback rejected (1) and (3) as flashy/ugly. Shipped contract:

1. **Keep the row** until confirm/timeout-accept
2. **Spinner only on the archive control**
3. **Silent success**
4. **Failure toast only** for real failures; timeout stays quiet and converges via suppress + refetch

Keep the prototype for historical comparison; this doc is the source of truth.

## Related

- Server archive orchestration: `docs/agent-lifecycle.md`
- Soft delete field: `docs/data-model.md` (`archivedAt`)
- Implementation: `packages/app/src/hooks/use-archive-agent.ts`, `packages/app/src/components/sidebar-session-list.tsx`

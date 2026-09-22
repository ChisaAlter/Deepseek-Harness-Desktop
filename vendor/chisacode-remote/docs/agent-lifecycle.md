# Agent lifecycle

How an agent is created, runs, becomes a subagent, gets archived, and disappears from the UI. The model spans the daemon (lifecycle, archive) and the client (tabs, the subagents track).

## States

```
initializing → idle → running → idle (or error → closed)
                 ↑        │
                 └────────┘  (agent completes a turn, awaits next prompt)
```

Each agent in `AgentManager` carries a `lastStatus` of `initializing`, `idle`, `running`, `error`, or `closed`. State transitions persist to disk and stream to subscribed clients via WebSocket.

## Relationships

Agents can launch other agents via the `create_agent` MCP tool or scoped companion MCP tools. New records may carry an optional `relation` with:

- `kind: "subagent" | "detached" | "handoff" | "team-slot"`
- `parentAgentId?: string`
- `taskId?: string`
- `source?: "mcp" | "user" | "system"`

The daemon still writes compatibility labels: `chisacode.parent-agent-id`, `chisacode.relation-kind`, and `chisacode.delegation-task-id`. Old records with only `chisacode.parent-agent-id` are read as `relation.kind = "subagent"` so existing clients and stored JSON remain valid.

The scoped companion MCP server is daemon-hosted and injected as `chisacode-companion` only when daemon MCP injection is enabled and the provider supports MCP servers. It uses an in-memory token scoped to the parent agent and exposes `delegate_to_agent`, `get_delegation_status`, `cancel_delegation`, and `get_agent_result`. The v1 delegation `taskId` is the child `agentId`.

## Archive

Archive is a **soft delete**: the agent record stays on disk with `archivedAt` set, the runtime is closed, and the agent disappears from active lists. Archive is **global** — it lives on the server and propagates to every connected client.

`create_agent_request` can opt an agent into `autoArchive`. In that mode the daemon archives the agent after the first terminal turn event (`turn_completed`, `turn_failed`, or `turn_canceled`). If the same request created a ChisaCode worktree through its `worktree` field, auto-archive archives that worktree too, which removes the agent records inside the worktree.

Archiving enters through `AgentManager.archiveAgent` and is orchestrated by `AgentArchiveController`
(`packages/server/src/server/agent/agent-archive-controller.ts`):

1. Snapshot the current session into the registry
2. Set `archivedAt` and normalize `lastStatus` away from `running`/`initializing`
3. Notify subscribers
4. Close the runtime (kills the process if still running)
5. **Cascade-archive owned children** — children whose relation kind is `subagent` or `team-slot` get archived recursively

Cascade keeps subagent fleets from outliving their orchestrator while allowing detached and handoff children to survive parent archive.

## Tabs vs archive

These are two distinct concepts that used to be conflated:

| Concept                    | Scope      | Triggers                        |
| -------------------------- | ---------- | ------------------------------- |
| **Tab** (workspace layout) | Per-client | User opens/closes a view        |
| **Archive** (lifecycle)    | Global     | Explicit archive/delete gesture |

Closing a workspace tab on an **agent** is layout-only. The agent stays unarchived, remains in the sidebar session list, and can be reopened from that list. Bulk tab close actions follow the same rule: agent tabs are removed from the local workspace layout, not archived on the daemon.

Archiving is explicit. The user must choose an archive/delete action from the sidebar, subagents track, or another lifecycle surface before the daemon marks the agent archived.

### Client archive UX (sidebar)

The soft sidebar does **not** optimistically hide a row on click. While the archive
RPC is in flight the row stays put and only the archive control shows a spinner /
pending menu state. The row leaves the list after the daemon confirms (or a client
timeout is accepted as still-in-progress). Success is silent; real failures use a
merged human-language toast with retry. Full presentation contract:
`docs/modules/app/sidebar-archive-ux.md`.

Draft tabs are not agent records. A new conversation draft remains local to the workspace until the first message is successfully sent; only then does it become an agent/session record for the workspace directory.

## The subagents track

The collapsible track above the composer in an agent's pane (`packages/app/src/subagents/track.tsx`). Membership rule (`packages/app/src/subagents/select.ts`):

```
parentAgentId === thisAgent.id
AND relationKind IN ("subagent", "team-slot")
AND !archivedAt
```

Archived subagents disappear from the track, by design. Detached and handoff children are not shown in the track. To remove a subagent from the track without closing its tab, use the **archive button (X)** on the row — it opens a confirm dialog and archives the subagent on confirm. That same archive shows the subagent leave the track on every connected client.

## Why this shape

The decision is to universally decouple "close tab" from "archive":

- **Closing an agent tab is layout-only** — fixes the lossy "close a view, lose the session" flow
- **Archive/delete buttons own lifecycle** — sidebar rows and track rows provide explicit global lifecycle gestures
- **Cascade archive on parent** — keeps subagents from leaking when the parent is explicitly archived
- **Drafts become sessions only after send** — unsent new conversations do not create sidebar records

## Limitations

### Legacy relationship records

Records created before the relation model only have `chisacode.parent-agent-id`. They are treated as `subagent` relations for track membership and archive cascade. To make a child survive parent archive, create or update it with `relation.kind = "detached"` or `"handoff"`.

### Subagent accumulation under long-lived parents

A parent that spawns many subagents will see the track grow. There's no automatic cleanup for completed subagents — the user prunes via the archive button on each row. A bulk gesture (e.g. "archive all idle children") could land later if this becomes a real problem.

### Cross-client tab dismissal

Closing a subagent's tab on one client doesn't affect other clients' layouts. This is the expected behavior of decoupled tabs and is consistent with how layouts have always worked. Archive remains the global gesture for cross-client cleanup.

## Storage

```
$CHISACODE_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

Each agent is a single JSON file. Fields relevant to this doc:

| Field                                 | Type          | Meaning                                                       |
| ------------------------------------- | ------------- | ------------------------------------------------------------- |
| `id`                                  | `string`      | Stable identifier                                             |
| `archivedAt`                          | `string?`     | Soft-delete timestamp (ISO 8601)                              |
| `labels["chisacode.parent-agent-id"]` | `string?`     | Parent agent ID, set automatically by `create_agent` MCP tool |
| `labels["chisacode.relation-kind"]`   | `string?`     | Compatibility mirror of `relation.kind`                       |
| `relation`                            | `object?`     | Rich parent/delegation relation metadata                      |
| `lastStatus`                          | `AgentStatus` | `initializing` / `idle` / `running` / `error` / `closed`      |

See [`docs/data-model.md`](./data-model.md) for the full agent record.

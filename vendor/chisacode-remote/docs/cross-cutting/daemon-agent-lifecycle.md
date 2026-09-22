# Daemon And Agent Lifecycle

Use this when changing agent states, timeline behavior, archive/delete semantics, parent-child relationships, MCP-created subagents, persistence, or client state derived from daemon lifecycle.

## Modules

- `server`: source of truth for lifecycle, archive, persistence, timeline, subscribers, MCP child creation.
- `protocol`: message shapes for lifecycle updates, timeline fetches, permissions, and compatibility gates.
- `client`: stream processing, request correlation, reconnect behavior.
- `app`: tabs, sidebar, subagents track, composer behavior, host/session runtime state.
- `cli`: daemon commands and agent lifecycle commands.
- `desktop`: managed daemon interaction and desktop-hosted client behavior.

## Existing Docs

- `docs/agent-lifecycle.md`
- `docs/architecture.md`
- `docs/data-model.md`
- `docs/timeline-sync.md`

## Invariants

- Agent lifecycle is daemon-owned and persists to disk.
- Closing a UI tab is layout-only; archive is the global lifecycle gesture.
- Timeline fetch is authoritative; live stream is for immediacy.
- Parent-child relations currently use one label and do not distinguish detached handoffs from subagents.
- Do not restart the main daemon on `localhost:6767` without explicit permission.

## Handoff Checklist

1. Identify which lifecycle state or timeline contract changes.
2. Check persistence compatibility for existing agent JSON.
3. Check protocol compatibility for old clients and daemons.
4. Update app/CLI behavior only after daemon semantics are clear.
5. Use targeted tests around the changed lifecycle path.

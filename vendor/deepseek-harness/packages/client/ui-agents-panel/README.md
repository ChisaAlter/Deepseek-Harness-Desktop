# @deepseek-ai/dsh-client-ui-agents-panel

English | [中文](README.zh.md)

Right-panel Agents occupant of `surfaces.agents` (`single`, `session-maybe`, declared by ui-surfaces). Lists the current session's subagents from the existing session snapshot (`subagentsByParent`, then `byId` children). It does not spawn, dispatch, or invent a new kernel. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

When the catalog and lineage are empty the panel shows the empty state. Rows open the child session. Background jobs from `jobsBySession` list below the roster; lifecycle status uses locale copy, while `label` and `detail` stay the producer strings.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; AgentsPanel remains package-internal behind the slot registration.

## Model Experience

None, as the Agents surface only reads the session snapshot for display; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No workflow grouping** — the panel lists direct children; it does not fold workflow batches.
- **Jobs are read-only** — the panel lists `jobsBySession` and does not kill tasks.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.

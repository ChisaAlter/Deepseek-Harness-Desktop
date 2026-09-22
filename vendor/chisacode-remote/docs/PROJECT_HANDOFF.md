# ChisaCode Project Handoff

This is the entry point for agents taking over work in this repository. Start here, then jump to the module or cross-cutting document that matches the task.

## What This Project Is

ChisaCode is a local-first control surface for AI coding agents. A local daemon manages agent processes and state, clients connect over WebSocket, and optional relay support allows encrypted remote access. The workspace is an npm monorepo requiring Node.js 22 or newer without pinning an exact version.

## First Reads

1. `AGENTS.md` for the compact operating checklist.
2. `CLAUDE.md` for standing repo guidance and hard rules.
3. `docs/architecture.md` for system shape.
4. `docs/development.md` for dev, build, and daemon-state gotchas.
5. `docs/ARCHITECTURE_MAP.md` for module and cross-cutting ownership.

## Knowledge Graphs

- Project graph: `docs/knowledge-graphs/project-knowledge-graph.json`
- Dashboard-compatible aggregate: `.understand-anything/knowledge-graph.json`
- Module graphs: `docs/modules/<module>/knowledge-graph.json`
- Generator: `scripts/generate-modular-knowledge-graphs.mjs`

Refresh graphs after structural changes:

```bash
node scripts/generate-modular-knowledge-graphs.mjs
```

## Module Entry Points

| Module             | Role                                                                    | Handoff                                     |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------- |
| protocol           | Wire schemas, protocol constants, binary frames, compatibility rules    | `docs/modules/protocol/README.md`           |
| client             | WebSocket transport and SDK facade                                      | `docs/modules/client/README.md`             |
| server             | Local daemon, agent lifecycle, storage, providers, MCP, relay transport | `docs/modules/server/README.md`             |
| app                | Expo client for mobile, browser web, and desktop renderer UI            | `docs/modules/app/README.md`                |
| cli                | Terminal command surface over the daemon protocol                       | `docs/modules/cli/README.md`                |
| desktop            | Electron shell and managed daemon integration                           | `docs/modules/desktop/README.md`            |
| relay              | End-to-end encrypted remote bridge                                      | `docs/modules/relay/README.md`              |
| highlight          | Shared syntax highlighting support                                      | `docs/modules/highlight/README.md`          |
| expo-two-way-audio | Native two-way audio module                                             | `docs/modules/expo-two-way-audio/README.md` |

## Cross-Cutting Entry Points

| Topic                                             | Use When                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `docs/cross-cutting/provider-plumbing.md`         | Adding providers, custom provider config, model discovery, provider settings |
| `docs/cross-cutting/daemon-agent-lifecycle.md`    | Changing agent states, archive behavior, timelines, subagents, persistence   |
| `docs/cross-cutting/websocket-rpc-protocol.md`    | Adding or migrating WebSocket RPCs and protocol messages                     |
| `docs/cross-cutting/desktop-daemon-spawn.md`      | Changing desktop startup, managed daemon behavior, Electron-specific wiring  |
| `docs/cross-cutting/app-platform-boundaries.md`   | Touching app code that must work across native, browser web, and Electron    |
| `docs/cross-cutting/relay-security-boundaries.md` | Changing relay, pairing, encryption, or remote access behavior               |

## Parallel Development Rule

Use module ownership for work allocation, but use cross-cutting docs for impact analysis. A task can be assigned to one module only when its graph dependencies and cross-cutting topic do not require simultaneous changes elsewhere.

Before starting a module-local task, check:

1. The module README.
2. The module `knowledge-graph.json`.
3. Any cross-cutting topic that names the module.
4. The relevant existing docs under `docs/`.

## Verification Rule

Do not run full test suites locally unless explicitly asked. Use targeted tests and package build chains:

```bash
npm run build:client
npm run build:server
npm run build:app-deps
npm run lint -- <changed-files>
npm run format:files -- <changed-files>
```

Run `npm run typecheck` only when the edit touches TypeScript behavior broadly enough to justify the cost.

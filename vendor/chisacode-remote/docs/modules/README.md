# Module Handoff Index

Each module directory contains two durable handoff assets:

- `README.md`: human-readable ownership, workflows, boundaries, and verification.
- `knowledge-graph.json`: generated structural graph for agent navigation.

The module graph is intentionally local. Use `docs/PROJECT_HANDOFF.md` and `docs/ARCHITECTURE_MAP.md` for system-level routing.

## Modules

| Module               | Package                         | Role                                                 |
| -------------------- | ------------------------------- | ---------------------------------------------------- |
| `protocol`           | `@chisacode/protocol`           | Shared schemas, wire types, binary frame codecs      |
| `client`             | `@chisacode/client`             | WebSocket driver and SDK facade                      |
| `server`             | `@chisacode/server`             | Local daemon, providers, state, MCP, relay transport |
| `app`                | `@chisacode/app`                | Expo mobile/web client and desktop renderer UI       |
| `cli`                | `@chisacode/cli`                | Terminal command surface                             |
| `desktop`            | `@chisacode/desktop`            | Electron wrapper and managed daemon                  |
| `relay`              | `@chisacode/relay`              | End-to-end encrypted relay                           |
| `highlight`          | `@chisacode/highlight`          | Syntax highlighting support                          |
| `expo-two-way-audio` | `@chisacode/expo-two-way-audio` | Native two-way audio module                          |

## Refresh

```bash
node scripts/generate-modular-knowledge-graphs.mjs
```

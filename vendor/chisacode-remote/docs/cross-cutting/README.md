# Cross-Cutting Handoff Index

Use these documents when a task cannot be safely owned by one package alone.

| Topic                          | Modules Usually Involved                           |
| ------------------------------ | -------------------------------------------------- |
| `provider-plumbing.md`         | protocol, server, client, app, cli                 |
| `daemon-agent-lifecycle.md`    | server, protocol, client, app, cli, desktop        |
| `websocket-rpc-protocol.md`    | protocol, server, client, app, cli, desktop        |
| `desktop-daemon-spawn.md`      | desktop, server, app, client, protocol             |
| `app-platform-boundaries.md`   | app, desktop, expo-two-way-audio, client, protocol |
| `relay-security-boundaries.md` | relay, server, client, app, desktop                |

When assigning parallel agents, make one agent own the cross-cutting doc and module coordination if the task appears here.

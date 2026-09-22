# Architecture

ChisaCode is a client-server system for monitoring and controlling local AI coding agents. The daemon runs on your machine, manages agent processes, and streams their output in real time over WebSocket. Clients (mobile app, CLI, desktop app) connect to the daemon to observe and interact with agents.

The daemon is local-first; relay metadata may be visible and providers may receive prompts. ChisaCode is local-first.

## System overview

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Mobile App  │    │     CLI     │    │ Desktop App │
│   (Expo)     │    │ (Commander) │    │ (Electron)  │
└──────┬───────┘    └──────┬──────┘    └──────┬──────┘
       │                   │                  │
       │    WebSocket      │    WebSocket     │    Managed subprocess
       │    (direct or     │    (direct)      │    + WebSocket
       │     via relay)    │                  │
       └───────────┬───────┴──────────────────┘
                   │
            ┌──────▼──────┐
            │   Daemon    │
            │  (Node.js)  │
            └──────┬──────┘
                   │
      ┌────────────┼────────────┬────────────┬────────────┬────────────┐
      │            │            │            │            │            │
┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
│  Claude   │ │   Codex   │ │ OpenCode  │ │    Pi     │ │ Kimi Code │ │ Grok Build│
│  Agent    │ │   Agent   │ │   Agent   │ │   Agent   │ │    ACP    │ │    ACP    │
│  SDK      │ │  Server   │ │           │ │    RPC    │ │           │ │           │
└───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘
```

## Components at a glance

- **Daemon:** Local server that spawns and manages agent processes and exposes the WebSocket API.
- **App:** Cross-platform Expo client for iOS, Android, web, and the shared UI used by desktop.
- **CLI:** Terminal interface for agent workflows that can also start and manage the daemon.
- **Desktop app:** Electron wrapper around the web app that bundles and auto-manages its own daemon.
- **Relay:** Optional encrypted bridge for remote access without opening ports directly.

## Packages

### `packages/server` — The daemon

The heart of ChisaCode. A Node.js process that:

- Listens for WebSocket connections from clients
- Manages agent lifecycle (create, run, stop, resume, archive)
- Streams agent output in real time via a timeline model
- Exposes an MCP server for agent-to-agent control
- Optionally connects outbound to a relay for remote access

All paths are under `packages/server/src/`.

**Key modules:**

| Module                          | Responsibility                                                               |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `server/bootstrap.ts`           | Daemon initialization: HTTP server, WS server, agent manager, storage, relay |
| `server/websocket-server.ts`    | WebSocket connection management, hello handshake, binary frame routing       |
| `server/session.ts`             | Per-client session state, timeline subscriptions, terminal operations        |
| `server/agent/agent-manager.ts` | Agent lifecycle state machine, timeline tracking, subscriber management      |
| `server/agent/agent-storage.ts` | File-backed JSON persistence at `$CHISACODE_HOME/agents/`                    |
| `server/agent/mcp-server.ts`    | MCP server for agent control, delegation, permissions, timeouts              |
| `server/agent-index/`           | Optional SQLite metadata index rebuilt from agent JSON                       |
| `server/agent/providers/`       | Provider adapters (see "Agent providers" below)                              |
| `server/relay-transport.ts`     | Outbound relay connection with E2E encryption                                |
| `server/schedule/`              | Cron-based scheduled agents                                                  |
| `server/loop-service.ts`        | Looping agent runs that retry until an exit condition                        |
| `server/chat/`                  | Chat rooms for agent-to-agent and human-to-agent messaging                   |

### `packages/protocol` — Wire schemas and shared protocol types

The source of truth for WebSocket messages, binary frame codecs, endpoint parsing,
agent timeline types, provider config schemas, and other values shared by daemon
and clients. Server, app, CLI, and `@chisacode/client` all depend on this package;
it does not depend on the server.

### `packages/client` — Daemon client library and SDK facade

Owns the low-level daemon WebSocket driver plus the higher-level `ChisaCodeClient`
facade. App and CLI may import the low-level driver from
`@chisacode/client/internal/daemon-client` during migration, while new SDK-shaped
code imports from `@chisacode/client`.

### `packages/app` — Mobile + web client (Expo)

Cross-platform React Native app that connects to one or more daemons.

- Expo Router navigation (`/h/[serverId]/workspace/[workspaceId]`, `/h/[serverId]/agent/[agentId]`, etc.)
- `HostRuntimeController` manages saved host connections, reconnection, and per-host runtime state
- `SessionContext` wraps the daemon client for the active session
- Composer UI and submit/draft behavior live in `packages/app/src/composer/`; screens and panels should integrate it from there instead of dropping composer internals into `components/`, `hooks/`, or `screens/workspace/`
- Timeline reducers in `timeline/session-stream-reducers.ts` handle compaction, gap detection, sequence-based deduplication
- Timeline sync correctness is documented in [docs/timeline-sync.md](timeline-sync.md): live streams are for immediacy, `fetch_agent_timeline_request` is authoritative, and catch-up is paged but complete.
- Voice features: dictation (STT) and voice agent (realtime)

### `packages/cli` — Command-line client

Commander.js CLI with Docker-style commands. Common agent operations are also exposed at the top level (e.g. `chisacode ls`, `chisacode run`).

- `chisacode agent ls/run/import/attach/logs/stop/delete/send/inspect/wait/archive/reload/update/mode`
- `chisacode daemon start/stop/restart/status/pair/set-password`
- `chisacode chat ls/create/inspect/post/read/wait/delete`
- `chisacode terminal ls/create/capture/send-keys/kill`
- `chisacode loop run/ls/inspect/logs/stop`
- `chisacode schedule create/ls/inspect/update/pause/resume/run-once/logs/delete`
- `chisacode provider ls/inspect/models/install/update/reinstall`
- `chisacode permit allow/deny/ls`
- `chisacode worktree create/ls/archive`
- `chisacode speech …`

Communicates with the daemon via the same WebSocket protocol as the app.

### `packages/relay` — E2E encrypted relay

Enables remote access when the daemon is behind a firewall.

- Curve25519 ECDH key exchange + XSalsa20-Poly1305 (NaCl `box`) encryption
- Relay server is payload-confidential (metadata still visible) — it routes encrypted bytes, cannot read E2EE payload content (metadata remains visible)
- Client and daemon channels with identical API (`createClientChannel`, `createDaemonChannel`)
- Pairing via QR code transfers the daemon's public key to the client
- Self-hosted relays opt into TLS with `daemon.relay.useTls` or `CHISACODE_RELAY_USE_TLS=true`; the public (client-facing) TLS setting can be overridden independently via `daemon.relay.publicUseTls` or `CHISACODE_RELAY_PUBLIC_USE_TLS`

See [SECURITY.md](../SECURITY.md) for the full threat model.

### `packages/desktop` — Desktop app (Electron)

Electron wrapper for macOS, Linux, and Windows.

- Can spawn the daemon as a managed subprocess
- Native file access for workspace integration
- Same WebSocket client as mobile app

## WebSocket protocol

All clients speak the same WebSocket protocol over a single connection that mixes JSON text frames and a small binary framing for terminal streams. Schemas live in `packages/protocol/src/messages.ts`.

**Handshake:**

```
Client → Server:  WSHelloMessage {
                    type: "hello",
                    clientId,
                    clientType: "mobile" | "browser" | "cli" | "mcp",
                    protocolVersion,
                    appVersion?,
                    capabilities?: { voice?, pushNotifications?, ... },
                  }
Server → Client:  status message with payload { status: "server_info",
                    serverId, hostname, version, capabilities?, features }
```

There is no dedicated welcome message; the server emits a `status` session message after accepting the hello, then begins streaming. The session stores client capabilities from the hello and rehydrates them on reconnect, so the wire boundary can ask one question: `session.supports(...)`.

**Top-level WS envelopes** are `hello`, `recording_state`, `ping`/`pong`, and `session` (which wraps the rich union of session messages).

Client liveness checks use the top-level JSON `ping`/`pong` envelope, not a session RPC and not RFC6455 protocol ping. The app runs through browser and React Native WebSocket APIs, which do not expose protocol ping, so this envelope is the portable way to test the direct or relay data path. Session RPC timeouts are operation failures and must not be treated as proof that the socket is dead.

New session RPCs use dotted names with `.request` and `.response` suffixes, such as `checkout.github.set_auto_merge.request` and `checkout.github.set_auto_merge.response`. See [rpc-namespacing.md](rpc-namespacing.md) for the convention and migration rules for older flat RPC names.

**Notable session message types:**

- `agent_update` — Agent state changed (status, title, labels)
- `agent_stream` — New timeline event from a running agent
- `workspace_update`, `script_status_update`, `workspace_setup_progress` — Workspace state
- `agent_permission_request` / `agent_permission_resolved` — Tool-call permission flow
- `agent_deleted`, `agent_archived`, `agent_status`, `agent_list`
- `checkout_status_update`, `checkout_diff_update`, and the full `checkout_*` request/response set for git operations
- Terminal subscribe/input/capture commands
- Voice/dictation streaming events (`dictation_stream_*`, `assistant_chunk`, `audio_output`, `transcription_result`)
- Request/response pairs for fetch, list, create, etc., correlated by `requestId`; failures use `rpc_error`

**Binary frames (terminal stream protocol):**

Terminal I/O is sent as binary WebSocket frames decoded by `decodeTerminalStreamFrame` in `shared/binary-frames/terminal.ts`. The layout is:

- 1-byte opcode: `Output (0x01)`, `Input (0x02)`, `Resize (0x03)`, `Snapshot (0x04)`
- 1-byte slot: terminal slot id
- variable payload: bytes for output/input, JSON-encoded `{ rows, cols }` for resize, terminal snapshot for snapshot

There is also a separate file-transfer binary frame format in the same directory, used for download/upload streams.

### Compatibility rules

- WebSocket schemas are append-only. Add fields, do not remove fields, and never make optional fields required.
- New wire enum values must be gated at serialization with `session.supports(CLIENT_CAPS.someCapability)`.
- `Session` stores client capabilities from the `hello` handshake and rehydrates them on reconnect, so the wire boundary can ask one question: `session.supports(...)`.

Example: adding a new enum value

```ts
// 1. Add CLIENT_CAPS.newThing = "new_thing"
// 2. Let new clients advertise it in WS hello
// 3. Keep the shared producer schema strict
// 4. Gate the new emitted value: session.supports(CLIENT_CAPS.newThing) ? "new_value" : "old_value"
```

## Agent lifecycle

The lifecycle states are defined in `shared/agent-lifecycle.ts`:

```
initializing → idle ⇄ running
        ↓       ↓        ↓
              error
                ↓
              closed
```

- `initializing` — provider session is being created
- `idle` — has a live session, awaiting the next prompt
- `running` — provider is currently producing a turn
- `error` — last attempt failed; session is still attached
- `closed` — terminal state, no live session

`ManagedAgent` is a discriminated union over those lifecycle tags. Notes:

- **AgentManager** is the source of truth for agent state and broadcasts updates to all subscribers
- Timeline is append-only with epochs (each run starts a new epoch). Storage uses sequence numbers for client-side dedup; the default fetch page is 200 items
- Timeline row `timestamp` values are canonical daemon-owned timestamps. Providers may supply original replay timestamps, but clients must not guess timestamp trust or hide time UI based on local clock heuristics.
- Events stream to connected clients in real time; correctness is backed by authoritative timeline fetches and paged-to-completion catch-up.
- Agent state persists to `$CHISACODE_HOME/agents/{cwd-with-dashes}/{agent-id}.json` (timeline rows live alongside the record)

### Agent relationships and delegation

Agent parentage is modeled as an optional `AgentRelation` instead of treating every
`parentAgentId` label as a true lifecycle child. The canonical relation kinds are
`subagent`, `team-slot`, `handoff`, and `detached`.

- `subagent` and `team-slot` are owned by the parent lifecycle and are cascade-archived when the parent is archived.
- `handoff` and `detached` keep their parent reference for provenance but survive parent archive.
- Legacy records that only have `chisacode.parent-agent-id` still derive a `subagent` relation.
- Compatibility labels remain on stored records and snapshots: `chisacode.parent-agent-id`, `chisacode.relation-kind`, and `chisacode.delegation-task-id`.

The daemon MCP endpoint continues to expose the existing `create_agent` tool. When
daemon MCP injection is enabled and a provider supports MCP servers, new agent
sessions also receive a scoped `chisacode-companion` HTTP MCP server. Its URL
contains a daemon-local, short-lived token scoped to the parent agent. Companion
tools can delegate to a child agent, poll status, cancel the delegated run, and
read the capped final assistant text. The companion token is not persisted.

## Agent providers

Each provider implements the `AgentClient` interface in `agent/agent-sdk-types.ts`. Provider implementations live in `agent/providers/`.

The built-in, user-facing providers are Claude, Codex, OpenCode, Pi, Kimi Code, and Grok Build. Additional adapters exist in the same directory for generic ACP-compatible agents and internal use:

| Provider           | Wraps                                | Session format                                     |
| ------------------ | ------------------------------------ | -------------------------------------------------- |
| Claude (`claude/`) | Anthropic Agent SDK                  | `~/.claude/projects/{cwd}/{session-id}.jsonl`      |
| Codex              | Codex AppServer (`codex-app-server`) | `~/.codex/sessions/{date}/rollout-{ts}-{id}.jsonl` |
| OpenCode           | OpenCode server / CLI                | Provider-managed                                   |
| Pi                 | Local Pi RPC process                 | Provider-managed                                   |
| Kimi Code          | Kimi ACP command                     | Provider-managed                                   |
| Grok Build         | Grok Build ACP command               | Provider-managed                                   |
| Generic ACP        | Configured ACP command               | Provider-managed                                   |
| Mock load test     | In-process fake                      | In-memory                                          |

All providers:

- Handle their own authentication (ChisaCode does not manage API keys)
- Support session resume via persistence handles
- Map tool calls to a normalized `ToolCallDetail` type
- Expose provider-specific modes (plan, default, full-access)

Provider snapshots include lightweight tooling metadata when available:
installed/latest version, version status, package name, install/update flags,
and the check timestamp. Provider diagnostics are intentionally operational but
secret-conscious: they report effective argv, resolved command path, probe cwd,
environment variable presence only, MCP injection support/enabled state, and
tooling version metadata.

## Assistant presets

Assistant presets are draft templates for the new-agent form. Built-in presets
live in protocol source, while user presets load from
`$CHISACODE_HOME/presets/*.json`. The App, `chisacode preset ls`, and top-level
`list_agent_presets` MCP tool read the same daemon catalog. Agent-scoped MCP
sessions intentionally do not receive preset discovery because user presets may
contain private system prompts, skill ids, and MCP server ids.

Applying a preset only fills provider, mode, model, system prompt, and sample
prompt fields; it does not start an agent. Missing providers, modes, or models
leave the existing draft selection in place and surface a non-fatal UI warning.
Skill and MCP server ids remain catalog metadata until the draft API gains a
resolver for those references, so the App reports them as unapplied instead of
silently pretending they were attached.

## Data flow: running an agent

1. Client sends `CreateAgentRequestMessage` with config (prompt, cwd, provider, model, mode)
2. Session routes to `AgentManager.create()`
3. AgentManager creates a `ManagedAgent`, initializes provider session
4. Provider runs the agent → emits `AgentStreamEvent` items
5. Events append to the agent timeline, broadcast to all subscribed clients
6. Tool calls are normalized to `ToolCallDetail` (shell, read, edit, write, search, etc.)
7. Permission requests flow: agent → server → client → user decision → server → agent

## Storage

`$CHISACODE_HOME` defaults to `~/.chisacode`. The most important files:

```
$CHISACODE_HOME/
├── agents/{cwd-with-dashes}/{agent-id}.json   # Agent record + persisted timeline rows
├── index/agent-index.sqlite                    # Optional rebuildable agent metadata index
├── presets/*.json                              # User assistant presets
├── projects/projects.json                      # Project registry
├── projects/workspaces.json                    # Workspace registry
├── chat/                                       # Chat rooms
├── schedules/                                  # Scheduled-agent definitions and runs
├── loops/                                      # Loop runs and logs
├── config.json                                 # Daemon config (mutable)
├── daemon-keypair.json                         # Daemon identity for relay/E2EE
├── push-tokens.json                            # Mobile push tokens
├── chisacode.sock / chisacode.pid                      # Local IPC socket and pidfile
└── daemon.log                                  # Daemon trace logs (rotated)
```

## Deployment models

1. **Local daemon** (default): `chisacode daemon start` on `127.0.0.1:6767`
2. **Managed desktop**: Electron app spawns daemon as subprocess
3. **Remote + relay**: Daemon behind firewall, relay bridges with E2E encryption

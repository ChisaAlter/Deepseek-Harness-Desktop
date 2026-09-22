# ChisaCode

**Local-first control surface for coding agents.**

> Language: **English** | [简体中文](README.zh-CN.md)

<p align="center">
  <a href="https://github.com/ChisaAlter/ChisaCode/releases">Releases</a>
  ·
  <a href="docs/cli.md">CLI</a>
  ·
  <a href="docs/custom-providers.md">Providers</a>
  ·
  <a href="SECURITY.md">Security</a>
  ·
  <a href="LICENSE">AGPL-3.0-or-later</a>
</p>

ChisaCode runs a local daemon on your machine, starts the agent CLIs you already use, and lets desktop, Android, web, and CLI clients watch and control the same sessions.

It does not host models and it is not a cloud coding agent. You install and log into the underlying provider CLIs; ChisaCode starts, hosts, streams, and orchestrates them.

Default GitHub Release artifacts are **Windows desktop** and the **Android APK**. Source still contains Electron, Expo, and CLI surfaces for local development.

## Built-in providers

Provider IDs come from `packages/protocol/src/provider-manifest.ts`:

| ID          | Label            | Runtime ChisaCode expects                                                                          |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `claude`    | Claude           | `claude` CLI                                                                                       |
| `codex`     | Codex            | `codex` CLI                                                                                        |
| `opencode`  | OpenCode         | `opencode` CLI / server                                                                            |
| `pi`        | Pi               | `pi` CLI                                                                                           |
| `kimi`      | Kimi Code        | `kimi acp` CLI                                                                                     |
| `grokbuild` | Grok Build       | `grok agent stdio`                                                                                 |
| `dsh`       | DeepSeek Harness | `dsh-acp-demo` ACP transport (`@deepseek-ai/dsh` + `@deepseek-ai/dsh-acp-demo`, pinned rc channel) |

Custom providers live under `agents.providers` in `$CHISACODE_HOME/config.json`. Each custom entry must `extends` one of the IDs above, or `extends: "acp"` for a generic Agent Client Protocol command. See [custom providers](docs/custom-providers.md).

## What it does

- Starts and hosts agent processes through a local Node.js daemon
- Streams output, tool calls, permission prompts, and status to every connected client
- Lets desktop, Android, web, and CLI clients share one daemon
- Opens git projects in the directory you pick; extra isolated worktrees are opt-in, not the default
- Exposes a Docker-style CLI for agents, providers, worktrees, schedules, terminals, loops, chat, permissions, speech, and the daemon
- Exposes MCP tools so an agent can create or control other ChisaCode agents
- Supports an untrusted E2E-encrypted relay for remote access; metadata remains visible, and selected providers still receive prompts

## Install

Download the current Windows installer or Android APK from [GitHub Releases](https://github.com/ChisaAlter/ChisaCode/releases).

The desktop app starts its built-in daemon on cold start. From Settings you can install the bundled CLI so `chisacode` matches that app version.

```bash
chisacode daemon status
chisacode provider ls
chisacode run --provider codex "review this repository"
```

## Develop from source

**Prerequisites:** Node.js 22 or newer on `PATH`, npm workspaces, Git.

```bash
git clone https://github.com/ChisaAlter/ChisaCode.git
cd ChisaCode
npm ci

npm run dev:win      # Windows: daemon on localhost:6767 + Expo
npm run dev          # macOS / Linux: portless daemon + Expo names

npm run dev:server   # daemon only
npm run dev:app      # Expo app only
npm run dev:desktop  # Electron desktop app
```

Checkout CLI (not a global install):

```bash
npm run cli -- provider ls
npm run cli -- daemon status
npm run cli -- run --provider codex "check this repository"
```

Daemon logs: `$CHISACODE_HOME/daemon.log` (desktop/stable default `~/.chisacode`). Set `CHISACODE_LOG_LEVEL=trace` for provider and session traces.

Workspace package imports resolve through compiled `dist/`. Rebuild the producing package before diagnosing cross-package type errors:

```bash
npm run build:client       # protocol → client
npm run build:server-deps  # highlight → relay → protocol → client
npm run build:server       # server-deps → server → cli
npm run build:app-deps     # highlight → protocol → client → expo-two-way-audio
```

## CLI

```bash
chisacode ls
chisacode run --provider claude "fix the failing tests"
chisacode attach <agent-id>
chisacode send <agent-id> "also update the docs"
chisacode wait <agent-id>

chisacode provider ls
chisacode provider inspect codex
chisacode provider models claude

chisacode worktree ls
chisacode schedule create --every 5m "check whether CI is still green"
chisacode terminal create --cwd .
```

Full command reference: [docs/cli.md](docs/cli.md).

## Repository map

This is an npm workspace monorepo. Default branch: `cn-main`.

| Package                         | Role                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `@chisacode/protocol`           | WebSocket schemas, provider manifests, wire types               |
| `@chisacode/client`             | Daemon WebSocket driver and SDK                                 |
| `@chisacode/server`             | Local daemon, provider runtimes, storage, MCP, relay, schedules |
| `@chisacode/app`                | Expo client for Android, iOS, web, and the desktop renderer     |
| `@chisacode/desktop`            | Electron shell; Windows is the default shipped desktop artifact |
| `@chisacode/cli`                | `chisacode` command line                                        |
| `@chisacode/relay`              | E2E-encrypted relay transport                                   |
| `@chisacode/highlight`          | Shared syntax highlighting                                      |
| `@chisacode/expo-two-way-audio` | Native two-way audio                                            |

```
Clients (desktop / Android / web / CLI)
        │  WebSocket (direct or relay)
        ▼
   Local daemon (Node.js)
        │
        ├── Claude / Codex / OpenCode / Pi / Kimi Code / Grok Build
        └── custom providers (`extends` built-in or `acp`)
```

Agent state is file-backed JSON under `$CHISACODE_HOME/agents/`.

## Docs

| Document                                             | Topic                                       |
| ---------------------------------------------------- | ------------------------------------------- |
| [docs/product.md](docs/product.md)                   | What ChisaCode is and who it is for         |
| [docs/architecture.md](docs/architecture.md)         | System design and data flow                 |
| [docs/development.md](docs/development.md)           | Dev server, `CHISACODE_HOME`, build gotchas |
| [docs/cli.md](docs/cli.md)                           | CLI reference                               |
| [docs/providers.md](docs/providers.md)               | Adding a built-in provider                  |
| [docs/custom-providers.md](docs/custom-providers.md) | User-facing custom provider config          |
| [docs/testing.md](docs/testing.md)                   | How tests are written here                  |
| [docs/release.md](docs/release.md)                   | Windows + Android release playbook          |
| [SECURITY.md](SECURITY.md)                           | Threat model and vulnerability reporting    |
| [CONTRIBUTING.md](CONTRIBUTING.md)                   | Setup, style, and PR checklist              |

Contributor rules that the code actually enforces:

- The WebSocket protocol is backward-compatible. Do not remove fields or make optional fields required.
- New features gate on `server_info.features.*`. There is no degraded fallback for old daemons.
- Do not run the full test suite locally. Run the changed file: `npx vitest run <file> --bail=1`
- Format with `npm run format` (oxfmt). Lint with `npm run lint` (oxlint). Typecheck after every change.

## Security

- Relay application traffic uses Curve25519 ECDH + XSalsa20-Poly1305. The relay is untrusted; metadata stays visible.
- The daemon binds `127.0.0.1` by default. Binding `0.0.0.0` / `::` without a password is fail-closed unless you set an explicit override.
- Providers handle their own login. Prompts and code may go to the provider or gateway you selected.

See [SECURITY.md](SECURITY.md).

## License

ChisaCode is licensed under AGPL-3.0-or-later. See [LICENSE](LICENSE).

ChisaCode is a modified, independently renamed derivative of [Paseo](https://github.com/getpaseo/paseo). Source, modification, and attribution notices are in [NOTICE](NOTICE).

When ChisaCode is distributed as binaries or offered for remote network interaction, publish the corresponding source for that exact version under AGPL-3.0-or-later.

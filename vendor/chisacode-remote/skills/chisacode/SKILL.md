---
name: chisacode
description: ChisaCode reference for managing agents and worktrees. Load whenever you need to create agents, send them prompts, or manage worktrees.
---

ChisaCode is a daemon that supervises AI coding agents on your machine. Control it through tools or a CLI.

## Worktrees

**`create_worktree`** — three modes:

- From a PR: `{ githubPrNumber: 503 }`.
- Branch off a base: `{ action: "branch-off", branchName: "fix/foo", baseBranch: "main" }`.
- Checkout an existing ref: `{ action: "checkout", refName: "feat/bar" }`.

Returns `{ branchName, worktreePath }`. Pass `cwd` to target a specific repo.

**`list_worktrees`** — current repo (or pass `cwd`).
**`archive_worktree`** — `{ worktreePath }` or `{ worktreeSlug }`. Removes worktree and branch.

## Agents

**`create_agent`** — required: `title`, `provider` (`claude`, `codex`, …), `initialPrompt`. Common: `model`, `cwd` (often a `worktreePath`), `background` (default `false` — blocks until completion or permission), `notifyOnFinish`, `settings`. Returns `{ agentId, … }`.

Initial runtime settings live under `settings`: `modeId`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }` when creating the agent.

Compose: call `create_worktree` first, then `create_agent` with `cwd` set to the returned `worktreePath`.

**`send_agent_prompt`** — `{ agentId, prompt }`. Blocks by default; pass `background: true` to fire-and-forget.

**`update_agent`** — `{ agentId, name?, labels?, settings? }`. Use `settings` for runtime changes on an existing agent: `modeId`, `model`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }`.

**`list_agents`** — filter by `cwd`, `statuses`, `sinceHours`, `includeArchived`.

**`archive_agent`** — `{ agentId }`. Interrupts if running, removes from active list.

## Provider discovery

**`list_providers`** — compact provider availability and modes.

**`list_models`** — full model list for one provider. Use only when you need model IDs or thinking options; the list can be large.

**`inspect_provider`** — compact provider capability and feature inspection. Required: `provider`; pass `cwd` when you are not in an agent-scoped session. Optional: `settings` with draft `model`, `modeId`, `thinkingOptionId`, and `features`.

Only set feature IDs returned by `inspect_provider`. For Codex fast mode, look for `fast_mode` and pass `settings: { features: { "fast_mode": true } }` to `create_agent` or `update_agent`.

## Heartbeats

**`create_schedule`** — required: `prompt`. Pick one of `cron` or `every` (`"5m"`, `"1h"`). Optional: `name`, `target` (`self` | `new-agent`), `provider`, `maxRuns`, `expiresIn`. Use for periodic checks on long-running work or recurring maintenance.

## Models

Use provider IDs such as `claude`, `codex`, `opencode`, `pi`, `kimi`, or `grokbuild`, and pass a separate `model` only when you need a specific model.

## Orchestration preferences

User-specific configuration at `~/.chisacode/orchestration-preferences.json`. **Any chisacode skill that picks an agent reads this file.** Never hardcode a provider string in another skill — resolve through this file.

Two parts:

- `providers` — map of role categories to provider strings. Pass straight to `create_agent`'s `provider` field.
- `preferences` — freeform string array. Read on startup; weave into agent prompts contextually.

Categories: `impl`, `ui`, `research`, `planning`, `audit`. Skills pick the category that matches the role they're launching.

```json
{
  "providers": {
    "impl": "codex",
    "ui": "claude",
    "research": "codex",
    "planning": "codex",
    "audit": "codex"
  },
  "preferences": [
    "Claude is the right choice for anything artistic or human-skill-oriented: copywriting, naming, UX copy, visual design, styling. Codex is the workhorse for mechanical work."
  ]
}
```

If the file is missing, use sensible defaults and tell the user once.

## Waiting

Agents take time — 10–30+ minutes is routine. Favor asynchronous workflows.

For every `create_agent` or `send_agent_prompt`, pass `background: true` and `notifyOnFinish: true`. ChisaCode delivers a notification to your conversation when the agent finishes, errors, or needs permission. **You must not call `wait_for_agent` on a notify-on-finish agent.** Move on to other work. The notification arrives on its own.

Don't poll `list_agents` or `get_agent_status` to "check on" a running agent. The notification will tell you.

## CLI parity

The `chisacode` CLI is a thin wrapper over the same daemon. Same surface:

```bash
chisacode run --provider codex --mode full-access --worktree feat/x "<prompt>"
chisacode send <agent-id> "<follow-up>"
chisacode ls
chisacode worktree ls
chisacode schedule create --every 5m "ping main build"
```

Discover with `chisacode --help` and `chisacode <cmd> --help`.

**If `chisacode` isn't on PATH but the desktop app is installed**, the bundled CLI is at:

- macOS: `/Applications/ChisaCode.app/Contents/Resources/bin/chisacode`
- Linux: `<install-dir>/resources/bin/chisacode`
- Windows: `C:\Program Files\ChisaCode\resources\bin\chisacode.cmd`

The desktop app's first-run hook (`installCli`) symlinks this to `~/.local/bin/chisacode` (macOS/Linux) or drops a `.cmd` trampoline (Windows) and adds `~/.local/bin` to PATH via shell rc files. If that didn't take, offer to symlink it — don't do it silently.

## Ops and debugging

Daemon-client architecture: the daemon owns agent lifecycle, state, and the WebSocket API. Tools, CLI, mobile, and desktop apps are all clients.

|                | Default                                        |
| -------------- | ---------------------------------------------- |
| Listen address | `127.0.0.1:6767` (override `CHISACODE_LISTEN`) |
| Home           | `~/.chisacode` (override `CHISACODE_HOME`)     |
| Daemon log     | `$CHISACODE_HOME/daemon.log`                   |
| Agent state    | `$CHISACODE_HOME/agents/<id>.json`             |
| Worktrees      | `$CHISACODE_HOME/worktrees/`                   |
| PID file       | `$CHISACODE_HOME/chisacode.pid`                |
| Health         | `GET http://127.0.0.1:6767/api/health`         |

Debug order:

1. `tail -n 200 ~/.chisacode/daemon.log`.
2. `chisacode daemon status` for liveness.
3. `curl -s localhost:6767/api/health` if the CLI itself is suspect.

**Never restart the daemon without explicit user approval** — it kills every running agent, including, often, the one asking.

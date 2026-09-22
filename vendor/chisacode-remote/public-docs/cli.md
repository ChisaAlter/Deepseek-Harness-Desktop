---
title: CLI
description: "ChisaCode CLI reference: manage agents, daemons, permissions, and worktrees from your terminal."
nav: CLI
order: 6
---

# CLI

The ChisaCode CLI lets you manage agents from your terminal. It's the same interface exposed by the daemon's API, so anything you can do in the app you can do from the command line.

> **Agent orchestration:** You can tell coding agents to use the ChisaCode CLI to spawn and manage other agents. This enables multi-agent workflows where one agent delegates subtasks to others and waits for results.

## Quick reference

```bash
chisacode run "fix the tests"            # Start an agent
chisacode ls                             # List running agents
chisacode attach <id>                    # Stream agent output
chisacode send <id> "also fix linting"   # Send follow-up task
chisacode logs <id>                      # View agent timeline
chisacode stop <id>                      # Stop an agent
```

## Running agents

Use `chisacode run` to start a new agent with a task:

```bash
chisacode run "implement user authentication"
chisacode run --provider codex "refactor the API layer"
chisacode run --detach "run the full test suite"  # background
chisacode run --worktree feature-x "implement feature X"
chisacode run --output-schema schema.json "extract release notes"
chisacode run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "summarize release notes"
```

The `--worktree` flag creates the agent in an isolated git worktree, useful for parallel feature development.

Use `--output-schema` to return only matching JSON output. You can pass a schema file path or an inline JSON schema object. This mode cannot be used with `--detach`.

By default, `chisacode run` waits for completion. Use `--detach` to run in the background.

## Listing agents

```bash
chisacode ls                    # Running agents in current directory
chisacode ls -a                 # Include completed/stopped agents
chisacode ls -g                 # All directories
chisacode ls -a -g --json       # Full list as JSON
```

## Streaming output

Use `chisacode attach` to stream an agent's output in real-time:

```bash
chisacode attach abc123   # Attach to agent (Ctrl+C to detach)
```

Agent IDs can be shortened, `abc` works if it's unambiguous.

## Sending messages

Send follow-up tasks to a running or idle agent:

```bash
chisacode send <id> "now run the tests"
chisacode send <id> --image screenshot.png "what's wrong here?"
chisacode send <id> --no-wait "queue this task"
```

## Viewing logs

```bash
chisacode logs <id>                  # Full timeline
chisacode logs <id> -f               # Follow (streaming)
chisacode logs <id> --tail 10        # Last 10 entries
chisacode logs <id> --filter tools   # Only tool calls
```

## Waiting for agents

Block until an agent finishes its current task:

```bash
chisacode wait <id>
chisacode wait <id> --timeout 60   # 60 second timeout
```

Useful in scripts or when one agent needs to wait for another.

## Permissions

Agents may request permission for certain actions. Manage these from the CLI:

```bash
chisacode permit ls                # List pending requests
chisacode permit allow <id>        # Allow all pending for agent
chisacode permit deny <id> --all   # Deny all pending
```

## Agent modes

Change an agent's operational mode (provider-specific):

```bash
chisacode agent mode <id> --list   # Show available modes
chisacode agent mode <id> bypass   # Set bypass mode
chisacode agent mode <id> plan     # Set plan mode
```

## Daemon management

```bash
chisacode daemon start             # Start the daemon
chisacode daemon status            # Check status
chisacode daemon stop              # Stop the daemon
```

Use `CHISACODE_HOME` to run multiple isolated daemon instances.

## Connecting to a remote daemon

`--host` accepts either a local target (`host:port`, a unix socket, or a Windows pipe) or a pairing offer URL, the same `https://app.chisacode.sh/#offer=...` link the mobile app uses for QR pairing. With an offer URL the CLI connects through the ChisaCode relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

Get an offer URL from the daemon you want to control:

```bash
chisacode daemon pair --json   # prints { url, qr, ... }
```

Use it from anywhere:

```bash
chisacode ls --host 'https://app.chisacode.sh/#offer=eyJ2IjoyLC...'
chisacode run --host "$OFFER_URL" "fix the failing tests"
```

You can also set it once via `CHISACODE_HOST` instead of passing `--host` on every command.

## Multi-agent workflows

The CLI is designed to be used by agents themselves. You can instruct an agent to spawn sub-agents for parallel work:

```bash
# Agent A spawns Agent B and waits for it
chisacode run --detach "implement the API" --name api-agent
chisacode wait api-agent
chisacode logs api-agent --tail 5
```

Simple implement + verify loop:

```bash
# Requires jq
while true; do
  chisacode run --provider codex "make the tests pass" >/dev/null

  verdict=$(chisacode run --provider claude --output-schema '{"type":"object","properties":{"criteria_met":{"type":"boolean"}},"required":["criteria_met"],"additionalProperties":false}' "ensure tests all pass")
  if echo "$verdict" | jq -e '.criteria_met == true' >/dev/null; then
    echo "criteria met"
    break
  fi
done
```

This pattern enables hierarchical task decomposition, a lead agent can break down work, delegate to specialists, and synthesize results.

## Output formats

Most commands support multiple output formats for scripting:

```bash
chisacode ls --json                # JSON output
chisacode ls --format yaml         # YAML output
chisacode ls -q                    # IDs only (quiet)
```

## Global options

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, or `https://app.chisacode.sh/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors

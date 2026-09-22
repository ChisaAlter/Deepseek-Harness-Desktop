---
title: Providers
description: How ChisaCode launches and supervises external coding agent CLIs.
nav: Providers
order: 3
---

# Providers

ChisaCode does not ship its own coding agent. It launches and supervises external CLIs you have installed and authenticated. Your subscriptions, credentials, project config, and MCP servers stay with the underlying provider.

## Mental model

A provider is the contract between ChisaCode and one external agent runtime: how to launch it, how to stream output, how to send input back, what modes and models it exposes, and how permissions are represented.

The actual binary lives on your machine and runs as a subprocess of the local daemon.

## Current built-ins

The built-in provider manifest currently declares:

- Claude
- Codex
- OpenCode
- Pi
- Kimi Code
- Grok Build

See [Supported providers](/docs/supported-providers) for IDs and install links.

## Custom providers

Custom providers live in `agents.providers` inside ChisaCode config.

- Extend a built-in provider to create a separate profile, override environment variables, replace the command, or curate models.
- Extend `acp` to run a generic Agent Client Protocol command.
- Disable a built-in provider by setting `enabled: false`.

See [Custom providers](/docs/custom-providers) for examples and field reference.

## Provider status and troubleshooting

Provider discovery is cached per home/workspace scope. Settings may briefly show Loading while a cold scope is probed, then converges to Available, Error, or Unavailable. An available command with no discovered models is still a valid ready state. Refresh preserves cached models while it probes; use Retry after a query, network, permissions, version, or authentication failure.

For Pi, install the CLI and configure authentication in Pi's normal `~/.pi/agent/auth.json` location. Pi model providers and gateway profiles remain Pi configuration; ChisaCode only supplies the configured launch environment and isolates gateway model metadata when needed. Open provider details and choose Diagnostic for command, model-discovery, auth, and MCP information. The CLI `provider inspect` path is useful for daemon-side troubleshooting. Do not include secrets in copied diagnostics or logs.

- [Supported providers](/docs/supported-providers), the current built-in provider list.
- [Custom providers](/docs/custom-providers), profiles, custom binaries, model overrides, and generic ACP commands.

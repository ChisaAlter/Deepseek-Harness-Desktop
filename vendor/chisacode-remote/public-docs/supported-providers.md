---
title: Supported providers
description: Provider CLIs currently declared by ChisaCode's shared provider manifest and in-app catalog.
nav: Supported providers
order: 4
---

# Supported providers

For the concept and how ChisaCode manages providers, see [Providers](/docs/providers). To add or configure your own provider, see [Custom providers](/docs/custom-providers).

ChisaCode does not ship its own coding model or hosted agent. Install and authenticate the provider CLI yourself, then ChisaCode launches it from the local daemon.

## Built-in providers

These provider IDs come from ChisaCode's shared provider manifest and appear in the in-app provider catalog.

| Provider ID | Provider                                                            | Expected command   |
| ----------- | ------------------------------------------------------------------- | ------------------ |
| `claude`    | [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup) | `claude`           |
| `codex`     | [Codex](https://developers.openai.com/codex)                        | `codex`            |
| `opencode`  | [OpenCode](https://opencode.ai/docs/)                               | `opencode`         |
| `pi`        | [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) | `pi`               |
| `kimi`      | [Kimi Code](https://github.com/MoonshotAI/kimi-code)                | `kimi acp`         |
| `grokbuild` | [Grok Build](https://x.ai/cli)                                      | `grok agent stdio` |
| `dsh`       | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `dsh-acp-demo`     |

### Pi notes

Install the Pi CLI, then authenticate it using Pi's normal `~/.pi/agent/auth.json` configuration. Pi's configured model providers and gateway profiles determine the discovered model list. In ChisaCode Settings, `Available` with zero models means the command was found but Pi reported no models; `Unavailable` means the command could not be launched, while `Error` means runtime or model discovery failed. Use Refresh/Retry and the provider Diagnostic action before reinstalling. ChisaCode does not expose credentials in diagnostics.

## Custom ACP providers

If another CLI speaks the Agent Client Protocol over stdio, add it manually with `extends: "acp"` and a `command` array. ChisaCode will start the command, initialize the ACP session, and use the models and modes reported by that runtime.

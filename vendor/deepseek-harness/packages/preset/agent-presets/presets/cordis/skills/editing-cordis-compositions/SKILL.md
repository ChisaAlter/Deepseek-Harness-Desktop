---
name: editing-cordis-compositions
description: Use when creating, changing, or validating a Cordis composition for this harness — writing or editing an agent preset, adding or removing a plugin row, deciding whether something belongs to the host composition or to one session, checking whether a preset you authored actually mounts, or diagnosing a row that mounted but contributed nothing.
---

# Editing Cordis compositions

Every capability in this harness is a plugin row in a `cordis.yml`. There is no separate configuration language: changing what an agent can do means changing which rows are composed for it.

## Off-limits

**Never edit, delete, or overwrite a preset that ships with the deployment** — the `agent-presets` directory beside the deployment's own config, which supplies `standard`, `ptc`, `minimal`, and `cordis`. Never escalate the sandbox to reach it, even when a change there looks quicker. An upgrade overwrites that install, and corrupting `cordis` disables preset authoring itself. Reading a shipped composition is the intended way to start; writing to one is not, and neither is editing the host composition to work around a preset limitation.

To change what a shipped preset does, copy it and edit the copy. Locally authored presets under the user root are yours to create, edit, and delete.

## Decide the plane first

Two planes, and the choice is not about how "agent-related" something feels — it is about whether the thing must be shared.

**Host composition.** The registries themselves (`tools`, `systemPrompt`, `agents`, `agent-loop`, `sessions`), anything crossing sessions (persistence, session query, storage, settings, credentials, telemetry), the sandbox and approval stack, the model route, and the subagent registry with its spawn/fork backends. One instance for the process.

**Agent preset.** What one session contributes to those registries: its tool plugins, its persona and prompt sections, its compaction policy. One instance per session, mounted under that session's scope and unwound with it.

**A service with a consumer outside the agent plane cannot move into a preset.** `subagents` is the worked example: the registry answers cross-session queries for the host api-proxy, so a per-session copy both starves that host row — it waits forever for a service nothing provides — and collides on the second session, since a provider name registers once. The preset contributes the delegation *tools*; the registry and its backends stay host-side.

A preset is a directory holding one `agent.cordis.yml`, optionally beside a `preset.yml` carrying display metadata — `name` and `description` (and, for shipped presets, a roster `order`); `hidden: true` keeps a preset off the roster every client reads, for a composition a plugin provisions for its own sessions — mounting it by id still works. Write the metadata too: a preset without it shows up in every picker as its bare directory name.

Locally authored presets live one directory per preset under `${DSH_HOME:-$HOME/.dsh}/.agent-presets/`, and the shipped set sits beside the deployment's own config. Use those when the user asks where to look. For deployment overrides, read `${DSH_HOME:-$HOME/.dsh}/profiles/<profile>/cordis.patch.yml`, `${DSH_HOME:-$HOME/.dsh}/cordis.patch.yml`, and any launch `--patch` files for the `agent-presets` row's `roots` and `includeUserRoot`. Obtain the active profile and extra patch paths from the user when they are not in the task context; do not guess a different profile.

## Authoring a preset

Use shell and file tools to locate the installed `@deepseek-ai/dsh-agent-presets` package under the active profile's `node_modules` or the deployment installation. Its `presets/<id>/` directory contains each shipped preset. If those files are unavailable, ask the user to copy the preset through the Web preset picker and provide the copied directory; runtime API inspection does not execute Remote methods.

Copy the complete source directory, including skills and assets, into a new `${DSH_HOME:-$HOME/.dsh}/.agent-presets/<new-id>/` directory (or the explicitly configured writable root). Refuse an existing destination. Set `name` and `description` in `preset.yml` and remove the copied roster `order`. Never overwrite the installed source.

Edit the copy's `agent.cordis.yml` with the normal file tools. Writes outside the workspace follow the active filesystem approval policy. For profile-wide capabilities, author a workspace bundle and install it with `plugin_manager`; load `cordis-plugin-development` for packaging guidance.

## Service isolation

A preset row that publishes a service needs an `isolate` realm containing both the provider and all its consumers. A tool that only consumes a host service remains outside that realm. Copy the shipped preset's existing groups rather than introducing service instances into the process-global realm.

```yaml
- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: workflow-ptc
      name: '@deepseek-ai/dsh-workflow-ptc'
      config:
        provider: spawn
    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'
```

## Verify a preset

Check the edited YAML and referenced local files with file tools. Ask the user to select the new preset in the Web picker and start a session; this authoring agent cannot invoke the preset Remote API or start a Web session through inspection. Once the user provides a running session or browser control, inspect the visible tools and any activation diagnostic. File validation alone does not verify imports, service dependencies, or isolation. Report which checks ran and leave activation unverified until that session check succeeds.

## Native product subagents

Codex and Claude Code providers are independent optional Profile Bundles. Install only the products a Profile needs, then restart the Profile so its Host registers those providers:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
```

Each Bundle owns its Host availability; the preset separately grants one Agent its ordinary delegation tool. Never move a product provider into the preset and never add a product-specific settings field. Removing one package withdraws only that provider on the next Profile start.

Copy these disabled templates from a shipped full preset and remove `disabled` only for the products the user requested:

```yaml
- id: tool-subagent-codex
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: codex
    toolName: subagent_codex
    backgroundMode: one-shot
    maxDepth: provider-managed

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: claude-code
    toolName: subagent_claude_code
    backgroundMode: one-shot
    maxDepth: provider-managed
```

For additional named Codex or Claude Code instances, mount a separate host-plane provider row for each instance with a unique `providerName`, then add a separate preset tool row whose `provider` exactly matches that name and whose `toolName` is also unique. Keep the shipped rows for the default `codex` and `claude-code` names; do not reuse one tool row for several providers or derive either name from permission or environment settings.

The two rows are independent. Leaving both disabled preserves the copied preset, enabling one exposes only that product tool, and enabling both exposes both. Production `dsh` does not install either optional provider: before enabling a row, install the matching `@deepseek-ai/dsh-subagent-codex` or `@deepseek-ai/dsh-subagent-claude-code` Bundle in the Profile and restart it. Each Bundle registers its dormant default provider and exclusively uses its pinned package-local platform CLI; additional named instances use extra host-plane rows from the same installed package. A preset cannot provide that host dependency. `backgroundMode: one-shot` keeps omitted or `false` calls in the foreground and lets explicit `run_in_background: true` return a generic Job id. Full presets already carry `tool-jobs`, while the base host carries the job registry; retain both so `job_output`, `job_list`, `job_kill`, cancellation, and completion notices stay available. Installing a Bundle or composing a preset row does not start a product, authenticate an account, select a model, probe credentials, or manage native product settings.

## What not to move into a preset

`agent-loop` registers the one agent factory and throws on a second. The registries own the per-session layering and cannot themselves be per-session. Session persistence must stay host-side or the session list fragments. The sandbox, approval, and permission rows are a deliberate boundary: a preset is exactly as privileged as the plugins it names, so letting one relax its own confinement would defeat the confinement.

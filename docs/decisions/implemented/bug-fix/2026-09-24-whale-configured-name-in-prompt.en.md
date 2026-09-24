# Decision: The configured whale name must reach the actual prompt

Status: implemented

[中文](2026-09-24-whale-configured-name-in-prompt.md) | English

## Problem

After renaming the assistant, the sidebar and session title showed the new name, but she still answered “whale girl” when asked for her name. Settings and presentation synchronization worked. The `whale-girl` preset marked an empty persona prefix as `complete:true`; the Harness prompt assembler retains only a complete section, discarding the dynamic `dsh-whale:persona` section. Earlier replies and the generic character label in her home directory reinforced the old self-name.

## Decision

The empty preset prefix only shadows the deployment persona and is no longer complete. The runtime `dsh-whale:persona` section continues to read the current name, personality, user title, and custom persona from the catalog. It explicitly directs self-introductions and name answers to use the configured name; historical self-names and the generic character type do not override it. User conversation history and home AGENTS.md and MEMORY.md are left intact.

## Alternatives considered

- **Only strengthen the dynamic persona wording** — rejected: the empty complete section would still discard the entire dynamic text before it reaches the model.
- **Recreate the session or erase older messages** — rejected: the setting already persists, and dynamic injection is designed to take effect on the next turn; recreating the session would lose user history.

## Consequences

A rename reaches prompt assembly on the next turn. Older replies remain unchanged. A test uses the real prompt assembler to verify that catalog name changes appear in the result and that the empty preset prefix cannot replace the dynamic persona.

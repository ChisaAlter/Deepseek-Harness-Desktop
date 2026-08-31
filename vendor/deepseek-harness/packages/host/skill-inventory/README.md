# @deepseek-ai/dsh-host-skill-inventory

English | [中文](README.zh.md)

Host Remote `skillInventory` for the Settings Skills page. Every method accepts optional `cwd` and `sessionId`. When `sessionId` is present, the gateway resolves that exact live Agent and reads the layered `ctx.skills` view that Agent sees (the standard preset's filesystem provider included); it never creates or resumes an Agent, and a missing live Agent throws typed `session-not-found`. `list` and `get` omit the composer `isUserInvocable` filter and add `path`, `source`, and `writable`; entries also carry `groups` (the Settings-owned grouping labels; a skill may belong to several) and `directory` (the directory containing the skill file, for reveal actions). `create` writes `$DSH_HOME/skills/<name>/SKILL.md` or `<project-root>/.dsh/skills/<name>/SKILL.md` (`project-root` is the nearest `.git` ancestor of `cwd`, or `cwd` itself) with caller-selected initial model/user invocation flags. `update`, `delete`, and `setInvocation` write only `user-dsh`, `user-agents`, and — when `cwd` is present — `project-dsh` / `project-agents` files. Updates and invocation-only writes preserve unknown frontmatter fields; delete removes the entire skill bundle directory. Enablement is the existing frontmatter pair `disable-model-invocation` and `user-invocable`. Bundled, runtime, and custom skills stay read-only.

The grouping labels live in frontmatter as `metadata.group` (`create`/`update` accept an optional `groups` list; an empty list clears it). Reading accepts either a scalar label or a list and normalizes it (trimmed, deduped, order-preserving); Settings writes a YAML list. It rides the filesystem provider's open `metadata` object, so Settings owns only that key: sibling metadata fields, unknown top-level fields, and non-object metadata values are preserved or left alone, and no skill schema change is needed.

The service is Remote-only. Client packages consume it through [`api-remotes`](../../api/remotes/README.md). The composer `skill.list` RPC is unchanged.

## Model Experience

None, as this Host Remote registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No skill marketplace** — create writes local files; install-from-catalog is out of scope.
- **Name is immutable after create** — rename is a delete plus create.

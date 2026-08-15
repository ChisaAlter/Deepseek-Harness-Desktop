# @deepseek-ai/dsh-skill-admin

English | [中文](README.zh.md)

User skill management service: list the merged user/registry catalog with ownership markers, and create, edit, or remove skills under the user skill root.

This package is the write side of the skill capability. Reading and loading stay owned by [`@deepseek-ai/dsh-skill`](../skill) and its providers; this service owns the one writable root — `$DSH_HOME/skills` (source `user-dsh`) — and refuses writes that sessions would never see.

## Service: `SkillAdminService` (ctx key: `skillAdmin`)

### Public API

- `ctx.skillAdmin.list()` Returns every parseable skill under the writable user root, the read-only user-agents / project / bundled roots, and every registry summary. Same-name entries from different sources are all kept; a disk read wins over a registry row of the same source. Entries carry `owned: true` only when they live in the writable user root.
- `ctx.skillAdmin.read(name)` Returns `{ entry, content }` for one owned skill, or `undefined` when the name does not name a parseable skill in the user root.
- `ctx.skillAdmin.save(input)` Creates or overwrites one user skill. The write validates the kebab-case name and a non-empty description, refuses a name another source already wins (so the file cannot land where sessions would never resolve it), and writes `SKILL.md` with canonical frontmatter (`name`, `description`, `whenToUse`, and only non-default `disable-model-invocation` / `user-invocable` switches).
- `ctx.skillAdmin.remove(name)` Deletes one owned skill's directory (or flat `.md`) recursively, refuses unowned names, and throws `not-found` for absent ones.

All failures are `SkillAdminError` with a stable `code`: `invalid-name`, `invalid-input`, `shadowed`, `not-owned`, `not-found`.

### Config

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME` then `~/.dsh` | Explicit harness home; the writable user skill root is `<dshHome>/skills`. |
| `agentsHome` | `$DSH_AGENTS_HOME` then `~/.agents` | Shared agent config root; `<agentsHome>/skills` is listed read-only. |
| `projectCwd` | `process.cwd()` | Workspace used to resolve `<project>/.dsh/skills` and `<project>/.agents/skills`. |
| `bundledSkillDir` | `$DSH_BUNDLED_SKILL_DIR` | Optional bundled skill root listed read-only. |

## Frontmatter grammar

The service mirrors the [`@deepseek-ai/dsh-skill-filesystem`](../skill-filesystem) frontmatter grammar (`---` delimiters, `name`/`description` required, `whenToUse`, `disable-model-invocation`, `user-invocable`) so every write round-trips through discovery unchanged.

## Model Experience

The service itself never reaches the model; a managed skill is served by the same `skill` tool and `/` command surfaces as any other skill, with the invocation switches written above deciding which catalogs list it.

## Known Limitations and Deferred Work

- Only the `$DSH_HOME/skills` root is writable. Project (`.dsh/skills`, `.agents/skills`) and `~/.agents/skills` skills are listed read-only; editing them is deferred.
- A malformed user skill (bad YAML, missing fields) is skipped by both discovery and this service's list; there is no repair surface yet.
- The shadow check still reads the global registry layer. `list()` now also scans project roots around `projectCwd`, but a same-name project skill does not by itself block a user-root save.

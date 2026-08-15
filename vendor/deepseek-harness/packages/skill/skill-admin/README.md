# @deepseek-ai/dsh-skill-admin

English | [中文](README.zh.md)

User skill management service: list the merged user/registry catalog with ownership markers, and create, edit, or remove skills under the user skill root.

This package is the write side of the skill capability. Reading and loading stay owned by [`@deepseek-ai/dsh-skill`](../skill) and its providers; this service owns the one writable root — `$DSH_HOME/skills` (source `user-dsh`) — and refuses writes that sessions would never see.

## Service: `SkillAdminService` (ctx key: `skillAdmin`)

### Public API

- `ctx.skillAdmin.list()` Returns every parseable skill under the user root plus every registry summary, deduplicated by name with the disk scan winning, sorted by name. Entries carry `owned: true` when they live in the writable user root.
- `ctx.skillAdmin.read(name)` Returns `{ entry, content }` for one owned skill, or `undefined` when the name does not name a parseable skill in the user root.
- `ctx.skillAdmin.save(input)` Creates or overwrites one user skill. The write validates the kebab-case name and a non-empty description, refuses a name another source already wins (so the file cannot land where sessions would never resolve it), and writes `SKILL.md` with canonical frontmatter (`name`, `description`, `whenToUse`, and only non-default `disable-model-invocation` / `user-invocable` switches).
- `ctx.skillAdmin.remove(name)` Deletes one owned skill's directory (or flat `.md`) recursively, refuses unowned names, and throws `not-found` for absent ones.

All failures are `SkillAdminError` with a stable `code`: `invalid-name`, `invalid-input`, `shadowed`, `not-owned`, `not-found`.

### Config

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME` then `~/.dsh` | Explicit harness home; the user skill root is `<dshHome>/skills`. |

## Frontmatter grammar

The service mirrors the [`@deepseek-ai/dsh-skill-filesystem`](../skill-filesystem) frontmatter grammar (`---` delimiters, `name`/`description` required, `whenToUse`, `disable-model-invocation`, `user-invocable`) so every write round-trips through discovery unchanged.

## Model Experience

The service itself never reaches the model; a managed skill is served by the same `skill` tool and `/` command surfaces as any other skill, with the invocation switches written above deciding which catalogs list it.

## Known Limitations and Deferred Work

- Only the `$DSH_HOME/skills` root is writable. Project (`.dsh/skills`, `.agents/skills`) and `~/.agents/skills` skills are listed read-only; editing them is deferred.
- A malformed user skill (bad YAML, missing fields) is skipped by both discovery and this service's list; there is no repair surface yet.
- The shadow check reads the global registry layer; a project-level skill with the same name is resolved per session and is not visible from this host plane.

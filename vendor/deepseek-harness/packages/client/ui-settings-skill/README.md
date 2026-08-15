# @deepseek-ai/dsh-client-ui-settings-skill

English | [中文](README.zh.md)

Skills settings section: browse every skill the harness knows, and create, edit, or remove the user's own skills.

The section renders the `skills.catalog` management RPC over the host [`@deepseek-ai/dsh-skill-admin`](../../skill/skill-admin) service. Owned (user-root) skills carry edit and remove actions; skills from other sources render read-only with their source badge. The create and edit flows share one dialog with the host's name grammar and invocation switches.

## Model Experience

The page itself never reaches the model. The invocation switches written here (`modelInvocable` / `userInvocable`) decide which catalogs list the skill: model-facing tool catalogs and the composer's `/` menu. A skill saved here is served by the same `skill` tool as any other skill.

## Known Limitations and Deferred Work

- Only user-root skills (`$DSH_HOME/skills`) are editable; project and bundled skills are listed read-only.
- The page shows the host-plane catalog; project-scoped skills appear per session in the `/` menu.

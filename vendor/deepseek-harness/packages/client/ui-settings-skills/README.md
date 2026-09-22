# @deepseek-ai/dsh-client-ui-settings-skills

English | [中文](README.zh.md)

Web Settings section `skills` (order 16). The page presents `ctx.remote.skillInventory` as a searchable hairline catalog with one source filter. Every Remote call sends the current session's `sessionId` and `cwd` so the Host reads that live Agent's layered catalog. Writable rows expose a model-invocation Switch, open the existing editor, and offer delete; read-only rows omit delete. Create supports either the user root or the active project's `.dsh/skills` root and accepts the initial invocation flags. The catalog follows the current session reactively and suppresses late responses from a previous session or project. The composer `/` picker keeps using `skill.list`.

The header also opens a GitHub Skill Hub backed by the Host's `gh skill search` and `gh skill install` Remotes. Search results show the exact public repository, path, description, and stars. Installation targets either the user DSH root or the active project's `.dsh/skills` root, requires a confirmation view naming that source and scope, never passes an overwrite flag, and refreshes the local catalog after success. Missing or outdated GitHub CLI support and repository conflicts stay visible in the modal.

Skills carrying a group label (`metadata.group`) render as collapsible tree nodes ordered by first appearance, with ungrouped rows in a final "ungrouped" node; when no row carries a group the list stays flat. Expand state is remembered in sessionStorage across reloads. Each group node has a model-invocation switch that batch-toggles every writable skill in the group (persisted to each skill's frontmatter); disabling collapses and dims the node, and all-readonly groups disable the switch. The create/edit dialog's group input is an editable dropdown: it lists the catalog's existing groups (plus a "leave blank" clear row) while accepting a typed new label, and search matches the label. Rows with a disk path offer an "open directory" action that calls the injected `openDirectory` (`workspaces.openPath`), handing the directory to the Host's OS default handler.

## Model Experience

None, as this browser Settings page registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **GitHub CLI required for Skill Hub** — local create/edit remains available when `gh` is absent or too old for `gh skill`.
- **Live session required for the preset catalog** — without a current session the page sends neither `sessionId` nor `cwd`, so the Host falls back to the global skill layer and project/bundled roots from the standard preset stay out of view.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.

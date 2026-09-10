# Agent Note: GitHub skill hub

Status: implemented

English | [中文](2026-09-09-github-skill-hub.zh.md)

## Problem

Skills Settings lists, edits, and toggles the skills already on disk, so finding a public one meant leaving the app to browse GitHub and copy a directory by hand. A bundled catalogue would need its own review and freshness process, and a UI-only marketplace would install nothing real.

## Decision

The existing Skills Settings section searches and installs public Agent Skills through the official GitHub CLI, so installation reuses the layered skill store instead of creating a second one.

- Search uses `skillInventory.searchHub`, backed by bounded structured `gh skill search` output.
- Install pins the repository's current default-branch HEAD SHA and uses the exact search-result repository and path through `skillInventory.installHub`; an older release tag cannot invalidate a search hit.
- The destination is either `$DSH_HOME/skills` or the nearest project root's `.dsh/skills`.
- The confirmation view names the source and destination before execution.
- Existing skills are never silently overwritten; the Host does not pass `--force`.
- Missing or outdated GitHub CLI support and install conflicts are returned to the open modal.
- A successful install invalidates and refreshes the existing layered skill registry.

Inputs are validated and bounded before the process starts, and subprocess output and runtime are bounded, so the bridge never falls back to an unverified downloader.

## Alternatives considered

**Ship a bundled or hosted skill catalogue.** Rejected because a curated index needs its own review and freshness process, while the confirmation view has to name the real repository and path anyway.

**Rely on `gh skill install`'s default version resolution.** Rejected because it prefers older release tags, so a fresh search hit could install a different revision than the one the user confirmed.

**Search and download through the GitHub REST or raw-content endpoints.** Rejected because authentication, rate limits, and hidden-directory handling would be reimplemented next to the CLI that already owns them.

**Install only into the user-scope `$DSH_HOME/skills`.** Rejected because a project that pins its own skills would receive a copy it does not own; the destination follows the scope the user picked.

## Consequences

Installs stay tied to public GitHub repositories and the desktop carries no catalogue of its own. A missing or old `gh` executable produces an actionable error inside the modal instead of a silent no-op or an unverified download. A name that already exists at the chosen scope blocks the install rather than replacing it, and no `--force` path exists to override that.

Project-scope installs write into the working tree, so the same skill name can exist at both scopes and is resolved by the existing layered registry.

## Testing

- Host gateway and GitHub CLI bridge unit tests.
- Skills Settings browser tests for search, confirmation, user/project scope, success refresh, and failure retention.
- Host and client TypeScript package checks.

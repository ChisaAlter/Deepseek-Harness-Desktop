# GitHub Skill Hub

## Summary

The existing Skills Settings section now searches and installs public Agent Skills through the official GitHub CLI. This closes installation without creating a second skill store or a UI-only marketplace.

## Contract

- Search uses `skillInventory.searchHub`, backed by bounded structured `gh skill search` output.
- Install pins the repository's current default-branch HEAD SHA and uses the exact search-result repository and path through `skillInventory.installHub`; an older release tag cannot invalidate a search hit.
- The destination is either `$DSH_HOME/skills` or the nearest project root's `.dsh/skills`.
- The confirmation view names the source and destination before execution.
- Existing skills are never silently overwritten; the Host does not pass `--force`.
- Missing or outdated GitHub CLI support and install conflicts are returned to the open modal.
- A successful install invalidates and refreshes the existing layered skill registry.

## Verification

- Host gateway and GitHub CLI bridge unit tests.
- Skills Settings browser tests for search, confirmation, user/project scope, success refresh, and failure retention.
- Host and client TypeScript package checks.

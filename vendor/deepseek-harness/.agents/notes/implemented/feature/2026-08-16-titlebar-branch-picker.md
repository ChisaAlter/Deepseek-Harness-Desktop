# Agent Note: Titlebar branch picker

Status: implemented

English | [中文](2026-08-16-titlebar-branch-picker.zh.md)

## Problem

The titlebar Git cluster could commit, push, and open change requests, but switching or creating a branch required the terminal. The product needed a branch selector (search, inline create, remote dedupe) that uses this design system: `ui-primitives` Menu, `--dsw-alias-*` tokens, and no second state stack.

## Decision

The selector has three layers. Pure logic — `deriveLocalBranchNameFromRemoteRef`, `dedupeRemoteBranchesWithLocalMatches`, and `shouldIncludeBranchPickerItem` — lives in `ui-git/src/client/branches.ts` as plain TypeScript. The trigger shows the current ref and opens the same `Menu` atom as the commit/push chevron (portal, fixed 218px card, 14/22 rows — not `compact`). The Menu filter sits in the card header and filters as you type; it does not auto-focus. `origin/*` rows whose local branch exists are hidden; the current row is selected and disabled. Create is a footer row that uses the typed query, or focuses the filter when the query is empty. A failed switch or create reports on the Git progress toast (`Failed to switch ref.` / `Failed to create and switch ref.`).

The backend adds three desktop IPC channels — `shell:git-branch-list` (`for-each-ref` + `symbolic-ref` for the origin/HEAD default), `shell:git-switch-branch` (`git checkout --ignore-other-worktrees`, so a branch already checked out in another worktree still switches this folder), `shell:git-create-branch` (`git checkout -b`) — all rooted through `workspace-authority` like every other git op. Ref names are validated against `^[A-Za-z0-9][A-Za-z0-9._/-]*$` with `..`, `.lock`, and trailing-slash rejections before they reach argv, so a model-supplied ref cannot smuggle options or traversal.

Worktree environments and thread↔branch binding stay out: this harness has no per-session worktree path, env mode, or stop-on-switch metadata. Shipping the selector half without that lifecycle would lie. They remain candidates for a later, harness-native design.

## Alternatives considered

**Import a Tailwind / shadcn / lucide / zustand branch menu.** Rejected: those stacks break the mandatory dsw design language, the slot catalog, and the lint gates.

**Branch operations through the terminal only.** Rejected: the titlebar already owns the Git loop (commit/push/PR); a branch detour through the terminal breaks that loop for the most common ref action.

**Ship worktree/env-mode with the picker.** Deferred: requires per-session branch metadata and worktree lifecycle management inside the authorization root.

## Consequences

The titlebar Git cluster is now a complete ref loop: switch, create, commit, push, PR. The commit dialog reviews the current branch, `status.workingTree` files with numstat `+/-`, and offers Commit or Commit on new branch (`feature/update`). `git.test.js` pins list/switch/create round-trips and unsafe-ref rejection; `branch-menu.client.spec.tsx` pins the pure functions and the Menu filter / create-footer / toast-error interaction. The picker renders only when the session cwd is a repository; outside git it stays hidden and the Initialize Git flow keeps its place.

## Related

[Desktop surfaces integration hardening](../architecture/2026-08-15-desktop-surfaces-integration-hardening.md) owns the workspace-authority root this picker routes through.

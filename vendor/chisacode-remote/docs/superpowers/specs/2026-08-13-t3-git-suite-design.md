# T3 Git Suite Design

Date: 2026-08-13
Status: Approved 2026-08-13

## Summary

Replace the thin Soft Home branch/PR combobox and the conversation-header
branch filter with one shared Git suite modeled on T3 Code's Branch Toolbar
plus Git Actions Control. Draft and conversation mount the same component.
Default environment is Local (the directory the user already selected).
Worktree is created only after an explicit confirm dialog.

This is not a restyle. Shipping a prettier Combobox, a Worktree label that
does not change cwd, or a "Commit, Push & PR" button that only commits, is
a failed delivery.

## Decision

Approach A: recreate T3 interaction with ChisaCode primitives
(`Combobox`, `DropdownMenu`, `AdaptiveModalSheet`, `confirmDialog`). Do not
import T3 source. Desktop and mobile share the same behavior.

HTML prototype of the topbar and all eight dialogs lands in `prototypes/`
and must be approved before implementation starts.

## Goals

- One `GitSuite` on Soft Home (beside the directory pill) and on the
  conversation desktop topbar (right of Open).
- Local send never creates `~\.chisacode\worktrees\...`.
- Worktree mode creates or switches to an isolated worktree only after
  dialog 7 confirms; conversation cwd actually changes.
- Quick action runs the real stacked steps, not a single RPC with a
  stacked label.
- Every listed dialog is a real modal/sheet/confirm, not a toast.

## Non-Goals

- Importing T3 web components or making a web-only path.
- Server-side stacked-action RPC or hook-output streaming in this slice.
  Client orchestration of existing commit / push / PR RPCs is the contract.
- Changing Soft Home send to default-create a worktree.
- Reworking the right-panel Diff surface, file explorer, or environment
  inspector beyond opening a PR URL from the pill.
- AI-generated commit messages or PR bodies. The commit dialog uses the
  user's message or the existing daemon default when the field is empty.
- GitLab/Bitbucket terminology. Labels stay Pull Request / PR.
- Archiving a worktree from this suite. Archive stays on the existing
  overflow / worktree-owned menu.

## Completion contract

### Controls that must exist

| Control          | Required behavior                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local / Worktree | Local = current checkout. Worktree = create or switch to an isolated worktree after confirm. cwd changes.                                                                                   |
| Branch selector  | Search local + remote (hide remote when a local twin exists). Pin current branch. Typing a new name creates and checks it out. Paste PR URL, `#12`, or `gh pr checkout 12` offers checkout. |
| PR pill          | Visible only when the current branch has a PR URL. Shows `#number` and state color. Click opens the browser and does not open the branch menu.                                              |
| Git primary      | State machine below. Label matches the action that will run.                                                                                                                                |
| Git menu         | Separate Commit, Push, Create PR or View PR. Disabled items show a reason.                                                                                                                  |

### Primary action state machine

| Repository state         | Primary action                         |
| ------------------------ | -------------------------------------- |
| Dirty, no open PR        | Commit + Push + Create PR              |
| Dirty, open PR           | Commit + Push                          |
| Clean, ahead, no open PR | Create PR (push first if needed)       |
| Clean, ahead, open PR    | Push                                   |
| Clean, behind            | Pull                                   |
| Clean, in sync, open PR  | Open PR                                |
| Clean, in sync, no PR    | No primary chip. Menu still available. |

### Dialogs that must exist (toast is not a substitute)

1. Branch selector popover — groups: current, local, remote, PRs. Empty,
   searching, and create-branch rows are complete.
2. Checkout PR confirm — number, title, base; confirm actually checks out.
3. Uncommitted switch — stash and switch, or cancel.
4. Restore stash after switch — restore, or later.
5. Commit dialog — file checklist from the live diff, editable message,
   submit commits only checked paths.
6. Protected-branch confirm — on `main`, `master`, or `cn-main` for
   commit or push: continue on this branch, or type/edit a feature-branch
   slug, create it, then run the action.
7. Worktree confirm — first transition into Worktree: path, base branch;
   confirm calls `createChisaCodeWorktree`.
8. Stacked progress — phases Commit → Push → Create PR, success and
   failure per phase. Success may offer Open PR. Failure stops; later
   steps do not run.

### Forbidden shells

- Conversation still uses "筛选分支..." while Soft Home keeps a second picker.
- Worktree control changes copy only.
- Primary reads "Commit, Push & PR" but only commits.
- Commit dialog has no file checklist, or checklist is ignored.
- No protected-branch dialog.
- Disabled menu items have no reason.
- Desktop-only behavior with a different mobile contract.
- "Picker this week, dialogs later" as a done state.

## Architecture

### Units

| Unit                        | Does                                                         | Does not                        |
| --------------------------- | ------------------------------------------------------------ | ------------------------------- |
| `GitSuite`                  | Layout: env mode, ref picker, PR pill, stacked actions       | Own RPC calls                   |
| `resolveGitQuickAction`     | Pure: status → primary + menu disabled reasons               | UI                              |
| `parsePullRequestReference` | Pure: URL / `#n` / `gh pr checkout n`                        | UI                              |
| `runStackedGitAction`       | Runs commit → push → `checkout_pr_create` with phase updates | Render buttons                  |
| Eight dialogs               | One confirmation or editor each                              | Bypass `GitSuite` to change cwd |

Mount points:

- Soft Home: replace `RefPickerTrigger` + its Combobox.
- Conversation desktop topbar: replace `BranchSwitcher` + idle
  `WorkspaceGitActions` chip. Keep Open-in-editor as a sibling.
- Mobile compact header keeps the same `GitSuite` behavior (soft-pill
  trigger is allowed; dialogs stay the same).

### Existing RPCs

Reuse: `checkout_status`, `branch_suggestions`, `github_search`,
`checkout_switch_branch`, `validate_branch`, stash save/pop/list,
`checkout_commit`, `checkout_push`, `checkout_pull`,
`checkout_pr_create`, `checkout_pr_status`,
`create_chisacode_worktree`, worktree list/archive,
`subscribe_checkout_diff` (commit file list).

### Required additions

1. Optional `paths: string[]` on `checkout_commit_request`. Protocol
   compatible: old clients keep `addAll`. New clients send checked paths.
   Without this, dialog 5 is a shell.
2. `runStackedGitAction` on the client. It must invoke the real RPCs in
   order. No new stacked RPC in this slice.
3. Create branch: `checkout_switch_branch` only checks out an existing
   branch. Soft Home's "new-branch" item today is send-time intent, not
   `git checkout -b`. This suite needs `checkout.create_branch.request`
   (dotted pair `checkout.create_branch.response`): validate slug, create
   from current HEAD, switch to it. Failure stays in the picker. Local
   mode creates on the current checkout immediately on select, not on send.
4. Worktree: dialog 7 → `createChisaCodeWorktree` → workspace cwd becomes
   the new path. Switching back to Local reopens the main checkout and
   does not delete the worktree.
5. Protected branch: client gate only. Dialog 6 has two actions: continue
   on this branch, or create a feature branch (editable suggested slug)
   via `checkout.create_branch` then run the intended action.

GitHub / `gh` failures are explicit ("无法打开 PR", "创建 PR 失败").
The primary button must not show success.

### Data flow

```
checkout_status (local snapshot first, GitHub later)
  → resolveGitQuickAction → primary + menu
  → PR pill when url is present
branch list: prefetch when directory is ready
PR search: only when the picker is open or the query looks like a PR
Worktree confirm success → update workspace cwd → status query follows cwd
```

Soft Home send:

- Local: `open-existing` / reuse open workspace. Never
  `createChisaCodeWorktree` on send.
- Worktree: the worktree must already exist from dialog 7.

Conversation Worktree switch changes the current session cwd only. It
does not spawn a new conversation.

Optimistic branch label is allowed while switch is in flight. Rollback
on error.

### Errors

- Uncommitted switch → dialogs 3 and 4, not a toast.
- Stacked failure keeps earlier successes (a completed commit stays
  committed). The toast names the failed phase.
- Picker empty copy: "搜索中" only while local branches are fetching.
  The current branch is always seeded so the list is never blank on open.

## Testing

Unit (TDD, changed files only):

- `resolveGitQuickAction` — one case per primary state in the table.
- `parsePullRequestReference` — URL, `#n`, `gh pr checkout n`, reject junk.
- `runStackedGitAction` — all three RPCs fire; step-2 failure skips step 3.
- Commit `paths` — only checked files are sent.
- Worktree — no create without confirm; confirm changes cwd.

Source / gate:

- Soft Home and conversation header both render `GitSuite`.
- Packaged Electron: Local send adds no `~\.chisacode\worktrees` entry.
- Packaged Electron: each of the eight dialogs can be opened once on
  the real desktop surface. Unverified dialogs stay labeled unverified.

## Implementation gate

1. User approves this spec.
2. HTML prototype in `prototypes/` covering the topbar and all eight
   dialogs. User approves the prototype.
3. Implementation plan in `docs/superpowers/plans/`.
4. Code. No code before steps 1–3.

## Out of scope leftovers (not downgrades)

These are documented so they are not silently dropped or silently added:

- Server stacked-action RPC and git-hook live output.
- Auto-generated commit / PR text.
- Non-GitHub hosts.
- Worktree archive from this suite.

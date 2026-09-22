# Decision: Warn about oversized files before the commit dialog submits

Status: implemented

[中文](2026-09-22-large-file-commit-warning.md) | English

## Problem

GitHub rejects any push containing a single file larger than 100 MiB. After dropping a large artifact (build output, model weights, screen recording) into a workspace, the commit dialog lists paths and add/remove line counts only — no byte sizes — so "Commit, push & PR" runs all the way to the push before failing. The failure surfaces far from its cause, and by then the oversized file is already in local history. The dialog needs to name the file and its size before the user submits, without changing what committing means.

## Decision

The main process gains `gitCheckLargeFiles(cwd)`: it takes the paths from `git status --porcelain=v1 -z --untracked-files=all`, `lstat`s each one, and returns the `{ path, size }` rows strictly larger than 100 MiB (`100 * 1024 * 1024`). It reads metadata only — it never calls `git add` and never writes the index — so opening the dialog cannot leave content the user never meant to commit staged. It uses `lstat` rather than `stat`, so symlinks are not followed; ignored paths never appear because `git status` omits them; a rename record contributes git's destination path.

Paths resolve against the repository root: `--porcelain` prints repository-relative paths even when invoked from a subdirectory, so the scan derives that root from the already-authorized cwd via `rev-parse --show-prefix` instead of trusting a second root from git's output. When the derived root is itself authorized the whole repository is scanned — matching `git add -A` from a subdirectory, which stages the whole tree; otherwise only the authorized cwd subtree is scanned and candidates above it are skipped. A listed path that disappears between `status` and `lstat` is skipped rather than failing.

The client runs one scan when the commit dialog opens and then does two things: it narrows the result to the paths this commit actually contains (excluding a file removes its warning; an untracked directory reaches the dialog collapsed to `dir/`, so a warned path nested underneath matches by prefix), and it invalidates an in-flight result when the dialog closes so a previous answer cannot describe a later commit. A failed scan degrades to "no warnings" and never blocks committing.

## Alternatives considered

- **Return sizes from `gitStatus`** — rejected: it saves one IPC round trip, but status is the titlebar's standing poll, so every refresh would re-stat every changed file, while the warning is needed only while the dialog is open.
- **Write the files into `.gitignore` or move them to LFS automatically** — rejected: that exceeds the tool's remit and silently rewrites the user's repository policy.
- **Parse the remote's rejection message after the push fails** — rejected: the wording varies by host, and by then the user has already paid for a local commit.
- **Follow symlinks to judge the target's size** — rejected: a link may point outside the workspace, so it would both read unrelated files and report a misleading size for the link itself.

## Consequences

The dialog now lists oversized files and their sizes before the commit, so the user can cancel, exclude the path, or switch to LFS. The deliberate boundary is that this only warns: the buttons stay enabled and committing means exactly what it did before. The threshold follows GitHub's binary limit of 100 MiB (104,857,600 bytes) rather than a decimal 100 MB, so a user who reads "100 MB" in decimal will see warnings for files of 94.3–100 MB — the intentionally conservative direction. The diagnostic carries only repository-relative paths and byte counts, never file contents.

# Decision: One Git titlebar refresh reads the working tree context once

Status: proposed

[中文](2026-09-22-git-refresh-read-context.md) | English

## Problem

The titlebar's `refresh()` fires three IPC calls inside a single user-visible action:
`shell:git-status`, `shell:git-fetch-status`, and `shell:git-read-pr`. Each one independently walks
`src/main/git.js::gitStatus()`, and every walk probes the repository, runs
`status --porcelain=v2 --branch`, queries remote / default branch / provider, and then runs
`readWorkingTreeNumstat()`. A typical `main + origin + upstream` repository costs roughly eight
serial git child processes per walk — about twenty-four for three — before counting the real
`git fetch` and `gh pr list`. A window focus triggers the same refresh, with only a 250 ms debounce
in front of it.

Those child processes are asynchronous; nothing here blocks the main thread with `execSync`. The
cost is process churn, the working tree being read over and over, and end-to-end latency that grows
with repository size. The user-visible symptom is a status pill that updates late, not a frozen
window — which is why "make it concurrent" is not the answer. Removing the **duplication** is.

## Proposal

Introduce a short-lived `GitReadContext` in the main process so the IPC calls of one refresh share a
single read.

The implementation lives in `src/main/git-read-context.js`, and reuse is **not** implicit behaviour of
a generic `runGit()`: `runGit()` always runs an uncached real child process, and the cache only takes
effect through an explicit `run` seam passed by the caller.
`readGitStatus(root, run)`, `readWorkingTreeNumstat(root, run)`, `resolveCurrentUpstream(cwd, run)`,
`fetchForStatus(cwd, readRun)`, `lookupOpenPullRequest(cwd, refName, readRun)`, `readPullRequest`, and
`resolveBranchHeadContext(cwd, refName, readRun)` each accept that seam.

The context key is **owner plus worktree root**, not a single global "current workspace":
`armReadContext(owner, root)` opens one refresh window, `acquireReadContext` / `touchReadContext` hit
inside it, and `invalidateReadContext` revokes by root. The TTL is a 2-second **sliding** idle window
plus an absolute 30-second ceiling from `armedAt` — `touchReadContext` extends the idle window as each
piece of work starts but **cannot** break the absolute ceiling, so a slow fetch keeps reusing the same
read while an expired window is guaranteed to miss.

The cache covers only a read-only allowlist. `isReadOnlyInvocation()` decides on the full command
shape: `remote` is cacheable only for a bare listing, `-v`, `get-url`, and `show`; `symbolic-ref` only
for a single-operand read. `config` and every other setting-shaped subcommand count as writes. Git
writes (init / commit / push / pull / stage / unstage / discard / switch / create / publish /
`remote add` / `gh repo create`) call `invalidateReadContext` **before** the write, then clear and
revoke again once it settles — including on failure and partial success — so a failed write cannot
leave a cacheable pre-write reading behind.

`gh` always goes through the plain `run()`, and the `context.run` seam is **never** handed to it: a PR
lookup is an external process, not part of the Git read context.

The owner for `gitStatus(cwd, owner)` / `gitFetchForStatus(cwd, owner)` / `gitReadPullRequest(cwd, owner)`
is the IPC's `event.sender.id`, so two windows cannot hit each other's window. `statusForRoot()` takes
an internal fast path so a read does not re-enumerate every authorized root; each IPC still performs
one authorization and path-protection pass. Renderer IPC arguments and response shapes stay
compatible: this replaces an internal coordinator, it does not change the channel shape.

## Alternatives considered

- **Let the renderer send its status result back as a main-process cache** — rejected: that makes a
  renderer-supplied "already verified snapshot" the only basis for main-process reads, raising both
  the privilege and staleness risks at once. The context has to be built by the main process.

- **Collapse the three IPC calls into one aggregate `shell:git-*` call** — deferred: it would also
  change the call surface of the vendored `ui-git`, beyond the `git-titlebar` card's Allowed touch
  (that card states vendor changes need an explicit scope expansion). An internal coordinator that
  leaves the channel shapes alone already covers the main cost.

- **Serialize the three requests on the renderer side to "avoid concurrency"** — rejected:
  serializing only postpones the process storm and makes latency worse. The problem is repeated
  reads, not concurrency.

- **Drop numstat from the status read entirely and fetch it on demand** — rejected: per-file
  insertion and deletion counts in `workingTree` are part of the existing titlebar contract;
  removing them degrades the pill and the diff overview. Reuse one numstat read rather than
  canceling it.

- **Let `runGit()` look up a global "current workspace" cache itself** — rejected (implemented, then
  overturned): cache hits would then depend on call ordering rather than caller intent, and
  overlapping refreshes, writes, or a fetch outliving the window would let different refreshes read
  each other's intermediate state. The cache became an explicit `run` argument.

- **Give status a long TTL cache (seconds)** — rejected: external Git edits (the user committing or
  checking out in their own terminal) would surface a stale branch and a wrong working tree. The
  context lifetime is **one refresh**, not an interval; the 2-second idle window plus the 30-second
  absolute ceiling exist only so one refresh can span a slow fetch.

- **Invalidate only after a successful write** — rejected (implemented, then overturned): a failed or
  partially successful write still changes on-disk state (for example `remote add` has written the
  config before a later step fails). Invalidation must start **before** the write command and clear a
  second time after it settles to stay fail-closed.

## Acceptance criteria

- On a fixed `main + origin + valid upstream` fixture, one refresh performs at most one full
  porcelain call and at most one numstat call; with no real fetch, the worktree's local git child
  process count targets six or fewer.
- Child process count drops by at least 50% against the same fixture's baseline (the earlier
  "about twenty-four" was a path estimate; record the actual baseline first).
- A burst of consecutive focus events produces no unbounded concurrent queries; concurrent reads of
  one worktree merge into a single status read.
- The first read after a write sees the new state (no pre-write cache is returned), and neither a
  failed nor a partially successful write leaves a cacheable reading behind.
- Two windows with different owners do not share a read context; two worktree roots under one owner
  do not share one either.
- A fetch that outlives the idle window but not the absolute ceiling still hits the same context for
  that refresh.
- A setting-shaped `symbolic-ref` and `remote add/set-head` are not treated as cacheable reads, and
  `gh` never receives `context.run`.
- All existing cases for authorization, `.git` containment, `--porcelain=v2` parsing, unborn and
  detached HEAD, missing origin, multiple remotes, and missing upstream keep passing.

## Risks

- Stale context is the dominant risk surface: cross-worktree contamination, cross-owner
  contamination, reuse for an unauthorized path, and reads that still see pre-write values. Three
  hard rules constrain it — owner-plus-worktree-root isolation, invalidate-before-write, and the
  absolute ceiling — rather than a TTL.
- A failed fetch must preserve local state; a failed remote refresh must not wipe the working-tree
  reading along with it.
- Branches with the same name in different forks cannot use the branch name alone as a PR cache key;
  remote identity must stay in the key (the current `gitReadPullRequest` already appends
  `headRemoteUrlKey`, and this change must not weaken that).
- `activeContexts` is a module-level Map reclaimed by the idle window plus the absolute ceiling; if
  the ceiling is ever raised or long-lived entries are added, stale entries and memory must be
  re-evaluated for long sessions.

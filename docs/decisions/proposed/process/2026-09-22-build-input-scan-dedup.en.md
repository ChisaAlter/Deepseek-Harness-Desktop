# Decision: Build inputs are matched by real origin, enumerated once per run

Status: proposed

[中文](2026-09-22-build-input-scan-dedup.md) | English

## Problem

Source startup runs `scripts/prestart-ensure.mjs` before the Electron process exists, and it pays two
fixed costs:

1. **Whole-tree walk plus post-filtering.** `newestMtime()` recursed through the entire vendored
   Harness and then discarded `docs`, `website`, `mobile`, `benchmarks` and other subtrees that can
   never be client inputs by matching file paths. `scripts/prepare-dshd-remote.mjs` separately
   recursed `packages/protocol/src` and `packages/client/src` a second time in the same run: once for
   the server stack and once for the mobile bundle.
2. **Coarse invalidation.** Beyond "client sources are newer than the build record",
   `officialBuildReason()` compared the whole desktop repository HEAD with the build record's
   `DSH_CLIENT_COMMIT_HASH`. A commit that only touches `src/main/**`, installer code, or docs marked
   the client build stale, so `build:official` ran with no client source change. Conversely,
   `packages/client/**/tests/**` and `README*.md` edits counted as real inputs and triggered the same
   full rebuild.

Both costs are paid before the app is visible, on every source start.

## Proposal

Move "what counts as a client build input" into a shared module, `scripts/source-scan.mjs`, and
separate the decision from the traversal:

- `isClientSourceFile()`: the real file predicate for client inputs. It keeps
  `ts/tsx/css/html/json/yml` under `packages/client`, `apps/web` and `scripts`, and excludes
  `tests`, `__tests__`, `*.spec.*`, `*.test.*` and `README*` pairing documents.
- `createClientSourcePruner()`: the directory half of the same predicate. Traversal skips subtrees
  that cannot match before entering them, instead of walking `docs`/`website`/`mobile` and discarding
  the results by path afterwards.

  The directory predicate must mirror the file predicate clause by clause; otherwise a file the
  predicate accepts can sit under a subtree the directory predicate prunes, which is a silent miss.
  The clearest case is `scripts`: it is an input, and so is every subdirectory under it (the file
  predicate accepts `scripts/**/*.ts`), so the directory predicate must let `scripts` and all of its
  descendants through rather than stopping at the top level.
- `createScanMemo()`: a per-run "enumerate each directory once" memo. The server stack and the mobile
  bundle in `prepare-dshd-remote.mjs` share the protocol/client scan, and an explicit `--force` run
  skips scanning entirely because its freshness result is never read.
- The memo is process-local and never persisted. A cross-run mtime record cannot distinguish "the
  files did not change" from "the scan did not run"; an interrupted run or an external edit would
  silently leave stale artifacts, which is exactly how this path failed before.
- The directory and file predicates are split so `source-scan.test.mjs` can check them mechanically:
  old whole-tree scanning and the new pruned scan must produce the same newest mtime, and
  `tests`/`README` must no longer be inputs.

The two callers must **not** share one prune list:

- The client scan's `DEFAULT_PRUNED_DIRS` (`node_modules`, `lib`, `dist`, `.dsh-build`, `.git`,
  `coverage`, `.artifacts`) follows from "these names can only be artifacts inside the client input
  tree".
- The remote scan's list is much narrower (`REMOTE_PRUNED_DIRS` = `node_modules`, `dist`, `.tmp`):
  inside the remote source tree `src/lib/*` can be real source, so skipping `lib` as a generic
  artifact name would hide genuine edits.
- The remote scan folds each **directory's own mtime** into the result (`includeDirMtime: true`). When
  only a file is deleted, no surviving file's mtime advances and only the parent directory's does; a
  file-only scan would miss that change. A single-file input (for example the mobile entry module) is
  still handled by its file mtime rather than failing with `ENOTDIR`.

## Alternatives considered

- **Keep the whole-tree walk and optimize the `statSync` calls** — rejected: the cost is the number
  of directory entries and the recursion itself. Tuning one stat call does not change the order of
  magnitude; the win comes from not entering irrelevant subtrees at all.
- **Add the file predicate without directory pruning** — rejected: `docs`/`website` also contain
  `*.json` and `*.ts`, and a file predicate cannot exclude them before traversal. The measured gap
  between 261 ms unpruned and 138 ms pruned is exactly this.
- **Drop the HEAD comparison and trust client source mtimes only** — rejected: client artifacts embed
  commit/version metadata (`packages/client/ui-sidebar/src/client/SidebarRoot.tsx` reads
  `DSH_CLIENT_COMMIT_HASH` and `DSH_CLIENT_VERSION`), so metadata changes must rebuild the affected
  stages. This decision removes only changes unrelated to the client from the decision; the
  `desktop-build-runtime` card keeps constraining where stage reuse is allowed.
- **Make prestart fully asynchronous** — deferred: Electron still waits for prestart to finish, so
  async APIs do not shorten wall-clock; they only move the blocking work somewhere else.

- **Let the remote scan reuse the client prune list** — rejected (implemented, then overturned): the
  generic list skips any directory named `lib` at any depth, while `src/lib/*` can be legitimate
  remote source. Each caller keeps an explicit policy.

- **Scan the remote tree by file mtime only** — rejected (implemented, then overturned): when a file
  is merely deleted, no file mtime advances and the only signal is the parent directory.
  `includeDirMtime` is what makes that deletion detectable.

- **Let the directory predicate allow only the top-level `scripts` directory** — rejected
  (implemented, then overturned): `scripts/<subdir>/**/*.ts` satisfies the file predicate but would be
  pruned by the directory predicate — a silent miss where the file predicate accepts a file the walk
  can never reach.

## Acceptance criteria

- `node --test scripts/source-scan.test.mjs`: newest mtime is identical with and without pruning;
  `tests`/`README`/`docs` are not inputs; the memo enumerates a directory once and records its calls.
- The same suite covers inputs under `scripts/<subdir>`, `src/lib/*` under the remote scan, and a
  change where only a file is deleted (directory mtime still reflects it).
- `node scripts/prestart-ensure.mjs` does not run `build:official` when no relevant source changed,
  and does not re-bundle ui-settings-remote either.
- `prepare-dshd-remote.mjs` scans `packages/protocol/src` and `packages/client/src` exactly once per
  run.
- After excluding `tests/` and `README*`, the client input scan takes about 138 ms locally, down from
  about 261 ms for the whole-tree walk.

## Risks

- The predicate is now narrowed to what the build actually reads. If a future build step consumes
  `packages/client/**/tests` or `README` as input (for example packaging test cases as fixtures),
  real changes will be missed; that step must update `isClientSourceFile()` and its tests together.
- Directory pruning relies on the `packages`/`apps`/`native`/`scripts` top level. If client sources
  move outside those directories, the decision degrades to "never stale" and fails silently. The
  tests pin that assumption, so the move must update them first.
- The memo caches mtimes for one run. Both current callers read once early during startup and never
  write sources; reusing the module where sources are written between scans requires re-checking it.
- The `DSH_CLIENT_COMMIT_HASH` comparison still exists; it merely no longer fires for commits in
  unrelated directories. Stage reuse when metadata actually changes stays owned by the build-runtime
  card, and this decision does not claim unrelated commits are free.
- This decision only fixes scan semantics and de-duplication; it does **not** implement per-stage
  (native/host/client/web) input-to-artifact credential reuse. That is the remaining part of item ③,
  and this record claims no completion of it.

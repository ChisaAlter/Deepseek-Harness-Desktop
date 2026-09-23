# Decision: The official build reuses a stage once its input-to-artifact credential verifies

Status: proposed

[中文](2026-09-21-build-stage-credentials.md) | English

## Problem

The root prestart gate used to have two outcomes: either the four public values in
`client-build-environment.json` matched the current checkout and the previous artifacts were kept,
or the whole `build:official` chain re-ran. A commit that only touched `src/main/**`, installer code,
or docs satisfied "HEAD moved", so all four stages — native, host, client and web — were redone. Even
when a rebuild was genuinely needed there was no boundary between the stages: a new commit/version
embedded only in the browser bundles still deleted and rewrote the Node-side artifacts. Nothing
recorded what each stage reads or writes, so nothing could prove on the next run that a given stage
still consisted of exactly those bytes.

## Proposal

Add `vendor/deepseek-harness/scripts/build-stage-credentials.mjs` and turn "may this stage be reused"
into a verifiable fact rather than an inference from HEAD. It is the single implementation: the root
`scripts/prestart-ensure.mjs` consumes the `.mjs` directly (no TypeScript toolchain needed), while
`vendor/deepseek-harness/scripts/build.ts` imports the same file through
`build-stage-credentials.d.mts` type declarations. There is no second copy of the decision logic.

### Stages and artifact ownership

`BUILD_STAGES` is fixed in dependency order as `native-system`, `host`, `client`, `web`. `host` and
`client` are exactly the two halves `build:lib` expands into (`build:lib:host`, `build:lib:client`),
and `build.ts` now calls those sub-scripts directly instead of `build:lib` — a single `build:lib`
invocation inevitably redoes both faces, which makes per-face reuse impossible.

Input and output roots per stage:

- `native-system`: inputs are the manifest, tsconfigs, `scripts/` and `packages/entry/src`;
  outputs are `native/system/packages/entry/bin`. Host binaries are built on Linux and macOS only,
  so a zero-output credential is legitimate on Windows (`requiresOutputs` is platform-dependent);
  on any other platform zero outputs means "not reusable".
- `host`: inputs are `packages`, `apps/cli`, `apps/desktop`, `apps/desktop-host`, three tsconfigs
  and `pnpm-lock.yaml`; outputs are the same roots, but only the `lib/**` entries that are **not**
  browser bundles.
- `client`: almost the same inputs as host, with `tsconfig.host.json` replaced by
  `tsconfig.client.json`; outputs are only `client.js`, `client.<name>.js` and their `.map` files
  (the `entryFileNames` / `chunkFileNames` pinned by `packages/client/tsdown.client.ts`).
- `web`: inputs are `apps/web`, `packages`, `pnpm-lock.yaml`; outputs are `apps/web/dist`.

"Which paths count as artifacts" is decided by `isGeneratedArtifact()` against the **exact output
roots** (`packages/*/*/lib/**`, `apps/*/lib/**`, `apps/*/dist/**`,
`native/system/packages/*/bin/**`), never by a wildcard on the directory name `lib`:
`packages/foo/src/lib/util.ts` is a real input, and misjudging it as generated would let a stale
artifact pass verification. Because host and client share the same output roots, `ownsOutput` must
split `lib/**` in two — otherwise the two stages claim each other's artifacts, and one side still
reports "recorded" after the other side's tree was deleted.

### The three facts

Each stage records four facts, and all of them must hold before the stage may be skipped:

1. **inputs**: every file the stage reads, recorded both as a cheap `size:mtime:ctime` manifest
   digest and as a path-bound content digest (`sha256(len:path || entry)`; the path participates, so
   a rename is a change). New untracked files, deletions and renames change the path list, which the
   manifest covers by itself.
2. **outputs**: every artifact the stage writes, recorded the same way. A tampered, truncated or
   partially deleted tree fails verification and re-runs, while a rebuild that produces **identical
   bytes** still counts as a hit.
3. **environment**: the public values the artifacts actually inline. Only `client` and `web` take
   part in the full set of `DSH_CLIENT_*` — the two consumers are in fact only
   `apps/web/vite.config.ts` and `packages/client/tsdown.client.ts`; `native-system` and `host`
   record `{}`. A commit/version bump therefore rebuilds only client + web, neither redoing
   native/host nor faking a recorded value to slip through.
4. **formatVersion**: an unrecognized schema is ignored and the stage re-runs rather than being
   trusted.

The decision order takes the fast path first: manifests are compared, a manifest hit means reuse,
and only a moved manifest falls back to content digests — so a `touch` or a "same size, same `mtime`,
identical bytes" rewrite still reuses, while genuinely changed content always ends in a re-run.
`ctime` covers the same-size/same-mtime rewrite that no other field can see.

### When to rebuild

Any of the following forces a rebuild, and the verdict is fail-closed:

- the credential file is missing, unreadable, or not parseable JSON;
- `formatVersion` does not match the current implementation;
- the stage's entry is missing, or an entry field has the wrong type;
- the recorded file count does not match the current measurement;
- the environment digest does not match;
- the stage needs outputs on this platform and has none, or a required artifact is missing.

A credential can only ever **skip** work; it can never make a stage succeed that would otherwise
fail. `stagesToRun()` also implements dependency accumulation: if `native-system` is stale, every
later stage re-runs, so stale upstream artifacts cannot be combined into a seemingly valid
downstream. `buildStageCredentials()` writes back only the stages that ran this round or that still
verify; a skipped stage whose credentials no longer hold is not carried into the next round.

### Cost

The steady-state check is one whole-tree walk plus a per-file `stat` over the union of the four
stage roots (about 1.15–1.3 s for 18k files locally; all four stages share the walk and the file
identity cache, which lives in-process and is never persisted). Only stages whose manifest moved
recompute content digests (about 160 MB across the four stages, bounded parallelism 32). The file is
written to `.dsh-build/build-stage-credentials.json`.

## Alternatives considered

- **Keep comparing HEAD with the build record** — rejected: it is both too coarse (an unrelated
  commit triggers a full rebuild, the main cost this work removes) and unable to express stage
  boundaries. Client artifacts really do embed commit/version, so the answer is "a metadata change
  re-runs only the stages that consume those values", not dropping the check.
- **Only change how `prestart` compares, while `build.ts` keeps calling `build:lib`** — rejected:
  `build:lib` always runs both the host and the client face, so Node-side artifacts beyond the
  browser bundles get rewritten for no reason and stage reuse fails exactly where it matters.
- **Decide artifacts by the directory names `lib` / `dist`** — rejected:
  `packages/*/*/src/lib/**` is real source. An over-broad artifact rule drops source files from the
  input set, which is a silent miss; `isGeneratedArtifact()` therefore matches exact output roots
  only.
- **Persist a stat cache to skip the walk** — rejected: a cross-run cache cannot distinguish "the
  file did not change" from "nothing looked this run", so an interrupted run or an external edit
  silently leaves stale artifacts — exactly how this path failed before. (R4 reached the same
  verdict for the `source-scan` memo.)
- **Make the content digest the only criterion** — rejected: reading all 18k files on every start
  costs about 2.2 s, nearly twice the manifest fast path, and the manifest already carries `ctime`,
  which is enough to catch the common same-size/same-mtime rewrite. Content digests stay as the
  fallback when a manifest moves, and `verifyStageCredential(..., { content: true })` keeps an
  explicit forced-content check available; this round does **not** expose that switch on the CLI.
- **Allow reuse when artifacts are missing and let the build tool complain** — rejected: that
  downgrades credential verification to luck. A stage that needs outputs and has none is stale.

## Acceptance criteria

- `node vendor/deepseek-harness/node_modules/vitest/vitest.mjs run
  scripts/build-stage-credentials.client.spec.ts --environment node`: reuse with no change; a
  same-size/same-mtime rewrite (mtime restored with `utimes`) still counts as stale; a new untracked
  file and a deleted input both count as stale; a tampered artifact and a missing artifact count as
  stale, and restoring the bytes hits again; a metadata-only change runs only `['client','web']`;
  a missing, truncated or future-`formatVersion` credential is fail-closed; a skipped stage keeps
  its record.
- `node scripts/prestart-ensure.mjs` runs no build when no relevant source changed, and a
  commit/version change rebuilds only client + web (about 37–68 s measured, versus a substantially
  longer full rebuild).
- `tsc --noEmit -p tsconfig.host.json` passes: `build.ts` uses the same implementation through the
  `.d.mts` declarations, with no second copy of the logic.
- Running `build.ts --profile official` in steady state prints
  `build: all stages are up to date; reusing verified artifacts` and refreshes the 274 artifacts and
  four public values in `client-build-environment.json`.

## Risks

- The steady-state check still walks about 18k files and takes about 1.2 s (about 2.2 s in content
  mode); it trades "a full rebuild on every start" for "one stat walk on every start". The CLI does
  not expose a forced content check such as `--verify-build`; higher assurance currently requires
  calling `{ content: true }` from code.
- The input sets are **deliberately over-inclusive** within each stage's own sources. Missing a real
  input lets a stale artifact be reused (a silent error), while counting an unrelated file only
  costs one unnecessary rebuild; a new input path must therefore update `STAGE_LAYOUTS`, erring
  wide.
- `environment` binds `DSH_CLIENT_*` only for client/web, based on the current code having no other
  consumers. If host artifacts ever start inlining those values, `stageEnvironment()` must change
  with them, or a stale host artifact will be judged reusable.
- This decision covers stage-level credentials only; the mtime scan de-duplication and remote
  pruning in `scripts/source-scan.mjs` stay owned by
  [2026-09-22-build-input-scan-dedup](2026-09-22-build-input-scan-dedup.en.md). They do not replace
  each other: that record decides "what changed", this one decides "which stages must therefore
  re-run".
- The credential file is part of the build output and is not shipped with releases; CI checks out
  cleanly every time, so its first build is necessarily a full one.

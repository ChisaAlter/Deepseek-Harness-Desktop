# Decision: Packaged CLI commander is nested to apps/cli/node_modules per the declared range

Status: implemented

[中文](2026-09-18-packaged-cli-commander-range.md) | English

## Problem

The alpha.2 release candidate failed the skip compose contract in afterPack: `dump-config` exited 1. The root cause was not the contract assertions but the real CLI failing to boot — flattening placed commander@9.5 at top-level `node_modules`. It carries `exports.import` and passes the ESM probe, yet lacks `helpCommand` (provided by ^15). The source tree passes because pnpm links commander@15 for `apps/cli` per its `^15.0.0` declaration; the flatten merges every `node_modules` directory into the top level with traversal-order winner-takes-all, and `apps/cli` lives outside the `node_modules` tree where the existing version-isolation nests (`node_modules/<host>/node_modules`) cannot reach.

## Decision

`repairFlattenedCommanderEsm` gains a "CLI declared range" check after the existing "top level must be ESM" check: read `dependencies.commander` from `apps/cli/package.json` (the deploy directory is itself the package root), resolve what `apps/cli` actually resolves to via `resolvePackageFrom` under Node resolution rules, and when the range is unsatisfied copy the highest matching version from the `.pnpm` store into `apps/cli/node_modules/commander`; fail fast if the store has no match. The top-level commander is no longer rewritten for the CLI — consumers needing older versions keep resolving the original top-level copy; the nest serves only the CLI.

## Alternatives considered

- **Swap the top level to a satisfying version** — rejected: version-isolation nests were already computed against the old top level before the commander repair runs, so swapping top would leave packages needing 9.x without a nested fallback, silently resolving an incompatible version.
- **Teach the flatten to keep apps/cli node_modules unmerged** — rejected: changing `collectFiles` flat semantics broadens the blast radius (isolation for every apps/* would change), disproportionate to this defect.
- **Relax the contract and skip dump-config** — rejected: the contract exists to prove compose on the real packaged CLI; skipping removes the gate.

## Consequences

The packaged tree gains `apps/cli/node_modules/commander` (only when the top level fails the declared range). semver joins devDependencies as an explicit build-time dependency. The contract keeps running skip + full rounds on the real CLI; future "workspace package declared range vs flattened top-level winner" conflicts (e.g. js-yaml, node-addon-require-builtin) follow the same nesting pattern.

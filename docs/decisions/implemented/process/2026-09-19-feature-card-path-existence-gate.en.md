# Decision: Feature-card Allowed touch path-existence gate

Status: implemented

[中文](2026-09-19-feature-card-path-existence-gate.md) | English

## Problem

`verify-feature-cards` only validated card field structure (id/status/last verified/required sections); it **never checked whether the paths listed under `## Allowed touch` actually exist**. This left a structural blind spot: a card could reference deleted or renamed files while the gate stayed green, and card<->code drift was only found by hand. A full-codebase review found 3 such drifts: `desktop-live2d-pet` listed a non-existent `src/main/pet-dsh-mux.js`, `message-edit` referenced the upstream-split `MessageItem.tsx`, and `dsh-tools` referenced the renamed/split `session-persistence-sqlite/src/codec.ts`.

## Decision

Add an Allowed touch path-existence check to `collect()` in `verify-feature-cards.mjs`, deliberately scoped narrow:

- **Only desktop-owned files** (concrete files under `src/`, `scripts/`, `mobile/`, `tools/`, `assets/`, `build/`, `.github/`). Vendor paths are already guarded more strongly by `harness-desktop-forks` markers; not re-checked here.
- **Skip package-relative continuations** (`src/client/...`, `src/styles/...` appearing after a vendored package dir anchor) — not resolvable from the repo root.
- **Skip globs / templates** (`*`, `{}`, `${}`).
- **Only concrete files** (with an extension); bare dirs act as continuation anchors.
- **`(planned)` marker**: a `(planned)` immediately after a path means "intentionally not yet implemented", honoured only on `status: proposed` cards; on an `active` card a `(planned)` or missing path is a card<->code drift violation.

## Alternatives considered

- **Validate every backticked token** — rejected: cards heavily use package-relative continuations, RPC endpoints (`/api/respond`), schemes (`pet://`) and bare basenames; a mechanical `existsSync` produced 145 false positives.
- **Force all Allowed touch entries to be fully-qualified** — rejected: too invasive, and package-relative continuations are useful to readers.
- **Allow `(planned)` on active cards too** — rejected: that would recreate the blind spot; active cards should not declare unimplemented paths (see the desktop-live2d-pet fix).

## Consequences

The gate now catches "card references a non-existent desktop file" drift in CI; this change fixed 3 existing drifts. `check:governance` is also added to the `test.yml` CI (previously only doc-sync ran in CI; the structural governance gate existed locally but not in CI). Package-relative continuations and vendor paths are out of scope, covered by reader convention and forks markers respectively.

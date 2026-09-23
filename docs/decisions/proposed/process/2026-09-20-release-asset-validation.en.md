# Decision: validate release assets with a shared read-only checker before promotion

Status: proposed

[中文](2026-09-20-release-asset-validation.md) | English

## Problem

The promotion step in `publish.yml` previously did two things: it counted how many
`Setup`, `blockmap` and `latest.yml` files sat in `dist-out`, then compared the `Setup`
SHA256 against the digest an operator supplied. It never parsed `latest.yml`, so three
kinds of bad candidate could still be promoted: a `latest.yml` that points at a different
installer (the updater would send users to the wrong asset), a `blockmap` whose stem does
not match the `Setup` (a differential update would patch with the wrong index), and
metadata whose version/size/digest disagree with the actual bytes (discovered halfway
through the update, or silently installing the wrong build). Separately, `release.yml` and
`publish.yml` still referenced actions by mutable tag, giving the release chain weaker
supply-chain constraints than the test chain.

## Proposal

Add `scripts/check-release-assets.mjs`: a **read-only, offline, credential-free and
bounded** release-asset validator, shared by `publish.yml`, the test suite and local
troubleshooting (the workflow does not re-implement the checks).

Contract (every clause has a corresponding case):

- The asset directory must contain exactly one
  `Deepseek-Harness-Desktop-Setup-<version>.exe`, its correspondingly named
  `<Setup>.exe.blockmap`, and exactly one `latest.yml`.
- All three must be regular files (not symlinks or junctions) whose real paths stay inside
  the asset directory; a directory standing in for a file is rejected too.
- The `Setup` filename, the release tag, the `package.json` version and `latest.yml`'s
  `version` must all agree.
- The `Setup` **SHA256** must equal the operator-supplied digest. The validator prints the
  digest it actually confirmed, and the workflow's provenance uses that value rather than
  echoing the input string back.
- `latest.yml`'s `files[]` must contain **exactly one** entry naming the local `Setup`
  filename, with a `size` and base64 `sha512` matching the bytes on disk. Any other
  `files[]` reference (including a non-executable) is rejected.
- Legacy top-level `path` / `sha512` may be absent, but when present they must agree with
  the `files[]` entry and must never contradict it.
- Rejected: malformed YAML, duplicate mapping keys, wrong types (`files` not an array, an
  entry that is not a mapping, `size` not a safe non-negative integer, `sha512` not
  88-character base64), absolute or remote URLs, `..` / `%2F` traversal, backslashes,
  oversized metadata (512 KiB, checked both before and after the read) and any read
  failure.

`latest.yml` is parsed with the repository's already-resolved `js-yaml` 4.3.1 (via
`electron-updater`) using the `JSON_SCHEMA` data-only loader; no dependency is added and no
version changes. The `Setup` is read as a stream for both its SHA512 and its SHA256, never
fully into memory.

**What this explicitly does not prove:** that the `.blockmap` bytes correspond to this
`Setup`. v26 metadata carries no blockmap digest, so only the filename stem can be checked;
no field may be invented to make the gate look stronger.

`publish.yml` changes accordingly: the sparse checkout gains the validator,
`package-lock.json` and `.nvmrc`; the runtime is prepared with a declared,
lockfile-respecting `npm ci --ignore-scripts` (nothing fetched ad hoc, no reliance on
ambient runner packages); the validator is invoked **before** checksums/provenance and
`gh release create`; and a candidate SHA that lacks the helper fails explicitly instead of
substituting another revision's code.

## Alternatives considered

- **Keep counting files in shell inside the workflow** — rejected: shell cannot reliably
  parse YAML (`latest.yml`'s semantics are a nested mapping), and those checks had no test
  coverage; writing the same logic a second time only creates two implementations that
  drift.
- **Parse `latest.yml` with regular expressions** — rejected: the metadata is structured;
  against quoting, indentation, duplicate keys and type changes a regex both false-passes
  and false-fails.
- **Verify a cryptographic correspondence between `.blockmap` and `Setup`** — rejected:
  v26 metadata has no blockmap digest to compare against; inventing one (or computing a
  presumed equivalent) would create a gate with no basis.
- **Add a YAML dependency** — rejected: `electron-updater` already brings `js-yaml`
  4.3.1; a second copy only widens the supply-chain surface and turns version selection
  into a second source of truth.
- **Fall back to the current branch's helper when the candidate SHA lacks one** —
  rejected: the candidate SHA is what gets promoted, so proving it compliant with another
  revision's verification code proves nothing.
- **Have the validator write a result artifact** — rejected: promotion needs only a
  pass/fail plus the confirmed digest, and writing files would break the read-only promise.

## Acceptance criteria

`node --test scripts/check-release-assets.test.mjs` passes (32 cases) covering: valid v26
metadata accepted; metadata without the legacy `path`/`sha512` pair accepted; mismatched
SHA256, size, version, tag-versus-version, metadata sha512, stale blockmap stem, duplicate
Setup, duplicated YAML keys, malformed YAML, wrong `files` type, non-mapping entry,
contradictory legacy `sha512`/`path`, URL traversal, unexpected executable reference,
remote URL, absolute URL, percent-encoded traversal, oversized metadata, missing
Setup/blockmap/latest.yml, symlinked Setup, a directory standing in for metadata or Setup,
and read failures — all rejected.

Four of those are **mutation checks**: the validator is copied outside the checkout and,
one at a time, the SHA256 comparison, the SHA512 comparison, the `files[].url`
versus-local-filename comparison (together with the same-cause "unexpected asset" sweep),
and the `files[].size` comparison (together with the post-hash re-check layer) are
disabled. The mutated copy must then **accept** a bad asset set the shipped version
rejects, while still **accepting** a fully valid set. That proves these are the checks
actually stopping the defect (rather than a later check incidentally doing so) and that the
cases do not pass merely because the validator rejects everything. The scratch copies are
deleted when the test ends; nothing is written inside the checkout.

`src/main/ci-isolation.test.js` gains workflow pins: `publish.yml` still promotes only a
successful `release.yml` candidate on `main`, still requires Desktop tests green for the
same SHA, and still forbids rebuilding; the sparse checkout carries the helper and the
lockfile; runtime prep is `npm ci --ignore-scripts` with no `npx` anywhere in the file; the
validator runs before checksums/publish; and a missing helper fails explicitly.

## Risks

- Asset validation proves only that "this asset set is self-consistent and the Setup
  digest matches the operator's input". Whether that operator digest is itself correct,
  and whether the CI build is trustworthy, is out of scope here.
- `npm ci --ignore-scripts` still needs network and a lockfile on the runner; that is a
  pre-existing premise. This changes "fetch packages on demand" into "fetch the packages
  the lockfile declares" rather than introducing a new trust.
- The validator depends on the v26 shape of `latest.yml` (`files[]` plus optional legacy
  fields). If electron-builder changes the metadata format the gate fails closed — which
  is intended, but the record and cases must then be updated in step.
- `publish.yml` was not actually dispatched this round (it needs a real candidate run and
  tag), so verification is limited to local unit tests and static workflow pins.

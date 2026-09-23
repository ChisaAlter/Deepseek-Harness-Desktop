# Decision: Release and promotion workflows use immutable action revisions

Status: proposed

[中文](2026-09-19-workflow-action-sha-pinning.md) | English

## Problem

`.github/workflows/test.yml` already pins `actions/checkout` and `actions/setup-node`
to commit SHAs, but in the same repository `release.yml` uses the mutable tag `@v4`
(checkout, setup-node, upload-artifact) and `publish.yml`'s checkout is still `@v4`. The
release chain is the only path that produces user installers and official Release
assets: it needs reproducible build inputs more than the test chain does, yet it used a
weaker supply-chain constraint. The audit recorded this inconsistency as AUD-07.

## Proposal

Pin every `uses:` in `release.yml` and `publish.yml` to the same commit SHAs as
`test.yml` (`actions/checkout@11d5960a326750d5838078e36cf38b85af677262`,
`actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`,
`actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`) and keep a `# v4`
comment naming the semantic version. Verify each SHA through the GitHub API tag ref
instead of relying on memory. Add no new third-party action and change no job structure,
permission, or artifact name.

## Alternatives considered

- **Keep `@v4` and add a comment only** — rejected: a comment does not change resolution;
  the tag can still move, which is exactly the risk being removed.
- **Switch the whole repo to a fixed tag such as `@v4.2.2`** — rejected: tags are still
  mutable, just less volatile; only a SHA is an immutable reference.
- **Rely solely on a Dependabot github-actions updater** — rejected: an updater can keep
  references fresh but cannot replace the requirement that the current reference be
  immutable; the two are complementary, and this round only does the latter.

## Acceptance criteria

No `uses: owner/action@vN` mutable-tag reference remains in `release.yml`,
`publish.yml`, or `test.yml`; the three workflows use the same SHA for the same action;
the workflow YAML still parses and the job/step structure is unchanged.

## Risks

SHA pinning needs manual or automated updates; staying on an old commit can miss security
fixes, so it must be paired with a dependency-update process. This round scheduled no
workflow (release is tag/dispatch triggered), so verification is limited to static parsing
and reference consistency. Reusing SHAs already validated in `test.yml` lowers the risk of
introducing a bad reference.

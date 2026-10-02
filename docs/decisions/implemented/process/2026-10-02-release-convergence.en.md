# Decision: Converge releases around frozen candidates and change impact

Status: implemented

[中文](2026-10-02-release-convergence.md) | English

Execution order, automatic CI and governance prerequisites are superseded by the [local-QA-first decision](2026-10-02-local-qa-first-release.md). The original rationale, original-artifact identity constraints and historical evidence below do not authorize the former execution policy.

## Problem

Repeated successful 0.3.3 builds did not reach publication. Candidate replacement, complete manual regression, faulty observers and environmental state shared one loop. Source tests miss installation defects, while repeating every scenario after each local repair prevents convergence. Releases need executable scope, real quality evidence and accountable signoff.

## Decision

The [release process](../../../handbook/modules/release-process.md) owns current execution policy. Development uses risk-focused verification; stable candidates receive the complete automatic matrix, with generated-file and governance checks first. Candidate preflight checks the latest main push CI for the exact SHA and shipping platforms, then freezes an impact plan against the last stable release. Non-shipping macOS failures do not block Windows; shipping DMGs still require their CI and installed acceptance.

Plans retain 26 mandatory installed core scenarios and select affected cases from all changed paths. Dependencies, upstream, core and unknown source changes select the complete catalog. The catalog retains procedures; historical P0/P1/P2 labels do not define defect severity. A failed first packaged smoke stops the candidate instead of hiding first-boot faults through automatic retries. Interrupted downloads resume by immutable artifact ID and verify the digest.

Each candidate has one current JSON record binding Setup/DMG and plan digests, environment, results, issues and approval. Missing core evidence, serious product defects and unclassified failures block publication. Non-core limitations require appropriate risk handling; waivers include owner, rationale, follow-up and expiry. Promotion reads a report at an immutable main commit, verifies original bytes, and publishes the plan, report, limitations and checksums. Evidence updates never rebuild binaries. Automation cannot certify the truth of evidence or substitute for human authorization.

Installed acceptance prefers a separate test user. When unavailable, a reversible profile copy may occupy the normal default path after all product instances exit normally. Preserve the complete original directory, copy without following links, let the old version touch only the copy, and restore the original profile and user installation location afterwards. This changes environment preparation without waiving actual installation, stable-version upgrade or data-retention cases.

A packaged tool host may virtualize the default profile. If directory and peer observations disagree, first bind an unpackaged observer's physical directory to the installed process before touching data. The host's copy supplies neither installed-profile identity nor evidence of a product fault.

Related decision audit:

| Existing record | Relationship and handling |
| --- | --- |
| [Release asset validation](../../proposed/process/2026-09-20-release-asset-validation.en.md) | Partial overlap; retain asset and metadata verification, extend platform eligibility and installed signoff |
| [Evidence gates](2026-09-19-audit-repair-evidence-gates.en.md) | Partial overlap; retain truthful results and side-effect boundaries, use the new release loop and failure classification |
| [UI walkthrough contract](2026-10-01-release-ui-walk-contract.en.md) | Partial overlap; retain observer semantics, avoid automatically rebuilding products or rerunning complete source walks for tool repairs |

## Alternatives considered

- Repeat every local and installed case after each fix: simple selection and broad coverage, but new risks become indistinguishable from known environment failures and replacement repeatedly restarts work.
- Publish on green CI alone: fast, but cannot certify installation, upgrades, Shell caches or actual shutdown.
- Change documentation alone: cheap to deploy, but automation would still permit promotion without installed acceptance and identity could drift.
- Inherit passes for unchanged modules from previous installers: cheaper, but packaging and cross-module effects are difficult to prove; this design reruns core cases for each new package and labels unselected cases as unexecuted.

## Consequences

Acceptance of the original installer confirmed that the Codex host's virtualized profile and Git environment do not represent ordinary desktop processes. Windows PowerShell 5 script encoding must also be checked before profile writes. The process now checks prerequisites first: real model credentials, an old-version session, external dependencies and device fixtures. Missing prerequisites block their cases without rebuilding or fabricating passes; dependencies supplied only to a test process are recorded as environment differences. Original user data is preserved, with the test copy and original restored and retained separately.

Ordinary localized releases no longer repeat the complete catalog; broadly changed runtimes can still require full acceptance, so no fixed-hour publication promise is made. Impact mappings require maintenance as modules evolve, with unknown paths falling back to full coverage. Humans must review the diff and add missing risks. Evidence must be sanitized before publication, and the owner reviews authorization authenticity.

Old candidates lack the new plan and tools and cannot receive fabricated retroactive approval; first use requires a new candidate. Original artifact bytes and immutable tags remain required, with no promotion rebuild. Local behavior and wiring checks do not certify actual GitHub Actions, installed acceptance or public release; results are recorded in the [feature card](../../../features/release-process.md).

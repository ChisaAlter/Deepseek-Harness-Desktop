# Decision: Explicit Target Repository for Fork PRs

Status: implemented

[中文](2026-09-19-fork-pr-target.md) | English

## Problem

When origin points to a user fork but gh selects the upstream PR target, the old code compares the head repository with origin and incorrectly treats the PR as same-repository. Creation passes an unqualified head that GitHub cannot resolve. Description generation also uses the origin baseline incorrectly. The existing decision tree was audited and no record owns this behavior; records mentioning forks in other modules are unrelated.

## Decision

Each PR lookup resolves the target repository URL and default branch through gh. A creation operation reuses that target and explicitly passes it to lookup, creation, and post-creation lookup. Head identity is compared with the actual target; cross-repository creation uses owner:branch. Listing filters by branch name and then checks the returned head repository identity.

Explicit gh-merge-base configuration retains priority; otherwise same-repository requests retain the existing tracking-branch rule and cross-repository requests use the target default branch. Generated descriptions use the local remote branch matching the target URL. A missing fetched baseline fails explicitly instead of silently using the fork baseline. A successfully resolved target change invalidates the old PR cache; temporary target resolution failures retain the existing transient-failure badge policy.

## Alternatives considered

- Always target origin: avoids another lookup but sends upstream contributions to the user's fork.
- Always qualify the head with an owner: covers the reported error but does not align lookup, target default branch, and description range.
- Automatically fetch missing target branches: reduces user steps but adds network activity and local ref changes; this change requires the user to fetch first.

## Consequences

Fork and same-repository flows use consistent repository identity, at the cost of one extra read-only gh request per lookup. Failed target resolution or PR lookup prevents creation. Description generation requires the target remote and baseline locally. Tests use real temporary Git repositories and controlled gh responses without creating online PRs; actual GitHub creation remains an explicit user action.

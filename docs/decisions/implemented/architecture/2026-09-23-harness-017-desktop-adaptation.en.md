# Decision: Desktop interface adaptation for Harness 0.1.7-alpha.2

Status: implemented

[中文](2026-09-23-harness-017-desktop-adaptation.md) | English

## Problem

`dsh-v0.1.7-alpha.2` changes settings forms, session projections, the Jobs service, and client slots. Desktop code written against the older interfaces can leave titlebar switches, Settings, the agent list, and document preview unable to compile or update live. Replacing the entire tree would remove existing Desktop interactions.

Existing decision audit: the [alpha.2 Desktop adaptation](2026-09-18-harness-alpha2-desktop-adaptation.en.md) partly overlaps and still governs session references and Desktop features; the [alpha.1 merge-drift ruling](../bug-fix/2026-09-17-vendor-alpha1-merge-drift-remediation.en.md) still supplies the upstream-contract-first, Desktop-fidelity rule. This record covers only the new 0.1.7 interfaces and does not replace either historical decision.

## Decision

- Continue the three-way merge from the old pin as common ancestor, bringing the official tree and Desktop extensions into the new pin together. The pin identifies applied source, not successful build or release acceptance.
- Move Desktop settings consumers to upstream `ConfigForm` and the `configForms` service. Preserve durable titlebar and Git switches and their shown-by-default behavior while loading; do not revive the removed `SettingsScope` in Desktop code.
- Read agents for the current session from `subagentCatalog` in session `projectionsBySession`, falling back to session parent-child relationships when the catalog is absent; read job state from the upstream Jobs service. Keep the session retained by the main view as the Desktop scope.
- Wire conversation content, document preview, and Settings through the new upstream slots and injection interfaces. Preserve Desktop session presentation, preview actions, right-column work loops, and existing design-language constraints; adapt test fixtures to the actual interfaces while continuing to verify those Desktop behaviors.
- Select only workspaces that still have a `package.json` for the official aggregate build. Local `lib` or `node_modules` remnants from removed packages must not become bundle inputs.

## Alternatives considered

- Keeping a local compatibility layer for the old settings and agent services reduces changes at current call sites, but creates a second lifecycle and state source that complicates reconnects and later upstream upgrades; rejected.
- Replacing the entire vendor tree with upstream files reduces merge conflicts, but removes accepted Desktop extensions and their regression protection; rejected.
- Removing failing tests or weakening assertions shortens migration, but cannot establish that Desktop behavior still works through the new interfaces; rejected.

## Consequences

Desktop consumers, package dependencies, test fixtures, and documentation must migrate with the official interfaces. The vendor build, regressions, Desktop source smoke test, and application restart remain required after updating the pin; the [sync feature card](../../../features/harness-upstream-sync.md) records verification state. The user explicitly requested commits of the local snapshot and completed merge; a commit does not constitute a release.

# Decision: Remove desktop documentation word-count gates

Status: implemented

[中文](2026-09-29-remove-doc-word-limits.md) | English

## Problem

The maintenance system imposed fixed word-count ceilings on four core documents. Necessary contract additions could therefore fail `doc-sync`. The user explicitly requested removal of this restriction.

Existing-decision audit: the [transparent-window OS corner-mask fix](../bug-fix/2026-09-27-transparent-window-os-corner-mask.en.md) partially overlaps, having raised the design-language ceiling to 14400. Its product fix remains valid; this decision removes its word-count ceiling. Historical plans and acceptance logs retain their original facts.

## Decision

Remove the word-count gate from desktop `doc-sync`, deleting its validator, budget manifest, and dedicated tests. None of the four documents retains a fixed word-count limit. Update the maintenance overview, check skill, and hook comment together. This maintenance change does not alter product contracts, add a feature card, or modify vendor governance.

## Alternatives considered

- Raise the existing ceilings: this temporarily passes checks but still blocks future necessary content and does not fulfill the request to remove the restriction.
- Emit non-blocking warnings: this retains length feedback but continues maintaining fixed thresholds the user has canceled, so it is rejected.

## Consequences

Document length no longer fails desktop `doc-sync` locally or in CI. Decision format, archives, feature cards, rule synchronization, links, and bilingual pairing remain checked. Concision is an editorial judgment; the gates no longer flag long documents automatically.

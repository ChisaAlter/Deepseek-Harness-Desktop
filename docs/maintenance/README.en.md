# The DSHD maintenance system

[中文](README.md) | English

The maintenance system helps the next change happen correctly. It preserves current contracts, consequential decisions and reviewable evidence; document counts, test counts and process repetitions are not quality measures. This file defines current maintenance policy; publication follows the [release process](../handbook/modules/release-process.md).

## When it matters

| Moment | Question | Necessary output |
| --- | --- | --- |
| Before a change | What did the user observe, which module owns it, and what is promised? | Read the relevant feature card and handbook; define reproduction and direct observation |
| During a change | Does a lasting contract change, and why choose this implementation? | Update affected facts; record decisions only for lasting tradeoffs |
| Before commit and release | Does the fix work, are relevant risks covered, and does the package match the evidence? | Behavioral validation and CI; installed acceptance for the original release package |
| After an incident or at handoff | Why was this missed, how will it be detected, and what remains unresolved? | Keep the shortest reproduction, verification entry and current status; review systemic incidents when useful |

An ordinary fix does not require a proposal, decision and postmortem before work starts. Proceed with already authorized work; file lists locate code and are not additional approval boundaries. Only missing material product choices, irreversible actions or actual release signoff require the corresponding decision.

## One maintained home per fact

| Content | Authoritative location | Update trigger |
| --- | --- | --- |
| User paths and lasting invariants | [Feature cards](../features/README.md) | A public contract or real verification result changes |
| Implementation entry, architecture and operations | [Handbook](../handbook/README.md) | Current implementation or operation changes |
| Consequential tradeoffs and reasons | [Decision records](../decisions/README.en.md) | A lasting architecture, compatibility, data-format or release-policy decision changes |
| Incident timeline and missed detection | [Postmortems](../postmortem/README.md), existing issue / QA records | Systemic, costly or recurring failures need evidence across changes |
| Agent entry points and hints | Root AGENTS, maintenance skills, rule links | Navigation or execution principles change |

Read the relevant module first; traversing the entire decision history is not required. Update an existing record for the same decision. Ordinary bug fixes, mechanical edits and implementation changes within an existing contract need only a commit or PR explanation and validation. New internal decisions default to one language; keep existing bilingual records maintained and synchronize public docs under the [pairing rules](../i18n/README.en.md).

Feature cards hold current facts, the latest relevant verification and evidence links, without accumulating release journals. Rule files keep necessary hints and card entry points. Resolve contradictions instead of expanding work because an old file says “must.” New decisions may supersede old ones; historical evidence retains its original success and failure boundaries.

## How fixes prevent recurrence

1. Pin the specific failure, version, data and environment. Distinguish a regression, an earlier fix that never closed the issue, similar symptoms with another cause, and observer errors. Mark unresolved attribution as unknown.
2. Keep an executable reproduction in the owning module and assert observable behavior. Add automatable examples to existing tests; use the original defective revision or a controlled defect restoration to show that the test fails. If this comparison is unavailable, disclose the gap instead of claiming recurrence prevention.
3. Run the same scenario and directly relevant boundaries after fixing it. Confirm discovery by the actual CI command, without skip or environment bypasses. Source strings, mocked calls and property assertions establish local mechanisms, not the final observable result.
4. Preserve real-environment validation for installation, upgrades, system caches, permissions and timing. Record clean starts and polluted states separately. Keep an issue open while its failure remains. Change rules or record a decision only when the missed detection exposes a lasting policy issue.

When failures recur, repair reproduction coverage or execution wiring first; another document does not close the issue. Stop repeating validation without a new change, failure or uncovered risk. Keep detailed logs in existing issue / QA records and necessary fixtures and rationale in tests; do not add another bug ledger.

## What automated checks prove

Structural gates check decision layout, format, archive seals, card fields and references. The compatibility name `verify-rules-sync` checks actual Markdown links, not semantic agreement. Pairing checks establish structural and confirmation-hash consistency, not translation accuracy. None certifies product behavior, installed builds or release quality.

Module tests and CI check behavior, real environments check platform interactions, and the release process governs publication. Report these layers separately; green in one does not imply green in another. CI checks its exact checkout. Local hooks inspect the working directory as early feedback, not proof of partially staged content or commits being pushed.

## Entry points

```sh
npm run check:governance
npm run doc-sync
node scripts/install-git-integrations.mjs --check
node scripts/install-git-integrations.mjs
node scripts/verify-translation-pairing.mjs --write <path>
node scripts/archive-decision.mjs <record> --superseded-by <new-record>
```

Select local checks for the change and stop repeating suites after relevant checks pass. Maintenance checks are inexpensive; retain full CI documentation checks without a new cache or approval framework. Refresh pairing confirmation only after reviewing both sides; `--list` displays an inventory and is not a passing result.

The prepare step of `npm install` attempts to install hooks and the merge driver; `--ignore-scripts` and source archives do not guarantee installation. Verify with `--check` and run the installer directly if missing, without reinstalling dependencies. Existing custom hooks / drivers are preserved for explicit integration. Pre-commit runs structural checks and pre-push runs documentation checks, without full product tests or builds.

## History and scope

`docs/superpowers/`, `docs/qa/results/` and sealed decisions are outside current link repair; sealed content retains hash protection. Archival handles implemented decisions, with or without translations. Failed preflight moves nothing and execution errors restore originals. Rejected proposals remain rejected instead of being relabeled implemented.

Document length follows facts, without page or alternative-count quotas. Upstream governance applies when changing upstream-owned content; external contributions follow [CONTRIBUTING](../../CONTRIBUTING.en.md). Rationale and limitations are in the [maintenance feedback decision](../decisions/implemented/process/2026-10-02-maintenance-feedback.md).

# The DSHD maintenance system

[中文](README.md) | English

This repository's executable governance system: rules are written for agents to read, decisions settle as managed documents, and every mechanically checkable discipline is a script. This file is the single overview; each layer's details live in its own README.

## Five layers

| Layer | Location | Role | Gates |
| --- | --- | --- | --- |
| Contract | [docs/features/](../features/README.md) + `.cursor/rules/` | Product behavior contracts: user paths, invariants, allowed touch, gates | `verify-feature-cards`, `verify-rules-sync` |
| Decision | [docs/decisions/](../decisions/README.en.md) | The why: motivation, rejected alternatives, cost; lifecycle encoded in the path | `verify-decision-tree`, `verify-decision-format`, `verify-archived-decisions` |
| Narrative | [docs/postmortem/](../postmortem/README.md) | Incident narratives — the only tier allowed to tell stories | none (narrative is not gated) |
| Locale | [docs/i18n/](../i18n/README.en.md) | Bilingual pairing: triplets, blob hashes, structural signature, pending ratchet | `verify-translation-pairing` |
| Execution | `scripts/` + `.github/` | Gate aggregation, git hooks, merge driver, PR/issue templates, dependabot | `run-gates.mjs`, `verify-md-links`, `verify-doc-budgets` |

Agent entry points: root [AGENTS.md](../../AGENTS.md) holds the standing orders; `.devin/skills/` carries `dshd-maintenance` (decision-record operations) and `dshd-checks` (change surface → minimal check set) as executable procedures.

## Knowledge reflow

```
incident → docs/postmortem/
         → guardrails: tests / rules / gates
         → AGENTS.md / docs/features/ / .cursor/rules/
         → scripts/verify-* + *.test.mjs
         → .devin/skills/<name>/SKILL.md
         → rule links back to owning docs/decisions/ record
```

The reverse holds too: before a new decision, search `rejected/` and the active tree — do not re-propose a rejected route.

## Commands

```sh
npm run check:governance    # structural gates: decision tree/format/archive seal/cards/rules sync/remote flag
npm run doc-sync            # full doc gates: the above + dead links/pairing/word budgets
node scripts/verify-translation-pairing.mjs --list          # state of every pair
node scripts/verify-translation-pairing.mjs --write <path>  # re-record after editing either side
node scripts/verify-archived-decisions.mjs --write          # re-seal when archiving
node scripts/archive-decision.mjs <record> [--superseded-by <new>]  # archive in one step
node scripts/resolve-pairing-conflicts.mjs                  # clean up i18n merge conflicts
DSHD_GATE_FAIL_FAST=1 npm run doc-sync                      # stop at first red
```

`npm install` runs `prepare`, which installs the git integrations: `core.hooksPath` points at `scripts/git-hooks/` (pre-commit runs the structural gates, pre-push runs doc-sync), and `*.i18n.yaml` merges through the `dshd-translation-pairing` driver.

## Boundaries

- `docs/superpowers/` (process drafts), `docs/qa/results/` (historical acceptance records), and `vendor/` (upstream's own governance) are outside link and pairing checks.
- External PRs and issues are welcome: see [CONTRIBUTING.en.md](../../CONTRIBUTING.en.md); cards and rules are maintainer-finished.
- This system governs repository maintenance, not product UI — product changes go through feature cards and [design-language.en.md](../design-language.en.md).
- No generated board or `// Note:` code anchors yet — the record count does not need an index; add them on the upstream build-board / check-note-anchors pattern when needed, not preemptively.

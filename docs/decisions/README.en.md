# Decision records

[中文](README.md) | English

One kind of design document lives here: a record of a decision or proposal that affects this repository — the motivation, the rejected alternatives, and the cost, i.e. the "why" that code and docs cannot carry. This file defines where decision records live, their lifecycle, format, and when to write one.

## Layout and naming

Every decision record has two axes, both encoded in its **path**: `{lifecycle}/{class}/yyyy-mm-dd-slug.md`:

- **lifecycle** (the top-level folder) is the record's status, and a record moves between folders as that status changes:
  - `proposed/` — proposals reviewed before implementation; may speak in future tense and carry plans
  - `implemented/` — the decision shipped; kept current with code facts (facts only: paths, names, defaults — never rewriting the decision itself)
  - `rejected/` — considered and declined; worth keeping only while its rationale prevents a repeat mistake, otherwise delete the whole triplet
  - `archived/` — a **frozen** zone for implemented records whose future guidance value is low; never edited, never treated as current authority, sealed by `verify-archived-decisions` through a hash manifest
- **class** (the nested folder) is a closed set defined in `scripts/decision-tree.json`: `product` user-visible behavior / `architecture` structure and mechanisms / `process` tooling and workflow / `bug-fix` defect corrections / `testing` test infrastructure and strategy. Adding a class requires updating both the JSON and this section.
- The filename date is the **first-proposed** date (per git history); cross-references between records always use relative markdown links so `verify-md-links` can check them.

## When to write one

- Every non-trivial change (behavior, contracts, structure, process, on-disk/wire/config formats) MUST add or update at least one decision record in the same PR; purely mechanical or local edits are exempt.
- Updating the owning record satisfies the rule; never create a duplicate for one decision. Reversing a decision means a new cross-linked record — do not rewrite an old record into its opposite.
- A fully superseded implemented record may be consolidated and deleted: the deleting change must preserve every unique rationale, alternative, and verification of the old record, repair every inbound link, and delete its `.en.md` and `.i18n.yaml` in the same commit.
- Archival is one command: `node scripts/archive-decision.mjs <record path> [--superseded-by <new record>]` — it moves the triplet into `archived/`, stamps `Archived:` on both sides, rewires inbound links, and re-records sidecars plus the sealed manifest; `--superseded-by` inserts a `Supersedes:` pointer into the successor (the archived record stays frozen — the pointer only ever lives in the new one). Archived content is frozen forever.

## File format

`verify-decision-format` (part of `doc-sync`) mechanically checks:

- The first three lines are fixed: `# Decision: <title>`, a blank line, `Status: <status>`; the machine-checked tokens (`# Decision:`, `Status:`) stay English verbatim in both language files.
- Status agrees with the folder: `proposed` / `implemented` / `rejected — <one-line reason>`; files under `archived/` keep `Status: implemented` plus the `Archived:` line.
- The body opens with `## Problem`; `## Alternatives considered` is mandatory — one paragraph per genuinely considered alternative: what it was and why it lost. Alternatives are recorded, never invented.
- The skeleton follows the lifecycle: proposed uses `Problem → Proposal → Alternatives considered → Acceptance criteria → Risks`; implemented uses `Problem → Decision → Alternatives considered → Consequences` (present tense, proposal-era headings such as `## Proposal` / `## Plan` / `## Acceptance criteria` / `## Risks` are rejected); rejected freezes the proposal skeleton with the verdict on the Status line.
- Bespoke technical sections (topology, wire contracts, schemas) stay free-form between the required ones.

## Division of labor with feature cards

- Cards (`docs/features/`): the **current contract** — user paths, invariants, allowed touch, gates. They state only what is.
- Decision records: **why it is so** — motivation, rejected alternatives, cost, required verification; proposals also carry planning text.
- A card's `Sources` section links its owning record with a `Decision:` row; a declined proposal lives only in `rejected/` and never gets a card; a `status: killed` card is a negative contract against reintroduction and should trace to a decision record or spec.

## Writing rules

- One home per fact; link from everywhere else. Document current state, not change history — history lives in git, PRs, these records, and postmortems.
- Write directly: name actors and facts, no metaphors; before reaching for `contract`/`boundary`/`shape`, ask whether a more exact term names the subject.
- Wire mechanically checkable invariants into gates rather than leaving them as conventions held up by review memory.
- Bilingual: `slug.md` is the Chinese source of truth, `slug.en.md` the English counterpart, `slug.i18n.yaml` the confirmation record; the contract lives in [../i18n/README.en.md](../i18n/README.en.md).

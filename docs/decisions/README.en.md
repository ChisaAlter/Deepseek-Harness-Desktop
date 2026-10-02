# Decision records

[中文](README.md) | English

Record lasting tradeoffs that future maintainers need to understand. Intervention points and recurrence prevention are defined by the [maintenance system](../maintenance/README.md).

This document supplies record layout and tool mechanics under [the sole WhaleIsle maintenance policy](../maintenance/README.md); it adds no separate review, documentation or testing gate. Historical execution choices do not authorize current action.

## When to write

- Update an existing record when architecture, compatibility, persistent data formats or release / testing responsibilities change in a lasting way and the reason is not apparent from the implementation. Create one only if none owns the decision.
- Ordinary bug fixes, mechanical edits and implementation changes within an existing contract need no new record. Explain reproduction, cause and validation in the commit / PR.
- Proceed with authorized work. Use proposed only for an unresolved material choice; write a completed decision directly as implemented, without a mandatory proposal review.
- Maintain each fact once. Cards describe current contracts, handbooks current implementation, and decisions rationale; do not duplicate validation journals.

## Layout and lifecycle

Use `docs/decisions/{lifecycle}/{class}/yyyy-mm-dd-slug.md`; the date is when the idea was first proposed.

| lifecycle | Meaning |
| --- | --- |
| proposed | A choice that remains undecided |
| implemented | An implemented decision, retaining tradeoffs and limits |
| rejected | An unchosen option with its real reason in Status; retain only useful warnings |
| archived | Frozen history of implemented decisions; never current policy |

Classes come from `scripts/decision-tree.json`: product, architecture, process, bug-fix, testing. Update facts in place; a reversal gets a new cross-linked record rather than rewriting the earlier decision into its opposite.

Archive with `node scripts/archive-decision.mjs <record> [--superseded-by <new-record>]`. Only implemented records are archived, preserving single-language or paired form, updating active inbound links and sealing content. Historical QA, drafts and sealed records remain unchanged. Failed preflight moves nothing; execution failure restores original files. Rejected decisions keep their lifecycle.

## Content format

- First three lines: `# Decision: <title>`, blank, `Status: <lifecycle>`. Rejected adds ` — reason`; archived retains implemented and adds the archival date.
- Open with `## Problem`. Implemented / archived require `## Decision` and `## Consequences`; proposed requires `## Proposal`, `## Acceptance criteria`, `## Risks`; rejected retains the problem and rejection reason.
- `## Alternatives considered` is optional. Record only genuinely considered options, without a minimum count. Omit empty sections instead of inventing tradeoffs.
- Implemented records do not retain Proposal or Plan sections. Disclose unfinished operations and tests as consequences or evidence limitations.
- Add technical sections when useful; length follows facts without word or page quotas.

The [template](_template.en.md) provides an implemented-record outline, not a form required for ordinary edits.

## Language and sources

New internal records default to a single `slug.md`, in Chinese or English, without translation placeholders or sidecars. Existing pairs and explicitly bilingual public docs continue under the [pairing rules](../i18n/README.en.md); do not delete existing translations to bypass checks.

A [feature card](../features/README.md) may use `Decision: none` in Sources; link the actual file when a lasting decision exists. A valid link only establishes existence, not correctness, verification or continued applicability.

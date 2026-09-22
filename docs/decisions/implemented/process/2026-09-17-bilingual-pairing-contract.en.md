# Decision: Full bilingual pairing mechanism with a migration ratchet

Status: implemented

[中文](2026-09-17-bilingual-pairing-contract.md) | English

## Problem

`docs/` already carries 4 `.en.md` counterparts (README, design-language, motion, release-notes), but nothing guarantees a counterpart stays in sync with its source — drift happens silently, and English readers and English-speaking agents may consume stale contracts.

## Decision

A pair is three sibling files: `foo.md` the Chinese source of truth, `foo.en.md` the English counterpart, and `foo.i18n.yaml` a confirmation record holding both sides' git blob hashes. `verify-translation-pairing` mechanically checks: triplet completeness, recorded hashes equal current blobs, language switchers (the Chinese file links `中文 | [English](foo.en.md)` right after its H1; the English file links `[中文](foo.md) | English`), and a structural signature (heading-depth sequence, table row/column counts, list kinds and item counts, byte-exact code-fence sequence, and relative document links that each target the same-locale side). `--write <pair>` re-records and is the reviewable act of confirmation; `--list` reports state without failing. `.gitattributes` routes `*.i18n.yaml` through the `dshd-translation-pairing` merge driver: when both owner files merge cleanly and the merged pair retains its structural signature, the driver composes a new record automatically; otherwise it fails closed and `scripts/resolve-pairing-conflicts.mjs` handles an already-stopped merge.

Scope and exclusions live in `scripts/translation-pairing.manifest.json` (`docs/superpowers/**`, `vendor/**`, and one-off documents are excluded). Existing in-scope files without a pair go on the `pending` list: the gate rejects new unpaired files outside the list, and pre-commit requires that editing a pending file completes its triplet in the same commit — a ratchet that only shrinks.

## Alternatives considered

- **Translate everything once, then enable the gate** — rejected: ~60 documents of one-shot translation delays landing, and new documents keep arriving unpaired meanwhile.
- **Pair only feature cards** — rejected: handbook and qa are contract surfaces too; external readers hit the same drift.
- **A long-lived per-file rollout list** — rejected: upstream explicitly forbids rollout lists; `pending` covers only the migration backlog and may only shrink.
- **No merge driver** — rejected: pairing records are a guaranteed conflict point at merge time; auto-composition saves a manual repair per merge.

## Consequences

Editing an in-scope document means maintaining its English counterpart (the working agent translates in one pass, then re-records with `--write`). A green gate proves only that the two sides were confirmed consistent at these exact contents — translation quality remains the reviewer's half of the contract. The `pending` list is acknowledged debt until the migration completes.

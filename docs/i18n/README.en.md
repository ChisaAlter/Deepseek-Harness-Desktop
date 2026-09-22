# Bilingual pairing contract

[中文](README.md) | English

A bilingual pair is three files: `foo.md` the Chinese source, `foo.en.md` the English counterpart, and `foo.i18n.yaml` a confirmation record. This file defines the pairing rules; the rationale lives in [2026-09-17-bilingual-pairing-contract.en.md](../decisions/implemented/process/2026-09-17-bilingual-pairing-contract.en.md).

## Scope

- `docs/decisions/**`: every record requires the full triplet (the tree gate separately checks siblings).
- Other pairs are opt-in: a stem path listed in `scripts/i18n-pairs.manifest.json` enters the gate.
- Reverse constraint: any `*.en.md` / `*.i18n.yaml` must belong to a discovered or registered pair — no shadow copies.
- `docs/superpowers/`, `docs/qa/results/`, and `vendor/` are unpaired (process drafts and historical records).

## What the gate checks (verify-translation-pairing)

1. Triplet completeness.
2. Switcher lines: `中文 | [English](<stem>.en.md)` on the Chinese side, `[中文](<stem>.md) | English` on the English side, each inside the first eight non-empty lines; documents with a centered HTML header (e.g. the root README) may use the equivalent `<a href="<stem>.en.md">English</a>` / `<a href="<stem>.md">中文</a>` form.
3. `foo.i18n.yaml` records both sides' git blob hashes and the structural-signature hash; editing either side without re-recording is red.
4. Structural signature: heading-depth sequence, list kinds and item counts, table rows×columns, byte-exact code-fence sequence, normalized relative-link sequence — the two sides must be equal (prose is not counted; phrasing is free). Links stay on their own locale side: the Chinese side never links `.en.md`; the English side must link `.en.md` when the target has an English counterpart.
5. Ratchet: a stale pair may be registered in `scripts/i18n-pending.manifest.json` as a grace period; a pair that is fresh again must leave the list (a stale entry is red). Pending entries only shrink — adding one is visible in the diff and needs justification in the PR.

## Operations

- After editing either side: `node scripts/verify-translation-pairing.mjs --write <any path in the pair>` re-records the sidecar. Re-recording is the reviewable act of "I confirm both sides agree at this content".
- `node scripts/verify-translation-pairing.mjs --list` reports every pair's state (ok / stale / pending / incomplete / violations) without failing.
- The full gate runs inside `npm run doc-sync`.

## Honest boundary

Green only proves: both sides were confirmed consistent at this content, with identical skeletons. It does not prove translation quality — that is the reviewer's half of the contract.

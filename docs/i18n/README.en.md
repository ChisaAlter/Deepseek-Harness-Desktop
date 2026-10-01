# Bilingual pairing

[中文](README.md) | English

Existing pairs use `foo.md`, `foo.en.md` and `foo.i18n.yaml` for content and confirmation. New internal decisions default to one language; the scope change is in the [maintenance decision](../decisions/implemented/process/2026-10-02-maintenance-feedback.md).

## Scope

- An internal single-language decision needs only `slug.md`, in Chinese or English, without pending registration or an empty translation.
- An English counterpart, confirmation file or switcher to the record's own English counterpart opts a decision into pairing checks. The README and template remain bilingual.
- Other documents requiring both languages register in `scripts/i18n-pairs.manifest.json`. Maintain existing public pairs and translations.
- Unregistered copies, orphan sidecars and incomplete pairs still fail. Pending only excuses stale hashes, not missing files or structural disagreement.
- Drafts, historical QA and vendor content are outside this repository's bilingual governance. Archived pairs remain complete; single-language archives need no added translation.

## Checks

1. Paired files are complete; single-language decisions are outside pairing checks.
2. Switchers appear within the first 14 non-empty lines: `中文 | [English](<stem>.en.md)` on the Chinese side and `[中文](<stem>.md) | English` on the English side; existing HTML equivalents are accepted.
3. Confirmation content and structural hashes match current files; review both sides before refreshing after edits.
4. Heading, list, table, code-fence and relative-link structures agree without requiring identical wording. English links select existing English counterparts; Chinese links stay Chinese.
5. Remove pending entries once consistent. Explain new pending entries; they do not replace missing translations.

## Operations

```sh
node scripts/verify-translation-pairing.mjs --list
node scripts/verify-translation-pairing.mjs --write <path>
npm run doc-sync
```

`--list` only displays states; successful exit does not certify pairing. `--write` refuses confirmation when content is missing or structure disagrees. Machines cannot confirm translated meaning; maintainers must review it. Do not batch-refresh hashes just to turn a check green.

## Evidence limits

Passing establishes file, structural and confirmation-hash consistency, not translation accuracy or product acceptance. Single-language internal decisions do not reduce product-test requirements. Current maintenance rules replace the internal mandatory-bilingual scope of the earlier [pairing decision](../decisions/implemented/process/2026-09-17-bilingual-pairing-contract.en.md).

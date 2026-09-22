# Contributing

[中文](CONTRIBUTING.md) | English

DSHD accepts external pull requests and issues. This file spells out the bar so contributors don't hit invisible rules.

## Before opening a PR

- **Run tests**: `npm test` (full node:test suite). For documentation changes also run `npm run doc-sync` (doc gates: pairing, dead links, decision format).
- **Run `npm install` once on a fresh clone**: `prepare` installs the pre-commit/pre-push hooks and the i18n merge driver; existing clones should re-run it after pulling this governance batch.
- **Bring proof**: the PR template has a `Proof` block — paste reproducible test output, screenshots, or recordings. "Should be fine" is not accepted.
- **Scope**: one PR does one thing. Split refactors from behavior changes.

## Feature cards and decision records (external-contributor edition)

- Product behavior contracts live in [docs/features/](docs/features/README.md). **External contributors do not create cards**: when a change touches an existing contract, a maintainer names the card in review and asks you to align; for new features the maintainer writes the card.
- Same for decision records: the "why" of a non-trivial change gets recorded under [docs/decisions/](docs/decisions/README.en.md) `proposed/` by a maintainer or by you. Want to propose a rule change by PR? Just open it — discussion happens there.
- `.cursor/rules/*.mdc` are maintainer-owned; do not edit them in a PR.

## Bilingual docs

- `docs/decisions/**` and pairs registered in `scripts/i18n-pairs.manifest.json` follow the triplet contract (see [docs/i18n/README.en.md](docs/i18n/README.en.md)).
- **English-only is fine**: submit the English text and a maintainer backfills the Chinese source (the lag is registered as pending). The reverse works too.

## Issues

- Use the templates: Bug / Feature (`.github/ISSUE_TEMPLATE/`). For bugs include version, reproduction steps, logs or screenshots.
- Do not file public issues for security vulnerabilities — see the repository security note or contact the maintainer privately.

## License

MIT. Submitting a change means you agree to license it under this repository's license.

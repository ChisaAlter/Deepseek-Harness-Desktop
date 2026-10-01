# Contributing

[中文](CONTRIBUTING.md) | English

DSHD accepts external pull requests and issues. This file spells out the bar so contributors don't hit invisible rules.

## Before opening a PR

- **Run tests**: provide focused evidence for the changed behavior; CI runs the complete node:test, GUI, core and platform matrix. Consolidate broad regression on a stable candidate. Run `npm run doc-sync` for documentation changes; follow the [release process](docs/handbook/modules/release-process.md) for publication.
- **Check Git integrations**: `node scripts/install-git-integrations.mjs --check` verifies actual hooks / merge-driver configuration. If missing, run it without `--check`, without reinstalling dependencies. Existing custom integrations are preserved. Hooks inspect the working directory; CI checks the actual commit.
- **Bring proof**: the PR template has a `Proof` block — paste reproducible test output, screenshots, or recordings. "Should be fine" is not accepted.
- **Scope**: one PR does one thing. Split refactors from behavior changes.

## Feature cards and decision records (external-contributor edition)

- Product behavior contracts live in [docs/features/](docs/features/README.md). **External contributors do not create cards**: when a change touches an existing contract, a maintainer names the card in review and asks you to align; for new features the maintainer writes the card.
- Record only lasting architecture, compatibility, persistent-format or process tradeoffs under [docs/decisions/](docs/decisions/README.en.md). Ordinary fixes need PR evidence of reproduction, cause, regression and CI discovery. An implemented decision goes directly into implemented, without a mandatory proposed stage.
- `.cursor/rules/*.mdc` are maintainer-owned; do not edit them in a PR.

## Bilingual docs

- New internal decisions default to one language; existing bilingual records and pairs registered in `scripts/i18n-pairs.manifest.json` remain synchronized (see [docs/i18n/README.en.md](docs/i18n/README.en.md)).
- **English-only is fine**: write an internal single-language record directly in `.md`; maintainers help translate public paired docs. Pending only excuses stale hashes for an existing complete pair, not missing translations or structural disagreement.

## Issues

- Use the templates: Bug / Feature (`.github/ISSUE_TEMPLATE/`). For bugs include version, reproduction steps, logs or screenshots.
- Do not file public issues for security vulnerabilities — see the repository security note or contact the maintainer privately.

## License

MIT. Submitting a change means you agree to license it under this repository's license.

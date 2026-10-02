# Contributing

[中文](CONTRIBUTING.md) | English

Use a work branch and PR. Explain the requested behavior, the changes and relevant validation. The maintainer decides whether to merge. Development CI runs automatically; bump the version and update release notes in the PR when a release is intended. Successful main CI then publishes its installers.

Use relevant existing checks locally. `npm test` covers product behavior; `npm run test:tools` covers tooling. Observe actual UI, installation or data operations when affected. There is no requirement to reproduce the entire CI matrix locally, submit an acceptance certificate or sign a candidate record.

See the [handbook](docs/handbook/README.md), [maintenance guide](docs/maintenance/README.md) and [release operations](docs/handbook/modules/release-process.md). Update changed product facts in their owning place. Ordinary fixes require no new feature card, decision record or translation pairing.

Bug reports should include the version, reproduction and relevant logs. Do not submit credentials or private user data. Contributions use this repository's MIT license.

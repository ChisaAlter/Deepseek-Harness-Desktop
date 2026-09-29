# Decision: Use Node 24 LTS for release builds

Status: implemented

[中文](2026-09-29-node24-release-runtime.md) | English

## Problem

`.nvmrc` has retained 22.22.2 since 2026-08-25. The user requested replacing that constraint with an appropriate version for the current installer. Both desktop and Harness engines support `^22.19.0 || >=24.0.0`, so compatibility does not require Node 22.

## Decision

Update `.nvmrc` to 24.21.0. As of 2026-09-29, the [official Node release index](https://nodejs.org/dist/index.json) and [support schedule](https://github.com/nodejs/Release/blob/main/schedule.json) identify it as the latest Node 24 LTS; Node 26 has not entered LTS. Verify the official Windows x64 archive against that version's SHASUMS256.txt before building and testing. Keep local project tooling in an ignored directory without replacing global Node. CI continues reading the same `.nvmrc`.

Audit: the [clean CI portability fix](../bug-fix/2026-09-28-clean-ci-portability.en.md) partially overlaps; its dependency preparation and test gates remain valid. This changes the desktop build and bundled Harness Node baseline only. Electron's embedded Node and the independently locked Office runtime retain their respective version owners.

## Alternatives considered

- Latest Node 22 patch: still compatible, but further along its maintenance lifecycle, so it is no longer the default build baseline for the new installer.
- Node 26 Current: satisfies engines but has not entered LTS; Node 24 LTS is preferred for release stability.

## Consequences

Local builds, CI, and bundled Node use the same version. Rebuild and rerun desktop tests and packaged startup verification after changing major versions; Node 22 results do not carry over. Future upgrades follow support lifecycle and measured compatibility.

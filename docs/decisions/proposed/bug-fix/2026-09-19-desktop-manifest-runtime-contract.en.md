# Decision: The desktop manifest keeps its full scripts, runtime dependencies, and packaging resource contract

Status: proposed

[中文](2026-09-19-desktop-manifest-runtime-contract.md) | English

## Problem

The current working tree's `package.json` keeps only name, version, engines,
optionalDependencies, and overrides: `scripts`, `devDependencies`, `build`, and
`dependencies` are all gone. The documented `npm start` / `npm test` / `npm run dist`
entry points therefore do not exist, and the packaging configuration (NSIS branding,
extraResources, asarUnpack, electronDist) disappears with them;
`installer-branding.test.js` throws during module load, and the full suite shows 9
failures tied to the lost manifest. At the same time, `scripts/after-pack.js` already
requires packaging and asserting `vendor/dsh-remote`, while HEAD's first vendor filter in
`build.extraResources` does not include `dsh-remote/**`: even restoring the HEAD manifest
leaves the packaged built-in remote workspace missing resources. This kind of loss can
only be caught by a structural gate, because ordinary unit tests cannot provide signal
once the manifest is incomplete.

## Proposal

Rebuild `package.json` from the HEAD manifest: restore the full `scripts`,
`devDependencies`, `dependencies`, and `build` (NSIS, asarUnpack, electronDist,
afterPack, publish, win/mac, installerLanguages, extraMetadata), keep `0.3.2`, engines,
overrides, and the existing dependency versions, and add `dsh-remote/**` to
`build.extraResources[0].filter`. Do not modify `package-lock.json`. Add
`src/main/package-contract.test.js`, which fails loudly when any `scripts` entry,
runtime dependency, or critical `build` field is missing, or when the `dsh-remote/**`
resource filter is absent.

## Alternatives considered

- **Overwrite with `git show HEAD:package.json`** — rejected: HEAD's vendor filter omits
  `dsh-remote/**`, which makes `after-pack`'s `assertDshdRemoteRuntime` fail in a real
  package run, and it leaves no contract test behind.
- **Rewrite a reduced manifest and restore only the scripts documentation references** —
  rejected: asarUnpack, electronDist, afterPack, publish, and the NSIS branding
  configuration would silently go missing, and the packaged artifact and updater
  contracts would drift together.
- **Relax the gate's manifest-field requirements** — rejected: those fields are exactly
  why this incident escaped detection; relaxing them removes the signal.

## Acceptance criteria

`src/main/package-contract.test.js` passes; `installer-branding.test.js` loads and passes
normally; `npm test` shows no manifest-related failures; `after-pack`'s `dsh-remote`
resource assertion holds on the restored configuration; `package-lock.json` is
unchanged.

## Risks

Restoring the whole HEAD manifest reintroduces HEAD's other existing build settings,
including local or unfinished items (for example artifact size and signing policy) that
are out of scope here and need separate evaluation. The contract test only checks field
presence and key values, not that the packaged artifact works in a real environment, so
packaging smoke and installer acceptance items remain.

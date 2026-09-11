# Release Rules
<!-- last-analyzed: 2026-09-11T05:48:40Z -->

## Version Sources
- `package.json` `"version"` (electron-builder artifact names use `${version}`)
- `package-lock.json` root `"version"` and `packages[""].version`
- `.github/release-notes.md` (GitHub Release body via `--notes-file`)
- Tag must be `v${package.json.version}` (`scripts/check-release-version.mjs`)

## Release Trigger
- `.github/workflows/release.yml` is `workflow_dispatch` only; it builds a Windows candidate by default (`include_macos=false`) and never creates a GitHub Release.
- `.github/workflows/publish.yml` is `workflow_dispatch` only; it promotes a successful `release.yml` run after same-SHA tests, artifact SHA256, version, filename, and tag checks.
- Repository policy requires candidate build → production acceptance of that exact Windows artifact SHA → promotion of those same files. Do not push tags manually or use tag pushes as a release trigger.

## Test Gate
- `.github/workflows/test.yml`: `npm test` on Windows and macOS, plus vendored Harness build, skip-compose contract, GUI suites, core regression suites, keyless malformed-tool recovery replay, client catalog, and notices on Windows
- Client catalog and third-party notice checks now run in separate steps so PowerShell cannot mask a preceding failure with a later success.
- `.github/workflows/release.yml`: Windows `dist` followed by blocking packaged smoke (up to two attempts); macOS is optional
- `.github/workflows/publish.yml`: requires a successful `Desktop tests` run for the exact candidate SHA and never rebuilds
- Production table: CI Windows Setup SHA, not local `dist/` (`docs/qa/production-acceptance-test-cases.md`)
- Compliant order is dispatch → test the downloaded artifact → publish the same files

## Registry / Distribution
- GitHub Releases only (no npm publish)
- Assets: `Deepseek-Harness-Desktop-Setup-*.exe` (+ `.blockmap`), optional `Deepseek-Harness-Desktop-*-mac-arm64.dmg`, and generated `SHA512SUMS.txt`

## Release Notes Strategy
- Hand-written `.github/release-notes.md` and `.github/release-notes.en.md`; promotion combines both in the public body, then appends candidate provenance.
- Both notes, root READMEs, and the release record must describe the same fixed Windows artifacts.

## 0.2.9 Publication Record
- Published as stable Latest on 2026-09-06, release ID `383486645`, source `583b6fa92d93df2ee56363e96e2891b356af75b9`.
- Same-SHA tests and Windows build passed; uploaded Setup, blockmap, and SHA512SUMS were verified before and after promotion.
- The owner explicitly instructed publication after being told the installed-package P0 sign-off was missing. This is a release-specific override, not a general policy change or an assertion that untested cases passed. See `docs/qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md`.

## CI Workflow Files
- `.github/workflows/test.yml`
- `.github/workflows/release.yml`
- `.github/workflows/publish.yml`

## First-Time Setup Gaps
- none

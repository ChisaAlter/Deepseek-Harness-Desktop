# Release Rules
<!-- last-analyzed: 2026-09-06T07:27:01Z -->

## Version Sources
- `package.json` `"version"` (electron-builder artifact names use `${version}`)
- `package-lock.json` root `"version"` and `packages[""].version`
- `.github/release-notes.md` (GitHub Release body via `--notes-file`)
- Tag must be `v${package.json.version}` (`scripts/check-release-version.mjs`)

## Release Trigger
- Push tag `v*` → `.github/workflows/release.yml` builds Windows NSIS and follows the historical automatic publication path; it can also schedule the existing macOS job, so it is not the promotion path for the Windows-only 0.2.9 release.
- `workflow_dispatch` defaults `include_macos=false`, builds the Windows candidate only, and does **not** publish a GitHub Release. macOS is scheduled only when explicitly requested.
- Publishing an existing draft can automatically create the tag and emit a tag-push workflow run. This occurred for 0.2.9 (duplicate run `34018917540`); cancel that duplicate and verify the promoted assets are unchanged. Do not assume API publication avoids the push trigger.
- Repository policy requires `workflow_dispatch` first, production acceptance on that exact Windows artifact SHA, then publishing those same files; directly pushing a tag publishes too early for that manual gate

## Test Gate
- `.github/workflows/test.yml`: `npm test` on Windows and macOS, plus vendored Harness build, skip-compose contract, GUI suites, core regression suites, keyless malformed-tool recovery replay, client catalog, and notices on Windows
- Client catalog and third-party notice checks now run in separate steps so PowerShell cannot mask a preceding failure with a later success.
- `.github/workflows/release.yml`: Windows `dist` followed by blocking packaged smoke (up to two attempts); macOS is best-effort
- Release job requires a successful `Desktop tests` run for the exact tagged commit
- Production table: CI Windows Setup SHA, not local `dist/` (`docs/qa/production-acceptance-test-cases.md`)
- Compliant order is dispatch → test the downloaded artifact → publish the same files

## Registry / Distribution
- GitHub Releases only (no npm publish)
- Assets: `Deepseek-Harness-Desktop-Setup-*.exe` (+ `.blockmap`), optional `Deepseek-Harness-Desktop-*-mac-arm64.dmg`, and generated `SHA512SUMS.txt`

## Release Notes Strategy
- Hand-written `.github/release-notes.md`; CI attaches it as the release body
- The 0.2.9 manual promotion combines `.github/release-notes.md` and `.github/release-notes.en.md` in the public body; both root READMEs and the release record describe the same fixed Windows artifacts.

## 0.2.9 Publication Record
- Published as stable Latest on 2026-09-06, release ID `383486645`, source `583b6fa92d93df2ee56363e96e2891b356af75b9`.
- Same-SHA tests and Windows build passed; uploaded Setup, blockmap, and SHA512SUMS were verified before and after promotion.
- The owner explicitly instructed publication after being told the installed-package P0 sign-off was missing. This is a release-specific override, not a general policy change or an assertion that untested cases passed. See `docs/qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md`.

## CI Workflow Files
- `.github/workflows/release.yml`

## First-Time Setup Gaps
- Tag-triggered publishing cannot pause for the repository's mandatory production acceptance table; use `workflow_dispatch` and manually publish the accepted artifacts, or add an explicit promotion workflow before relying on tag-triggered publication

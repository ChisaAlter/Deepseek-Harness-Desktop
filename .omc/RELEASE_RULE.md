# Release Rules
<!-- last-analyzed: 2026-09-12T00:00:00Z -->

## Version Sources
- `package.json` → `"version"` (single source; installer artifact name + publish tag check derive from it)
- Tag must equal `v<package.json version>` — enforced by `scripts/check-release-version.mjs` (npm script `check:release-version`)

## Release Trigger
Two-manual-stage pipeline, both `workflow_dispatch` on `main`:

1. `.github/workflows/release.yml` ("Build installers") — builds Windows NSIS Setup (+ optional macOS DMG via `include_macos`), runs blocking packaged smoke gate (`npm run smoke:packaged`, 2 attempts), uploads artifacts `DeepSeek-Harness-windows-x64` / `DeepSeek-Harness-macos-arm64`. Does NOT publish.
2. `.github/workflows/publish.yml` ("Promote release candidate") — inputs: `candidate_run_id`, `release_tag` (must match `^v\d+\.\d+\.\d+$`, stable only — no prerelease), `expected_setup_sha256`. Gates:
   - candidate run must be completed/success/workflow_dispatch/from `release.yml`/on `main`
   - tag == package.json version (`check-release-version.mjs`)
   - ≥1 green `test.yml` run for the exact candidate SHA
   - exactly one Setup exe + one blockmap; filename must be `Deepseek-Harness-Desktop-Setup-<version>.exe`; SHA256 must match operator input
   - remote tag must NOT already exist (refuses repoint)
   - then `gh release create <tag> --target <candidate_sha>` with Setup exe + blockmap + optional dmg + `SHA512SUMS.txt`, body = `release-notes.md` + `release-notes.en.md` + provenance, `--latest`

## Test Gate
- `npm test` (`node --test "src/**/*.test.js" "mobile/web/**/*.test.js"`) — runs in `test.yml` job `desktop` (windows+macos matrix) on push to main / PRs
- `test.yml` job `vendor-gui` — vendored harness: skip-compose contract + `test:gui` + vitest core suites + malformed-tool replay + catalog/notices checks
- A green `test.yml` run for the candidate SHA is REQUIRED by publish.yml
- `release.yml` additionally gates on `smoke:packaged` (boots the real win-unpacked tree)

## Registry / Distribution
- GitHub Releases only (Windows Setup `.exe` + `.blockmap` + `SHA512SUMS.txt`; optional macOS dmg). No npm publish (`"private": true`, `publish: null` in build config).
- Repo: `ChisaAlter/Deepseek-Harness-Desktop`

## Release Notes Strategy
- Bilingual committed files: `.github/release-notes.md` (zh, first) + `.github/release-notes.en.md` (en, appended). Title `# Deepseek-Harness-Desktop X.Y.Z`.
- publish.yml concatenates them + auto-appends "Release provenance" (tag / run id / candidate sha / verified Setup SHA256).
- No CHANGELOG.md; commit style is `feature(<card-id>): …` / `fix(<area>): …` / `docs(release): …`.
- A desktop unit test asserts the bilingual notes describe the installed Browser mini-player contract — notes MUST keep the `## 技术契约` / `## Technical contract` section or `npm test` fails (test 737).

## CI Workflow Files
- `.github/workflows/test.yml` — quality gate
- `.github/workflows/release.yml` — candidate builder
- `.github/workflows/publish.yml` — promotion/publish

## Operational notes learned 2026-09-12
- v0.3.0 was published 2026-09-11 then the Release was deleted; remote tag `v0.3.0` → `5cbaafb` still exists and blocks re-promotion of the same tag (publish.yml "Reject an existing tag"). To re-ship v0.3.0 at a new sha: `git push origin :refs/tags/v0.3.0` first, or bump to v0.3.1.
- `nul` file at repo root is a Windows artifact — never commit; it breaks checkouts.
- `tmp/` is local scratch — not for release.

## First-Time Setup Gaps
- none (pipeline complete and exercised through v0.2.9 / pulled v0.3.0)

# Windows 0.2.9 Release

Date: 2026-09-06 (Asia/Shanghai). Published as the stable Latest release at `2026-09-06T07:21:15Z` (15:21:15 Beijing time) under explicit release-owner authorization, using the existing verified Windows artifacts.

## Candidate Identity

| Field | Value |
| --- | --- |
| Source commit | `583b6fa92d93df2ee56363e96e2891b356af75b9` |
| Desktop tests | Run `34015974835`, attempt 2, success |
| Windows build | Run `34015983516`, success; macOS and automatic release jobs skipped |
| Actions artifact | `DeepSeek-Harness-windows-x64`, ID `9984140649` |
| Artifact ZIP SHA256 | `cb6264fcadc7eb391d6390f3a8526201639ecc7a30da46fc6a8289eab8ab99c3` |
| Setup | `Deepseek-Harness-Desktop-Setup-0.2.9.exe`, 562645486 bytes |
| Setup SHA256 | `1eb5bd7c3769e1d09a6e863f8948706359f255a91608f0989e7982d19c380117` |
| Blockmap SHA256 | `25f779e13cead7c6b4b938a069c821b8f22f7171336a7e0e133ce4b2266840c1` |
| GitHub release | ID `383486645`, tag `v0.2.9`, target fixed to the source commit above |
| Setup resource version | ProductVersion and FileVersion `0.2.9`; Authenticode `NotSigned` |

Build: https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/34015983516

Tests: https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/34015974835

Release: https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9

Report-only commits after the source commit do not change the frozen candidate or authorize rebuilding it under the same acceptance identity.

## Verification

- Windows NSIS build and packaged smoke passed. The smoke verified UI, titlebar hit tests, and PTY probes in the CI unpacked application.
- Desktop unit jobs on Windows and macOS passed. The first vendor job had 3673 passing core tests and one 5000 ms timeout in `session-projection-cache/tests/fixtures.spec.ts` for `v5-lineageless-doc.json`. The unchanged fixture passed all six local tests. The failed vendor job was rerun once on the same source commit and passed, including GUI, core, replay, and separate catalog/notice checks. The timeout's root cause was not established or claimed fixed.
- The artifact ZIP was downloaded in ranges, reassembled, and checked against GitHub's exact ZIP digest before extraction. It contained only the expected Setup and blockmap.
- `SHA512SUMS.txt` was generated from the downloaded Setup and blockmap with Node crypto and independently verified with PowerShell. No local rebuild was substituted.
- The release assets contain exactly Setup, blockmap, and `SHA512SUMS.txt`. All three uploaded asset sizes and GitHub SHA256 digests match the local files. No macOS asset or raw QA data was uploaded.
- The full local `doc-sync` run was not green: 12 gates passed and 20 failed before catalog correction. Existing documentation inconsistencies and ignored local declaration artifacts were observed. Named bilingual pairs passed; client catalog freshness was checked from tracked source, and both catalog/notice checks passed in final CI. No full-corpus documentation pass is claimed.

## Section 16: Release Authorization And Acceptance Status

This CI Setup has not been installed for production acceptance in this session. CI packaged smoke is not a substitute for the installed-app P0 table, and no historical candidate Pass is inherited.

- On September 6, 2026, after the assistant explicitly reported that the draft was being held for missing new-package Windows P0 sign-off, the release owner instructed: "发布吧。把版本更新文档，readme中英文，全都更新" (publish it and update the release documentation and both READMEs).
- This is recorded as a release-specific owner override of the remaining publication hold for the exact Setup SHA256 above, not as an assertion that any untested case passed. It does not amend the repository's general acceptance policy.
- Public Release: published, `draft=false`, `prerelease=false`; GitHub `/releases/latest` resolves to `v0.2.9`.
- New installed-package P0 sign-off: still not completed. No case was executed or reclassified by this authorization.
- Web second-client, Android, and macOS exclusions remain as recorded for the Windows-only release.
- Publication promoted the existing verified draft in place. The tag resolves to the original source commit, and all three asset sizes and digests remain unchanged.
- GitHub automatically emitted a tag-push event when publishing the draft. The resulting duplicate build run `34018917540` was cancelled and confirmed completed/cancelled, including both platform jobs and the release job. No duplicate package replaced the published assets.
- GitHub release notes contain Chinese and English. Both root READMEs, the release checklist, build handbook, and feature indexes were synchronized in documentation-only follow-up commits; the artifact source remains pinned above.

The local verified files are under `.tmp/ci-candidate-34015983516/`. The incomplete acceptance record remains incomplete; publication is based on the explicit owner instruction above.

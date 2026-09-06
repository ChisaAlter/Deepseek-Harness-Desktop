# Windows 0.2.9 CI Candidate

Date: 2026-09-06 (Asia/Shanghai)

## Scope

- Windows x64 desktop candidate only.
- The release owner excluded Web second-client acceptance and Android from this release.
- The release owner requested no macOS build or release asset.
- Excluded surfaces are not recorded as Pass.

## Artifact Identity

| Field | Value |
| --- | --- |
| Source commit | `e11fb52a44557967998e45fae1f14292598ca716` |
| Desktop tests | `https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/34003209987` (attempt 2, success) |
| Candidate build | `https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/34003885770` (success) |
| Artifact | `DeepSeek-Harness-windows-x64`, ID `9980569155` |
| Setup | `Deepseek-Harness-Desktop-Setup-0.2.9.exe`, 637,925,131 bytes |
| Setup SHA256 | `01f1f94e9ad3134da4732bd5bf7a93888a4b495adeb9805f0ffcecbd1e681e50` |
| Setup SHA512 | `12c8c4e6a2a71a28d6810ef9a26309e51e3bd6239424ae7f381a065ad6c8ad79394fa26bd8361490179f3c8bff423a95db5b04de2a10880ed18f2caa0aa420aa` |
| Blockmap SHA256 | `a5515715ff9215a4e0b2292f93ebda3f87fb486e750af6f9fc1fd7cb89484811` |
| Checksum file | `SHA512SUMS.txt`, generated from the downloaded CI files and verified with `sha512sum -c` |

Only the Setup, blockmap, and checksum file are approved release assets. Local `dist/`, logs, screenshots, QA data, and any non-Windows artifact are excluded.

## Automated Gates

- Local `npm test`: 1,402 pass, 2 skip, 0 fail.
- Local NSIS build and `smoke:packaged`: success.
- Desktop tests run `34003209987`: success on attempt 2. Attempt 1 had one 5,000 ms fixture timeout after 3,671 core tests passed; the failed job rerun completed successfully.
- Candidate run `34003885770`: Windows build, blocking packaged smoke, and artifact upload all succeeded.
- Release version guard for `v0.2.9`: success.

## Installed Candidate Verification

The downloaded CI Setup was installed over the existing per-user installation with `/S`; installer exit code was `0`. User data under `%APPDATA%\Deepseek-Harness-Desktop` was not deleted or reset.

| Check | Result |
| --- | --- |
| App version | `0.2.9` |
| Bundled Node | `v22.22.2` |
| Electron runtime | Electron `43.4.0`, Node `24.18.1`, modules ABI `148` |
| Native file | `resources/vendor/chisacode-remote/node_modules/better-sqlite3/build/Release/better_sqlite3.node`, SHA256 `123890f7f83d226dbc9cf2aab6d50d140213cb0bbb277e5656ebb799f99bbe18` |
| SQLite probe | In-memory create/insert/select returned `29` under the installed Electron runtime |
| Startup stability | Eight installed-package processes remained alive for 60 seconds |
| Harness | Listening on `127.0.0.1:3080` |
| Remote daemon | Listening on `127.0.0.1:6767` |
| Remote index | `chisacode-home/index/agent-index.sqlite` created and held open by the running daemon |
| Startup blockers | No `MODULE_NOT_FOUND`, `ERR_DLOPEN_FAILED`, missing bindings, daemon start failure, or daemon crash found |
| Desktop start record | `last-desktop-start.json` recorded `ok: true` |
| Authenticode | `NotSigned` |

This closes the previous release blocker where the installed remote daemon could not load `better_sqlite3.node` and disabled its SQLite agent index.

## Release Disposition

The Windows binary is technically ready for promotion from this exact CI artifact: build, packaged smoke, silent overlay installation, application startup, bundled runtime, and the repaired native SQLite path passed.

No tag or GitHub Release was created by this verification. Repository-wide production acceptance is not silently converted to Pass: historical candidate results are not inherited, excluded Web/Android/macOS checks remain excluded, and any remaining P0 sign-off or waiver must be explicit before public publication.

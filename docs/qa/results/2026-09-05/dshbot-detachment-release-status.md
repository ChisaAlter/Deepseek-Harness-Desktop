# dshbot detachment and 0.2.9 candidate status

Date: 2026-09-05
Candidate: `22b3820e1ff45e5009f129f3024a7b64526753cd`
Branch: `codex/release-0.2.9`
PR: https://github.com/ChisaAlter/Deepseek-Harness-Desktop/pull/82

## Implemented

- Removed bundled dshbot source, development installer, forced marketplace recommendation and plugin-specific publishing tools.
- Legacy cleanup removes only desktop-owned mount declarations and links. User plugin packages, settings, presets, memories and sessions are preserved.
- Generic plugin forensics recognizes apply/import loader failures and permits individual disable/re-enable for user-installed dshbot.
- Included vision request/replay integration, tool-call integrity, historical workspace adoption, remote Server defaults and marketplace error classification.
- Unrelated uncommitted composer changes are excluded from the candidate.

## Preservation

Source, including uncommitted plugin work, was copied and hash-verified before removal:

`C:/Users/48818/AppData/Local/Deepseek-Harness-Desktop-backups/dshbot-detach-20260905-110901`

The standalone export is preserved there, not published or validated as a new independent-plugin release.

## Local verification

These results come from the local working tree, not CI installer acceptance:

| Suite | Result |
| --- | --- |
| Final desktop npm test | 1393 passed, 2 skipped, 0 failed |
| Vendor GUI | 411 files; 5337 passed, 1 skipped |
| Core regression | 173 files; 3672 passed, 3 skipped |
| Plugin forensics and CI contracts | 29 passed |
| Independent keyless malformed-tool replay | 1 passed; 82 unrelated cases filtered out |

The initial final focused run exposed an import-loader attribution failure. The generic matcher was fixed and the complete desktop suite rerun successfully; the earlier failure is not counted as a pass.

## CI artifact and installed verification

- Desktop tests run: https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/33942234928
- Build-only dispatch: https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/33942243475
- Desktop tests and both Windows/macOS installer jobs completed successfully for the candidate SHA. The build-only release job was skipped as intended.
- Windows CI packaged smoke passed: UI, titlebar hit tests and PTY echo.
- Downloaded artifact ZIP SHA256 matches GitHub's digest: `be7938f6abbb32a2f0c8ad47d7289e3559716e48b626ca0aca2217ba7bab1466`.
- Installer: `dist/ci-33942243475/package/Deepseek-Harness-Desktop-Setup-0.2.9.exe`.
- Installer SHA256: `24d0755402a62912783b481bc3ed9b6acef61d5ba99a8edd1f43acec9274c8a6`.
- Silent all-users overlay to `C:/软件/Deepseek-Harness-Desktop` completed with exit code 0.
- Installed app.asar version is 0.2.9. Legacy preset cleanup, config, forensics, marketplace catalog and installer sources match the candidate (normalizing checkout line endings).
- First launch replaced the older same-version runtime and successfully entered the real user's main UI. Startup success recorded at `2026-09-05T04:37:06.605Z`.
- Actual installed Remote settings showed LAN unselected and Server selected. Config retained `remoteMode: relay` and `disabledPlugins: [dshbot]`.
- Closed the debug instance normally and started the normal Start Menu shortcut without debugging flags. Second startup succeeded at `2026-09-05T04:39:54.873Z`.

## Data preservation

- Pre-install backup: `C:/Users/48818/AppData/Local/Deepseek-Harness-Desktop-backups/ci-33942243475-before-install/user-data.tar.gz`.
- Archive readability verified. Dependency node_modules directories were excluded because preexisting broken links prevented traversal; original installed dependency files were not deleted by the backup step.
- Immediately after installation, all 302 tracked config/credential/session hashes were unchanged, with no missing files.
- After normal startup, one session appended 81 bytes while preserving the complete original byte prefix. Credentials were re-encrypted; comparison using safeStorage with a copied Local State in an isolated verification directory confirmed the decrypted objects are identical. No plaintext credentials were written or printed.
- All other tracked files remained identical. The configuration and plugin disable choice were preserved.
- The initial status-wait helper timed out due to its date comparison; direct status reads and real installed-page inspection established both successful starts above.

## Pending release gates

- No release tag, merge to main or GitHub Release has been created.
- The complete production acceptance table, including real-model multi-turn and remaining manual P0 workflows, has not been executed for this artifact. Only the installation, startup, preservation and Remote UI checks above are claimed.
- Disk-space blocker resolved by the user before download and installation. No user data was deleted to free space.

This report is not a production-acceptance Pass and does not authorize publication.

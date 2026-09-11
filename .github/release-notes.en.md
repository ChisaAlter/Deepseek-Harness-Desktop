## Deepseek-Harness-Desktop 0.3.0 (English)

Platform: Windows x64; macOS is published only when the same accepted candidate contains that artifact.

Compared with [0.2.9](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9), this release records only the current delta and pins Harness to `dsh-v0.1.5-rc.1` (SHA `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`). Candidate building and promotion are separate; promotion accepts original assets from an accepted candidate run, and tag pushes no longer rebuild them.

### Important upgrade notes

**dshbot is no longer bundled with the desktop.** Its source, development preset, and first-party recommendation have been removed. Older dshbot installations may fail to start because they call APIs removed by the newer Harness. Disable only dshbot in the launcher's plugin recovery tools, then start the desktop. Disabling it does not delete plugin files, bot settings, memories, or sessions. Re-enable it after the independent plugin becomes compatible; do not clear user data.

> [!CAUTION]
> **Migration from a version older than 0.2.7 or from the official CLI does not bring old conversations over automatically.**
>
> Since 0.2.7, the desktop uses its own `dsh-home` and does not read or automatically migrate the official `~/.dsh`. Quit the application completely, including the tray, before migrating.
>
> **Recommended:** open **launcher > Import** on cold start and copy only the selected items into the desktop home. Do not copy `profiles`. Compatible old projection caches can be cold-rebuilt automatically, but the app still does not directly read the official `~/.dsh`.
>
> Existing 0.2.7 desktop-home users can install over their current version. The desktop home stays the same and the app does not switch back to `~/.dsh`.

If the launcher is unavailable, use this Windows PowerShell fallback. Reopen the original workspace path afterwards; directory-free conversations appear in the ungrouped workspace section.

```powershell
$old = "$env:USERPROFILE\.dsh"
$new = "$env:APPDATA\Deepseek-Harness-Desktop\dsh-home"
Copy-Item "$old\sessions\*" "$new\sessions\" -Recurse -Force
if (Test-Path "$old\attachments") {
  Copy-Item "$old\attachments\*" "$new\attachments\" -Recurse -Force
}
```

### Installer

`0.3.0` provides a Windows x64 installer. macOS is published only when the same accepted candidate contains that artifact; promotion never rebuilds it.

| Platform | File |
| --- | --- |
| Windows x64 | `Deepseek-Harness-Desktop-Setup-0.3.0.exe` |

- Checksums: `SHA512SUMS.txt` generated during candidate promotion, covering the Windows Setup and blockmap.
- The installer is not Authenticode-signed. Download from this repository and verify the checksum file.

### Changes

- Pin Harness to `dsh-v0.1.5-rc.1` (SHA `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`); source and installers share the same official baseline.
- Ship the installed-package Browser `dshd mini-player` as a P0 path: reuse the same Browser guest / `previewId` in a renderer overlay constrained to the chat viewport, with title-bar drag and four-edge/four-corner resize; restore preserves URL / history.
- Boundary: the mini-player only moves the guest presentation bounds; it does not create a second BrowserView, external window, or mini-specific IPC. Web / Android remain outside the default Windows candidate acceptance scope.
- Keep launcher/compose recovery and the packaged `dsh-im` / `dsh-usage` desktop modules available so the candidate does not omit recovery or usage entry points.
- Fix post-action preview focus, caption-drag false positives around floating panels, fixed model-menu drag isolation, Python lazy-grammar event synchronization, and the Switch `corner-shape` contract.
- Limit terminal settle-fit resizing to panes with a real used box, avoiding phantom PTY resizes for hidden or not-yet-laid-out panes.
- Preserve strict tool-call id/name validation, malformed-response retry, and historical projection repair; the keyless malformed-call fixture now uses the canonical v3 snapshot without rewriting the append-only session log.
- Separate build from promotion: `release.yml` packages and smokes the installer, while `publish.yml` downloads the original assets from the same accepted run and requires same-SHA tests, Setup SHA256, and filename/version guards before creating a Release. It never rebuilds binaries.

### Not shipped

- dshbot functionality belongs to the independent plugin and is not bundled. Existing user installations remain available to generic plugin management and recovery.
- Web second-client, Android APK, and macOS device acceptance remain outside the default Windows candidate scope.

### Verification and known limits

- The source SHA, workflow run ID, green Desktop tests run, and Setup SHA256 must be recorded before publication; run IDs and asset digests are intentionally not hardcoded here.
- Promotion uses `.github/workflows/publish.yml` and requires the candidate run ID, `v0.3.0`, and the Setup SHA256. It does not rebuild binaries and generates `SHA512SUMS.txt` plus provenance.
- Full installed-package P0 acceptance remains a release prerequisite; untested cases are not Pass, and earlier candidate results are not inherited.
- Web second-client, Android, and macOS device acceptance remain outside the default Windows candidate scope. Repository-wide documentation checks still have existing failures; not all checks are claimed green.

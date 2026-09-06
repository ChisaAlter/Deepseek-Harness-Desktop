## Deepseek-Harness-Desktop 0.2.9 (English)

Release date: September 6, 2026. Platform: Windows x64.

Compared with [0.2.7](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.7), this release upgrades Harness to `0.1.2-rc.1`, repairs vision routing, historical workspace membership, and malformed tool-call handling, and includes built-in Usage Stats, Market, transparent themes, and Server-default remote connections. `0.2.8` was not publicly released.

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

`0.2.9` ships a Windows x64 installer only. There is no new macOS installer in this release.

| Platform | File |
| --- | --- |
| Windows x64 | `Deepseek-Harness-Desktop-Setup-0.2.9.exe` |

- Checksums: `SHA512SUMS.txt` on this release, covering the Windows Setup and blockmap.
- The installer is not Authenticode-signed. Download from this repository and verify the checksum file.

### Changes

**Key fixes**

- Restore consumption of the configured vision model: uploads and images read by tools can be described by the fallback model; later requests reuse recorded descriptions, and cancellation or timeout is not reported as success.
- Restore tool-call identifier validation, malformed-response retries, and historical projection repair while leaving original session logs unchanged.
- Registering or re-adding a workspace adopts subsequently imported history while preserving existing ownership and ordering.
- Startup restores missing active and archived history for still-registered workspaces, preserves original member order and archive state, and does not recreate deleted workspaces.
- Do not misreport Git plugin installation failures as build-approval requests.
- Filter file-search matches before limiting results so matching files are not lost to truncation.
- Back up and cold-rebuild compatible old `session_projcache` records instead of letting them cause a startup crash loop.
- Revalidate `index.html` after rebuilding the Web UI composition instead of serving an old cached page.
- Restore sidebar group-fold animation and complete composer corner lighting and resting-edge layering.

**Harness and conversations**

- Pin Harness to `dsh-v0.1.2-rc.1`; source and installer builds share the official baseline from 0.2.9 onward.
- Reconnect archive and inline message editing to the official workspace/session Remotes.
- Align session statistics and peak/off-peak information with the composer width; cumulative session costs can be enabled in Interface Settings.
- Restore titlebar branch switching and push/pull for registered workspaces using the 0.1.2 workspace unary API.

**Settings and appearance**

- Use official capsule-and-menu value selectors for models, MCP, Skills, General, Interface, and pricing controls.
- Add transparent themes: with a wallpaper, surfaces use 0% fill; frost below 20% is raised to 20% once.
- Support grouped multi-selection in Skills.
- Make Usage Stats and Market built-in desktop modules. Market Discover is paginated; retired plugin families, including renamed variants, are rejected.
- Use compact square entries for workspace and empty-state pickers.

**Startup and recovery**

- Keep plugin-level startup recovery in the launcher's Recovery Board.
- Conversation tabs follow the Show session tabs preference; AppFrame no longer exposes the cozy Session log tab.

**Not shipped**

- dshbot functionality belongs to the independent plugin and is not bundled. Existing user installations remain available to generic plugin management and recovery.

**Remote connections**

- Rename Away to Server and default to Server when unconfigured; LAN remains manually selectable.
- The default mode does not enable pairing automatically. Saved modes and relay addresses are preserved.
- Send only catalog-required metadata while retaining all sessions; fetch model, permission, and plan details when opening a session to reduce weak-network catalog timeouts.
- Restore retry after first-connect failure, use saved credentials for reconnect after pairing, and allow new pairing links to cancel unfinished older connections.
- Adapt built-in messaging channels to newer Harness authentication, event, and approval APIs, including Windows Feishu SDK build compatibility.
- Trim the remote runtime, standardize DSHD naming, and provide SQLite native bindings compatible with Electron.
- Update Android connection and foreground/background recovery code. No Android APK is shipped, and Android device acceptance remains incomplete.

### Verification and known limits

- Fixed source: `583b6fa92d93df2ee56363e96e2891b356af75b9`. [Desktop tests](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/34015974835) and the [Windows build and packaged smoke](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/34015983516) passed.
- These are the same original CI artifacts. Setup SHA256: `1eb5bd7c3769e1d09a6e863f8948706359f255a91608f0989e7982d19c380117`.
- The maintainer explicitly authorized publication after being informed of the acceptance gap. Full installed-package P0 acceptance remains incomplete; untested cases are not Pass, and earlier candidate results are not inherited.
- Web second-client, Android, and macOS device acceptance are outside this release's approval scope. Repository-wide documentation checks still have existing failures; not all checks are claimed green.

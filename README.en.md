# Deepseek-Harness-Desktop

Community desktop client that wraps the official DeepSeek Harness Web UI — download, install, and run without starting `dsh web` yourself.

[中文](README.md) · English · [Download](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

## Install

Grab a build from [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest). No local Node required. The current release is **[0.2.9](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9)**, released on **September 6, 2026**, for Windows x64 only. `0.2.8` was not publicly released.

| | |
| --- | --- |
| Windows x64 | [Deepseek-Harness-Desktop-Setup-0.2.9.exe](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/download/v0.2.9/Deepseek-Harness-Desktop-Setup-0.2.9.exe) |
| macOS, Linux, Android | No installer in this release; desktop source requirements are [below](#run-from-source) |

The Windows installer is not Authenticode-signed. Download from this repository and verify it against [SHA512SUMS.txt](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/download/v0.2.9/SHA512SUMS.txt). Older macOS binaries remain in historical releases and do not include the 0.2.9 fixes.

After install, the launcher opens first and usually starts the desktop. If the desktop has no sessions yet and `~/.dsh` already has data, it stops on Import. Then pick a workspace and add an API key in Settings.

## What's new in 0.2.9

- **Harness `0.1.2-rc.1`**: source and installers share the official baseline, restoring archive, inline message editing, and workspace integrations.
- **History and startup recovery**: startup restores missing active and archived history for registered directories while preserving previous member order and archive state. Compatible old projection caches are backed up and cold-rebuilt.
- **Vision and tool calls**: repair fallback request handling and description reuse, malformed tool-call validation, retries, and old-history projection recovery.
- **Built-in settings modules**: Usage Stats and Market ship with the desktop, alongside transparent themes, cumulative session costs, and consistent settings controls.
- **Files and UI**: fix truncated file-search results, stale Web UI page caching, sidebar fold animation, and composer edge lighting.
- **Remote connections**: Server is the default when unconfigured, with LAN selectable manually; pairing retry, reconnection, catalog synchronization, and remote SQLite runtime compatibility are repaired.
- **Standalone dshbot**: no longer bundled or recommended by the desktop. Existing user installations and data remain managed through ordinary plugin disable/recovery controls.

Full notes: [Release Notes](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9) ([English source](.github/release-notes.en.md) / [中文](.github/release-notes.md)). CI and packaged smoke passed. This release proceeds under explicit maintainer authorization; full installed-package P0 acceptance remains incomplete, and untested cases are not marked Pass. See the [release record](docs/qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md).

## Upgrade notes

**Older dshbot versions may be incompatible with the new Harness.** If dshbot blocks startup, disable only that plugin in the launcher's recovery tools. Do not delete plugin files, bot settings, memories, or sessions.

> [!CAUTION]
> **Migration from the official CLI or a version older than 0.2.7 does not import old chats automatically.** Quit completely, including the tray, then use **launcher → Import**. Do not copy `profiles` or overwrite desktop data with an older SQLite session store.
>
> Users already on the 0.2.7 desktop `dsh-home` can install 0.2.9 over it while retaining desktop data. After import, reopen the original workspace path; directory-free sessions appear under the ungrouped workspace section.

Windows PowerShell fallback if the launcher is unavailable:

```powershell
$old = "$env:USERPROFILE\.dsh"
$new = "$env:APPDATA\Deepseek-Harness-Desktop\dsh-home"
Copy-Item "$old\sessions\*" "$new\sessions\" -Recurse -Force
if (Test-Path "$old\attachments") {
  Copy-Item "$old\attachments\*" "$new\attachments\" -Recurse -Force
}
```

For source runs on macOS, copy `$HOME/.dsh/sessions` to `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home/sessions` (same for `attachments`), then reopen the **original workspace path**. This release has no macOS installer.

Windows users still seeing `Unable to load libghostty-vt (404)`, or running 0.2.4 / 0.2.5, should install 0.2.9.

## Features

- **Official UI** — chat, tool calls, and approvals are `dsh web`. There is no custom chat page.
- **Launcher** — cold start opens the launcher (update prompt, import, versions, plugin forensics); tray can reopen it anytime.
- **Git** — switch branches, commit, push, and open a pull request from the title bar.
- **Remote**: enable it manually and scan to connect to the same session. Server is the default when unconfigured; LAN remains a manual choice. Mobile Web and Android are outside this release's device-acceptance scope, and no APK is shipped.
- **Files and terminal** — `Ctrl+\` opens the right column (Files / Diff / Browser / Agents); `` Ctrl+` `` opens the bottom terminal. A selection can join chat.
- **Models** — thinking intensity for third-party models, vision fallback; the latest user message can be edited and resent.
- **Appearance**: light, dark, and transparent themes. Pick a wallpaper or Browse the gallery (categories, search, favorites; confirm crops to the window). Frost and pixelate stay on Appearance.
- **Extensions** — MCP, Skills, and plugins in Settings. The marketplace is a desktop-owned settings section (built-in curated catalog and install engine, product shape derived from [dsh-market](https://github.com/dsh-market/dsh-market) but detached from that upstream). There is no standalone marketplace window.
- **Usage Stats**: built-in cross-session token statistics, heatmaps, and export in Settings; no separate statistics plugin is required.
- **Desktop shell** — minimize to tray, auto-update; if Harness dies, the window returns to a failure page and restarts. If a user plugin blocks startup, the launcher can disable that package or skip user plugins.

`Ctrl+,` opens Settings.

<table>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-surfaces.jpg" alt="Chat and right column" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-wallpaper.jpg" alt="Wallpaper" /></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-themes.jpg" alt="Appearance themes" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-appearance.jpg" alt="Appearance settings" /></td>
  </tr>
</table>

## Data directory

The desktop Harness **does not read** the official CLI `~/.dsh`. Sessions, settings, and marketplace plugins live in `dsh-home` under the app data directory:

| | |
| --- | --- |
| Windows | `%APPDATA%\Deepseek-Harness-Desktop\dsh-home` |
| macOS | `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home` |
| Plugins | `dsh-home/profiles/web` |

Workspace path and the shell API key stay in `config.json` / `credentials.json` one level up. Official `dsh` typed in the bottom terminal still uses `~/.dsh`.

## Run from source

Windows 10+ or macOS 14+ (Apple Silicon), Node 22.19+ / 24+, pnpm 11.

```powershell
git clone https://github.com/ChisaAlter/Deepseek-Harness-Desktop.git
cd Deepseek-Harness-Desktop
npm install
npm run setup:harness
npm start
```

The first `setup:harness` builds the vendored `vendor/deepseek-harness` — slow. Quit the installed app before a source launch; they share a single-instance lock.

## Development

Edit the UI in `vendor/deepseek-harness`. Follow the [design language](docs/design-language.en.md) and [motion](docs/motion.en.md). Product handbook: [docs/handbook](docs/handbook/README.md); behavior contracts: [Feature Spine](docs/features/README.md). After changing client sources, run `pnpm run build:official` there and restart the desktop app (same command as an official `dsh web` release; do not run `build:lib:client` alone or the sidebar falls back to “DSH Local Build”).

The current official baseline is `vendor/harness-upstream.json`: `0.1.2-rc.1` (`dsh-v0.1.2-rc.1` / `a66e4702047846cdaa10c66c9d3df3951f5ea70d`). The npx fallback is official `@deepseek-ai/dsh@0.1.2-rc.1` (published to npm) and does not include the titlebar, Git, surfaces column, or terminal drawer; those ship only on the source and packaged paths. Packaged 0.2.9 aligns with the source pin (`0.1.2-rc.1`); earlier released installers (≤0.2.7) were pinned to `0.1.1-rc.1`.

```powershell
npm test              # desktop unit tests
npm run sync:harness -- --ref dsh-v0.1.2-rc.1 --sha a66e4702047846cdaa10c66c9d3df3951f5ea70d
npm run dist          # Windows installer
npm run dist:mac      # macOS installer (must run on macOS)
```

Use `workflow_dispatch` to build a candidate first; Windows-only is the default. Require Desktop tests for the same source SHA and packaged smoke, then complete [production acceptance and any necessary written waivers](docs/qa/production-acceptance-test-cases.md) under repository policy before promoting the same files. Do not push a `v*` tag as a substitute: the existing tag-push workflow rebuilds and automatically publishes, and may build macOS. A local `npm run dist` is not an installed-app acceptance Pass. The release-specific maintainer authorization for 0.2.9, fixed source SHA, CI runs, and file digests are in the [release record](docs/qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md). That one-time authorization does not change the general acceptance gate or turn untested cases into Pass.

Publishing a draft can create its tag and trigger the same tag-push workflow. When promoting fixed artifacts, check for and cancel the duplicate build, then verify that the public release assets are unchanged. This was completed for 0.2.9.

## Community

<p align="center">
  <img src="assets/wechat-group.png" alt="WeChat group QR code" width="240" />
</p>

WeChat group (Chinese). Invite codes expire about once a week; open an [Issue](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) if the code does not scan. Issues and PRs are welcome. Thanks to [Linux.do](https://linux.do).

## License

[MIT](LICENSE)

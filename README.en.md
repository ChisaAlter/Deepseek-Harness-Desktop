# Deepseek-Harness-Desktop

Community desktop client that wraps the official DeepSeek Harness Web UI — download, install, and run without starting `dsh web` yourself.

[中文](README.md) · English · [Download](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

## Install

Grab a build from [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest). No local Node required. Current release is **[0.2.7](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.7)**.

| | |
| --- | --- |
| Windows x64 | `Deepseek-Harness-Desktop-Setup-0.2.7.exe` |
| macOS Apple Silicon | `Deepseek-Harness-Desktop-0.2.7-mac-arm64.dmg` |
| Intel Mac, Linux | [Run from source](#run-from-source) |

The macOS build is unsigned: right-click → Open, or run `xattr -cr /Applications/Deepseek-Harness-Desktop.app`. Checksums are in `SHA512SUMS.txt` on the release page.

After install, the launcher opens first and usually starts the desktop. If the desktop has no sessions yet and `~/.dsh` already has data, it stops on Import. Then pick a workspace and add an API key in Settings.

## What's new in 0.2.7

- **Cold-start launcher** — opens before the desktop: update check, official-home import, versions, plugin Recovery Board; “Stop desktop” keeps the app running.
- **Separate home** — sessions, settings, and marketplace plugins live in `dsh-home` under app data. The app does not read, migrate, or change the official CLI `~/.dsh`.
- **Harness `0.1.1-rc.1`** — installer pins official `dsh-v0.1.1-rc.1`.
- **Terminal assets** — Ghostty wasm and fonts ship in the installer; a source launch with missing assets refuses to start.
- **Vision / gateway** — custom gateways are not written into official `DEEPSEEK_*`; vision fallback uses the official route when the main model cannot see images.

Full notes: [Release Notes](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.7).

> [!CAUTION]
> **Old chats are not imported automatically.** Quit completely (including the tray). Prefer **launcher → Import**. Do not copy `profiles`. Do not force-open an older rc SQLite session store.

Windows PowerShell fallback if the launcher is unavailable:

```powershell
$old = "$env:USERPROFILE\.dsh"
$new = "$env:APPDATA\Deepseek-Harness-Desktop\dsh-home"
Copy-Item "$old\sessions\*" "$new\sessions\" -Recurse -Force
if (Test-Path "$old\attachments") {
  Copy-Item "$old\attachments\*" "$new\attachments\" -Recurse -Force
}
```

On macOS copy `$HOME/.dsh/sessions` to `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home/sessions` (same for `attachments`). Then reopen the **original workspace path**.

If the terminal still shows `Unable to load libghostty-vt (404)`, or you installed 0.2.4 / 0.2.5, install 0.2.7.

## Features

- **Official UI** — chat, tool calls, and approvals are `dsh web`. There is no custom chat page.
- **Launcher** — cold start opens the launcher (update prompt, import, versions, plugin forensics); tray can reopen it anytime.
- **Git** — switch branches, commit, push, and open a pull request from the title bar.
- **Remote** — open Remote at the bottom of the sidebar and scan the QR with a phone browser to join the same session (off by default).
- **Files and terminal** — `Ctrl+\` opens the right column (Files / Diff / Browser / Agents); `` Ctrl+` `` opens the bottom terminal. A selection can join chat.
- **Models** — thinking intensity for third-party models, vision fallback; the latest user message can be edited and resent.
- **Appearance** — light / dark themes. Pick a wallpaper or Browse the gallery (categories, search, favorites; confirm crops to the window). Frost and pixelate stay on Appearance.
- **Extensions** — MCP, Skills, and plugins in Settings. The marketplace is a desktop-owned settings section (built-in curated catalog and install engine, product shape derived from [dsh-market](https://github.com/dsh-market/dsh-market) but detached from that upstream). There is no standalone marketplace window.
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

The current official baseline is `vendor/harness-upstream.json`: `0.1.2-alpha.2` (`dsh-v0.1.2-alpha.2` / `0a53fb55bea101816fa226bb964ae2bed71c343b`). The npx fallback is official `@deepseek-ai/dsh@0.1.2-alpha.2` and does not include the titlebar, Git, surfaces column, or terminal drawer; those ship only on the source and packaged paths. Packaged 0.2.7 is still pinned to `0.1.1-rc.1`, which is not the source pin.

```powershell
npm test              # desktop unit tests
npm run sync:harness -- --ref dsh-v0.1.2-alpha.2 --sha 0a53fb55bea101816fa226bb964ae2bed71c343b
npm run dist          # Windows installer
npm run dist:mac      # macOS installer (must run on macOS)
```

Push a `v*` tag that matches `package.json`; GitHub Actions builds the Windows and macOS installers. Before publishing, walk the [production acceptance table](docs/qa/production-acceptance-test-cases.md) on the **CI windows artifact** (same SHA as the Setup you will upload). A local `npm run dist` must not count as Pass on that table.

## Community

<p align="center">
  <img src="assets/wechat-group.png" alt="WeChat group QR code" width="240" />
</p>

WeChat group (Chinese). Invite codes expire about once a week; open an [Issue](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) if the code does not scan. Issues and PRs are welcome. Thanks to [Linux.do](https://linux.do).

## License

[MIT](LICENSE)

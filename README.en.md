<p align="center">
  <img src="assets/icon.png" width="88" alt="Deepseek-Harness-Desktop" />
</p>

<h1 align="center">Deepseek-Harness-Desktop</h1>

<p align="center">
  An open-source desktop client for DeepSeek Harness<br />
  Chat with AI, explore projects, run commands, and manage Git in one window.
</p>

<p align="center">
  <a href="README.md">中文</a> · English
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest">Download</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases">Changelog</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest"><img src="https://img.shields.io/github/v/release/ChisaAlter/Deepseek-Harness-Desktop" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChisaAlter/Deepseek-Harness-Desktop" alt="License" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0A66C2" alt="Windows x64" />
</p>

<p align="center">
  <img src="assets/screenshot-home.jpg" alt="Deepseek-Harness-Desktop main window" width="920" />
</p>

This is an independently maintained Electron desktop shell, not an official DeepSeek client. It brings the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI, tool calls, and plugin system to the local desktop, with a launcher, workspaces, window and tray integration, and updates. Installed builds do not require a separate Node.js installation or a manual `dsh web` setup.

## Features

- **AI conversations**: Organize workspaces and chat history, inspect tool calls, approve actions, and edit and resend messages.
- **Project tools**: Search and edit files, inspect diffs, preview web pages, and add file or terminal selections to a conversation. Browser previews can move into a chat-area mini-player.
- **Terminal and Git**: Run commands, switch branches, commit changes, push code, and open pull requests without leaving the app.
- **Models and extensions**: Configure model providers, manage MCP servers, skills, and plugins, and install extensions from the built-in marketplace.
- **Usage statistics**: View token usage across sessions, activity heatmaps, and session costs, with data export support.
- **Appearance**: Light, dark, and transparent themes, a wallpaper gallery, and frosted-glass and pixelation effects.
- **Remote access**: Enable remote connections when needed and scan a QR code to access desktop sessions from a mobile browser. Remote listening is off by default.
- **Desktop integration**: System tray support, app updates, and a launcher for data import and plugin troubleshooting.

## How It Works

- **Local-first**: Sessions, settings, and plugin configuration live in a desktop-specific `dsh-home`, separate from the official CLI's `~/.dsh`.
- **One workspace flow**: Conversations, files, Browser, diffs, terminal, and Git share the active workspace. File references and terminal selections can return directly to the Composer.
- **Extensible runtime**: Model providers, MCP, skills, and plugins use DeepSeek Harness's plugin architecture. Desktop-owned features are attached through controlled desktop plugins.
- **Desktop safety boundary**: High-impact tool actions follow Harness approval and permission policies. Remote access requires an explicit opt-in.

<table>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-surfaces.jpg" alt="Chat, files, and code diffs" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-wallpaper.jpg" alt="Custom wallpaper" /></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="assets/screenshot-themes.jpg" alt="Appearance themes" /></td>
    <td align="center" width="50%"><img src="assets/screenshot-appearance.jpg" alt="Appearance settings" /></td>
  </tr>
</table>

## Download and Install

| Platform | Download |
| --- | --- |
| Windows 10 or later · x64 | [Download latest public release](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/latest) |

Public distribution currently focuses on a Windows x64 installer. Other platforms can run or build from source as described below. See [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) for versions and release notes.

> [!NOTE]
> The Windows installer is not digitally signed, so Windows may display a security warning. Download only from this repository. The release page provides `SHA512SUMS.txt` for integrity checks.

### Getting Started

1. Install and open the app. Wait for the launcher to open the main window.
2. Configure your model provider and API key in Settings.
3. Select a project directory as your workspace, or start a conversation without a workspace.

If you have used the official CLI, choose the data you want to migrate on the launcher's Import page.

## FAQ

### Do I need my own API key?

You need to configure an API key for your chosen model provider. This project does not include model credits; usage is billed by the provider.

### How do I upgrade?

The app checks for updates at startup. You can also download a newer installer and install it over the existing version. Desktop installations normally keep their data during upgrades. Back up your data directory before upgrading.

To migrate from the official CLI or an older desktop installation, use Import in the launcher. Do not overwrite databases or copy the entire `profiles` directory. After importing, add the original workspace path again to find its conversations.

### Where is my data stored?

The desktop app uses a separate data directory and does not directly read the official CLI's `~/.dsh`. Open it from Settings > About > Open runtime directory.

| Platform | Sessions and settings directory |
| --- | --- |
| Windows | `%APPDATA%\Deepseek-Harness-Desktop\dsh-home` |
| macOS (source builds) | `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home` |

### What if a plugin prevents startup?

Disable the affected plugin in the launcher's troubleshooting tools, then restart. Older dshbot versions may be incompatible with the newer Harness and can be disabled individually the same way, without deleting settings or conversations.

## Run from Source

Requirements: Windows 10+ or macOS 14+ (Apple Silicon), Node.js 22.x starting at 22.19 or version 24+, and pnpm 11.

```shell
git clone https://github.com/ChisaAlter/Deepseek-Harness-Desktop.git
cd Deepseek-Harness-Desktop
npm install
npm run setup:harness
npm start
```

The initial setup builds the vendored Harness and may take a while. Source and installed builds share a single-instance lock, so quit the installed app, including its tray process, before starting a source build.

```shell
npm test          # Desktop unit tests
npm run dist      # Build the Windows installer
npm run dist:mac  # Build the macOS installer; requires macOS
```

## Documentation

- [Product and architecture handbook](docs/handbook/README.md) (Chinese)
- [Design guidelines](docs/design-language.en.md) · [Motion guidelines](docs/motion.en.md)
- [Feature contracts](docs/features/README.md) (Chinese)
- [Build and release guide](docs/handbook/modules/build-release.md) (Chinese)

## Contributing

Issues and pull requests are welcome, whether for features, bug fixes, or documentation. When reporting a problem, include the app version, operating system, reproduction steps, and relevant screenshots. Remove API keys and other sensitive information from logs before sharing them.

## Community

<p align="center">
  <img src="assets/wechat-group.png" alt="WeChat community QR code" width="240" />
</p>

Scan to join the Chinese-language WeChat group. If the QR code has expired, contact the maintainer through an [Issue](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues).

## Acknowledgments

Thanks to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for the foundation and to the [Linux.do](https://linux.do) community for its support.

## License

[MIT](LICENSE)

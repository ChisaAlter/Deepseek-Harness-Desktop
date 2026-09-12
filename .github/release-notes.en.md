# Deepseek-Harness-Desktop 0.3.1

DeepSeek Harness on the Windows desktop: conversations, files, web previews, terminal work, and Git in one local application.

## What's new

- **Browser mini-player**: Move a web preview into an overlay inside the chat area, resize it from any edge or corner, and restore it without losing the current page or history.
- **Workspace flow**: Files, Browser, Diff, terminal, and Git work around the active workspace. Files and terminal selections can be sent directly to the conversation.
- **Launcher and recovery**: Improve cold start, plugin troubleshooting, data import, and update flows while keeping the built-in usage, messaging, and marketplace entry points available.
- **Models and extensions**: Manage model providers, MCP, skills, and plugins from Settings, and browse or install extensions from the built-in marketplace.
- **Runtime reliability**: Fix tool-call validation, malformed-response retries, session projection recovery, terminal layout, and several desktop interaction edge cases.
- **Installer reliability**: Preserve dependency runtime files during Windows packaging so the installed app can load the complete Harness runtime.
- **Harness baseline**: The desktop client and installer use the same pinned DeepSeek Harness baseline.

## Technical contract

- The installed-package Browser P0 path ships `dshd mini-player`: it reuses the same Browser guest / `previewId`, mounts as a renderer overlay inside the chat viewport, and preserves the current URL and history on restore.
- The mini-player only moves the guest's presentation bounds; it does not create a second BrowserView, external window, or mini-specific IPC.

## Install and upgrade

The public installer targets Windows 10 or later on x64. Download it from [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) and verify the files with the accompanying `SHA512SUMS.txt`. The installer is not Authenticode-signed, so Windows may show a security warning.

Existing desktop installations can be upgraded in place. To migrate from the official CLI or another older environment, use Import in the launcher instead of copying the entire `profiles` directory. dshbot is back as a desktop built-in and ships in the installer: the Bots tab appears by default, the old preset's managed mount is migrated on first start, and bot settings, memories, room presets, and sessions are preserved.

## Platform scope

This publication contains a Windows x64 installer. macOS, Android, and the Web second client are not included in this Windows asset set. Remote access requires an explicit pairing opt-in.

## Verification scope

The Windows candidate passed same-commit desktop tests, installer packaging, and packaged smoke, and the promotion step independently rechecked the candidate Setup SHA256. Full manual acceptance of every installed-app path was not completed; paths not exercised are not claimed as verified here.

## Feedback

Report problems through [Issues](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) with your OS, reproduction steps, and relevant logs. Remove API keys and other sensitive data before sharing logs.

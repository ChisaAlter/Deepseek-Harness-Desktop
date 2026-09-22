# Deepseek-Harness-Desktop 0.3.2

[中文](release-notes.md) | English

DeepSeek Harness on the Windows desktop: conversations, files, web previews, terminal work, and Git in one local application.

## What's new

- **Terminal opacity**: A dedicated Appearance slider (40–100, default 75) lets the terminal well show the wallpaper or ambient gradient at its own solidity instead of following the glass slider. Below the default, Settings shows a TUI-selection readability hint rather than clamping. Trajectory and similar tabs also switched to a transparent canvas so the backdrop reaches them.
- **Button sheen toggle**: A new Appearance switch (按钮悬停光泽 / Button sheen, off by default) keeps each button's plain hover fill; turning it on restores the metallic sheen.
- **Pinned pet notifications**: Important messages pushed through whale_notify now pin to the desktop pet bubble with a close button and stay until dismissed; new bubbles queue behind the pin instead of replacing it. Successful "看看" (take a look) results stay on screen the same way.
- **Periodic-stutter fix**: The desktop pet's growth-token scan of session logs moved off the main process onto a worker thread. The 60-second rescan used to freeze every window and IPC for seconds on large session corpora; it now costs a background thread only.
- **Differential updates**: Launcher upgrades now ride electron-updater's NSIS blockmap channel — unchanged chunks are reused locally and only changed blocks travel over HTTP Range, instead of re-pulling the ~636 MB Setup every release. Any updater failure falls back to the verified whole-file download.
- **New brand mark**: The app icon, window/taskbar, tray, and installer marks now share the whale-girl's head portrait on a white rounded tile, replacing the black-tile whale glyph; the boot page loader is now her spinning animation (a static head shows under reduced motion).
- **Harness baseline dsh-v0.1.6-alpha.2**: The desktop client and installer moved to the same new pinned baseline. Official DeepSeek endpoints now resolve to the Messages protocol root `https://api.deepseek.com/anthropic`; third-party gateway addresses are unaffected.
- **New Session no longer takes over old identities**: New Session reuses only blank drafts with no history at all — sessions once managed by a plugin, containing messages, or pinned by a user title keep their identity, stay explicitly openable, and are never repurposed as fresh drafts.

## Technical contract

- The installed-package Browser P0 path ships `dshd mini-player`: it reuses the same Browser guest / `previewId`, mounts as a renderer overlay inside the chat viewport, and preserves the current URL and history on restore.
- The mini-player only moves the guest's presentation bounds; it does not create a second BrowserView, external window, or mini-specific IPC.
- The LAN pairing landing page (`:3180` static host) gains defense-in-depth headers nosniff / no-referrer / DENY; CSP is deliberately omitted — a same-origin `connect-src` would break the cross-origin relay WebSocket pairing needs.

## Install and upgrade

The public installer targets Windows 10 or later on x64. Download it from [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) and verify the files with the accompanying `SHA512SUMS.txt`. The installer is not Authenticode-signed, so Windows may show a security warning.

Existing desktop installations can be upgraded in place. To migrate from the official CLI or another older environment, use Import in the launcher instead of copying the entire `profiles` directory. dshbot is back as a desktop built-in and ships in the installer: the Bots tab appears by default, the old preset's managed mount is migrated on first start, and bot settings, memories, room presets, and sessions are preserved.

## Platform scope

This publication contains a Windows x64 installer. macOS, Android, and the Web second client are not included in this Windows asset set. Remote access requires an explicit pairing opt-in.

## Verification scope

The Windows candidate passed same-commit desktop tests, installer packaging, and packaged smoke, and the promotion step independently rechecked the candidate Setup SHA256. Full manual acceptance of every installed-app path was not completed; paths not exercised are not claimed as verified here.

## Feedback

Report problems through [Issues](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) with your OS, reproduction steps, and relevant logs. Remove API keys and other sensitive data before sharing logs.

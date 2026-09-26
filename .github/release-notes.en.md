# Whale Isle 0.3.3

[中文](release-notes.md) | English

## What's new

- **Remote workspaces**: Manage SSH machines, choose remote directories, and use mirrored workspaces in desktop sessions.
- **Session costs**: Usage Statistics now shows costs by model, includes a price-period editor, and has a more compact activity calendar.
- **One resident whale conversation**: The main window, desktop quick chat, and enabled IM channels share one persistent conversation. Settings separate chat and capabilities from desktop appearance and behavior; quick chat uses a floating model and reasoning picker.
- **File and browser work loops**: File references and deliverables in chat open the relevant surface. HTML, HTM, XHTML, and PDF deliverables first open in the chat mini preview, then move to the right Browser panel on request while retaining the same page and history.
- **Account sign-in**: The system browser opens automatically when a desktop account authorization link becomes available; the dialog still offers a copyable link.
- **Interface fixes**: The Jobs popover avoids clipping under the conversation header. The browser mini preview has slimmer chrome and improved dragging, resizing, and title display. The whale pet's interaction area follows the character more closely.
- **Harness baseline**: Updated to `dsh-v0.1.7-alpha.2` while retaining desktop work loops and plugin capabilities.

## Technical contract

- The whale's `sessionId` in `data/whale/settings.json` owns its conversation identity. IM does not silently create another whale conversation when the assistant is disabled or unavailable. Other explicitly selected bot presets keep independent conversations.
- The right Browser panel and chat mini preview hand off the same guest; a delayed hide from the departing surface must not override the new owner's display.
- The `dshd mini-player` positions its renderer controls in the chat viewport and hands the Browser guest (BrowserView) over by `previewId`; the same guest retains URL and history. The installed-package Browser path is a P0 acceptance case.
- File opening uses authorized workspace paths. Paths without a working directory or a supported handler fall back to the Host.

## Install and upgrade

Windows 10 or later x64 users can download the installer from [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) and verify it with the accompanying `SHA512SUMS.txt`. The installer is not Authenticode-signed, so Windows may show a security warning. Existing desktop installations can be upgraded in place; use Import in the launcher when migrating from another environment.

## Platform scope

The public asset set defaults to a Windows x64 installer. macOS is included only when explicitly selected for the candidate build. Android and the second Web client are outside this installer set. Remote access requires an explicit pairing opt-in.

## Verification scope

The candidate is gated by Desktop tests on the same commit, installer packaging, and packaged smoke. Promotion also requires the installer SHA256 check and manual acceptance of the production installer. Manual paths not exercised are not claimed as passed.

## Feedback

Report issues through [Issues](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) with the OS, reproduction steps, and relevant logs. Remove keys and other sensitive data before sharing logs.

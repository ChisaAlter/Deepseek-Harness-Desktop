# Whale Isle 0.3.3

[中文](release-notes.md) | English

This package uses DeepSeek Harness `0.1.7-rc.2` (upstream commit `477b4f420553e8a52c2fbccc464d7561b239c443`), verified from this candidate's original installer payload.

## What's new

- **Remote workspaces**: Manage SSH machines, choose remote directories, and use mirrored workspaces in desktop sessions.
- **Session costs**: Usage Statistics now shows costs by model, includes a price-period editor, and has a more compact activity calendar.
- **One resident whale conversation**: The main window, desktop quick chat, and enabled IM channels share one persistent conversation. Settings separate chat and capabilities from desktop appearance and behavior; quick chat uses a floating model and reasoning picker.
- **File and browser work loops**: File references and deliverables in chat open the relevant surface. HTML, HTM, XHTML, and PDF deliverables first open in the chat mini preview, then move to the right Browser panel on request while retaining the same page and history.
- **Files entry and editing protection**: The right panel keeps one Files directory entry and opens editor tabs for specific files. Legacy fileless viewers show their owning conversation's directory instead of reading internal `sidebar://` addresses as file paths. Edits retain a draft, and closing an unsaved file offers Save or Discard. A failed save keeps the editor open. Selected text goes into the owning conversation, and the file tree and search use the shared opening route.
- **Remote access fixes**: Malformed requests no longer interrupt the LAN static server. Local-only mode retains loopback listening, and the configured port controls the actual remote daemon. Settings remove the unimplemented LAN TLS switch and explain the existing encryption scope.
- **Preview path fixes**: Files with Chinese characters, spaces, or percent signs preview correctly, while path traversal and encoded path separators remain rejected.
- **One right panel**: Files, browser pages, diffs, and other resources open in place in the same right panel. Closing the last content tab returns to its entry view without switching between separate sidebars.
- **Launcher and data preservation**: Failed imports preserve existing data, and failed plugin replacements restore the previous installation, including a fix for directory links in Windows rollback snapshots. Stopping or cancelling startup invalidates older recovery tasks. Import lists and long confirmations remain scrollable in small windows and at high zoom levels.
- **Account sign-in**: The system browser opens automatically when a desktop account authorization link becomes available; the dialog still offers a copyable link.
- **Interface fixes**: Right-panel tab close buttons align with their titles. The Jobs popover avoids clipping under the conversation header. The browser mini preview has slimmer chrome and improved dragging, resizing, and title display. The whale pet's interaction area follows the character more closely.
- **Installation and startup recovery**: Interrupted downloads retry within a bounded limit, and installation failures show a recoverable state. The runtime is validated in a temporary directory before replacement. Same-version upgrades refresh it by archive content to avoid reusing an older runtime. Startup checks dependency links asynchronously to reduce long UI stalls.
- **Update failure recovery**: A differential-download timeout cancels the download. If the installer cannot start, the app reports the error, keeps the current app and component services running, and allows a retry without claiming success or quitting early.
- **Accurate statistics and responsive switches**: Fixed missing usage in restored sessions and totals doubling on repeated refreshes. Session statistics, cost, and peak/off-peak switches respond immediately and retain the latest choice during rapid changes.
- **Windows windows and desktop pet**: The main window and launcher retain both 20px transparent corners and native window animations. The pet adapts to screen density, and clicks pass through the gap between the character and chat card.
- **Windows taskbar icon**: Windows set the Whale Isle icon, name and relaunch command before the AppID, so complete branding is available when the taskbar refreshes. Installed startup identifies the exact old notification-generated Electron shortcut, keeps a complete backup without the shortcut extension, and notifies the system that the old entry was deleted within a bounded wait. Source runs prevent notification registration from recreating the entry, installed notifications remain available, and user pins are retained.
- **Normal quit**: Closing feedback waits at most 500ms, preventing a hidden page without paint callbacks from stalling quit. Task inspection, draining, and normal shutdown remain in place.
- **Pet feeding recovery**: New consumption remains available for feeding after session logs are cleaned up. Restoring old logs does not grant food twice. Upgrading preserves growth, lifetime feeding and the existing available balance; a retry after a failed save does not consume it twice.
- **Harness baseline**: Updated to `dsh-v0.1.7-rc.2` while retaining desktop work loops and plugin capabilities.

## Technical contract

- The whale's `sessionId` in `data/whale/settings.json` owns its conversation identity. IM does not silently create another whale conversation when the assistant is disabled or unavailable. Other explicitly selected bot presets keep independent conversations.
- The right Browser panel and chat mini preview hand off the same guest; a delayed hide from the departing surface must not override the new owner's display.
- The `dshd mini-player` positions its renderer controls in the chat viewport and hands the Browser guest (BrowserView) over by `previewId`; the same guest retains URL and history. The installed-package Browser path is a P0 acceptance case.
- File opening uses authorized workspace paths. Paths without a working directory or a supported handler fall back to the Host.
- Legacy fileless viewers show their owning conversation's directory body and title in place, preserving the tab record, panel expansion, and floating state. Valid files and drafts retain their identity without a persisted-layout migration.
- Differential and full-file installs share target-version, release-manifest SHA512, and task-admission checks. An installer-start failure releases the admission lock, and a retry checks work again.
- Runtime archives use SHA256 content identity; older extraction markers migrate once. Normal reuse reads only a small digest manifest, and replacement verifies the actual archive. Build credentials also track script helpers, vendored sources, and native outputs for the current platform while excluding generated directories.
- The old notification entry retains its original bytes in `Electron.lnk.backup`. Only a completed move sends the exact asynchronous `SHCNE_DELETE` / `SHCNF_PATHW | SHCNF_FLUSH` event for the original path; after 500ms the backup is retained and startup continues. Event delivery does not prove correct taskbar pixels; first cold-launch acceptance remains separate.
- The macOS update path selects a DMG for the current architecture, verifies it, and opens it with instructions to drag the app into Applications. Opening the image does not mean installation is complete and does not quit the app. This Windows release does not include a DMG.

## Install and upgrade

Windows 10 or later x64 users can download the installer from [Releases](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases) and verify it with the accompanying `SHA512SUMS.txt`. The installer is not Authenticode-signed, so Windows may show a security warning. Existing desktop installations can be upgraded in place; use Import in the launcher when migrating from another environment.

Git operations require a Git CLI that the application process can find. If Git is not configured, install it and confirm that the desktop-launched application can access it; Git availability in a development terminal does not establish that dependency for the desktop process.

## Platform scope

This release includes only a Windows x64 installer. Android, macOS, and the second Web client are outside this installer set. Remote access requires an explicit pairing opt-in. The LAN static page uses HTTP; Settings explains the scope of end-to-end encryption and relay TLS.

## Known limitations

If the current Windows Explorer session has cached an older notification-generated Electron shortcut, the taskbar may retain the old name or a white file icon after upgrading. Once the old entry has been migrated, signing in again or restarting Explorer can restore it; the app does not restart Explorer itself. Correct pixels in a clean session do not certify the first display on this upgrade path.

## Verification scope

The candidate is gated by Desktop tests on the same commit, installer packaging, and packaged smoke. Promotion also requires the installer SHA256 check and manual acceptance of the production installer. Manual paths not exercised are not claimed as passed.

## Feedback

Report issues through [Issues](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/issues) with the OS, reproduction steps, and relevant logs. Remove keys and other sensitive data before sharing logs.

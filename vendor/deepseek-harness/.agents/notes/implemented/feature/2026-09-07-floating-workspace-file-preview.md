# Agent Note: Floating workspace file preview

Status: implemented

English | [中文](2026-09-07-floating-workspace-file-preview.zh.md)

## Problem

Files could preview and edit text in the right surface and render images there, while Browser could move into a native always-on-top picture-in-picture window. A user inspecting an image, document, or source file during a chat had no way to keep that file visible after changing surfaces. Sending every file through Browser PiP was also the wrong transport: the T3 Code implementation at `4e969f373` captures a live browser guest to JPEG at 12 fps, which is useful for an interactive page but loses source fidelity and wastes work for a static image or document.

## Decision

**Files gets a direct native floating viewer.** The preview toolbar shows an `IconRightUpOutline16` action only when the desktop preload exposes `previewOpenFileWindow`. The call carries only `cwd` and `relativePath`; main validates them through the existing workspace authority and token-prefixed loopback server, then opens or reuses one read-only, always-on-top `BrowserWindow`. Opening another file replaces the occupant in place and uses `showInactive()` so the chat keeps focus.

The window keeps the system title bar and paints its content with the official Web UI canvas tokens. Images and SVG use `img`; video and audio use native media controls; PDF uses Chromium's viewer; HTML runs in a sandboxed frame without `allow-same-origin` or top navigation; text uses the existing 1 MiB `readFile` contract and a read-only `pre`. Unknown binary files show an explicit unsupported state. The loopback server now declares media MIME types and accepts one HTTP byte range so Chromium can seek media. The floating window never receives Node, an editor buffer, or the Files save coordinator.

The file-preview preload is deliberately narrower than `window.shell`: it can read the current immutable preview snapshot and subscribe to theme changes. Its state IPC accepts only the floating window's own `webContents`; the harness remains the only caller allowed to open or replace a file.

## Alternatives considered

**Reuse Browser PiP for every file.** Rejected: repeated JPEG capture is lower fidelity for images and text, has no native media seeking, and duplicates pixels that the loopback file server can deliver directly.

**Open one floating window per file.** Rejected: it creates unbounded always-on-top windows and weakens the Files work-loop model. One replaceable viewer matches the existing single PiP ownership rule.

**Move the editable FilePreview React tree into the new window.** Rejected: sharing dirty buffers and save coordination across renderers adds conflict and lifecycle risk. The floating view is intentionally read-only and reflects disk.

## Consequences

Users can keep a workspace image, media file, PDF, HTML page, or text file above the desktop while continuing the conversation. Unsaved edits remain owned by the Files tab, so the floating window may show the last disk version until Save. Closing the window does not close the Files tab; closing all preview resources during restart or quit also closes the floating viewer before the workspace token server stops.

## Testing

Desktop tests cover type classification, single-window reuse, always-on-top and sandbox options, sender-only state IPC, binary fallback, preload surface, theme classification, shell exposure, workspace MIME and byte-range responses, and preview shutdown. The ui-files client test clicks Floating preview and pins the exact `{ cwd, relativePath }` payload. An actual Electron smoke run opens `assets/icon.png`, verifies a loaded image under the dark token table, captures the window, then replaces it in the same window with the scrollable `README.md` text view. PDF, HTML, video, and audio paths are covered by type/MIME/range tests and remain manual release cases.

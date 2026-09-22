# Agent Note: Files/Browser logic port

Status: implemented

English | [中文](2026-08-19-files-browser-logic-port.zh.md)

## Problem

The desktop Files and Browser occupants already owned search, save, and a loopback guest, but they did not carry the rest of the work loops a local reference desktop ships: public https guests, tree drag into the composer, jump-to-line, comments into the composer, open-in-editor, PiP, device toolbar, pick, recording, and CDP automation on the existing guest. Importing that tree at runtime would couple this product to another brand's Effect/Atom/Schema stack, Pierre chrome, and a second Chromium.

## Decision

This desktop ports those Files/Browser loops from the local reference tree `C:\Ai\t3code` and rebrands every live identifier to `dshd`. Effect/Atom/Schema peel to Promises and `webContents`. Playwright Chromium, `playwright-core`, and `__t3PlaywrightInjected` are not shipped; automation is CDP on the existing guest. Chrome stays official dsh `ui-primitives` plus `--dsw-alias-*` (no Pierre, lucide, shadcn, or Tailwind).

The guest BrowserView is `contextIsolation: false`, `sandbox: true`, and `nodeIntegration: false` so the pick overlay can use `ipcRenderer`. The harness main window stays `contextIsolation: true`. The PiP window stays `contextIsolation: true`. Guest documents may be any `http(s)`; `file:` documents are cancelled. Address bar `normalizePreviewUrl` treats a bare loopback host as `http` and a bare public host as `https`. The harness main window loopback wall is unchanged.

dshd extras stay: dirty-tab Keep/Discard/Save, `error.changed`, occupancy hide (`overlayOpen || pipOpen`), and the token-prefixed workspace file server. Preview IPC that reaches the guest is harness-authorized only. Recording is host-renderer `MediaRecorder`; artifacts land under `userData/preview-recordings/`.

## Alternatives considered

**Import Effect as-is.** Rejected: this desktop's main process is Promises and `webContents`, not Effect; keeping the foreign runtime would own a second async model for one occupant.

**Fake More items.** Rejected: a menu that names PiP, pick, or recording without the matching IPC would lie.

**Pack a second Chromium.** Rejected: Playwright's browser download would bloat and break electron-builder; CDP on the existing guest is the wiring.

**Copy Pierre into the slot tree.** Rejected: design language requires `ui-primitives` and `--dsw-alias-*`; a second icon/component kit is a second skin.

**Drop guest `sandbox`.** Rejected: pick needs `ipcRenderer` in the guest, which `contextIsolation: false` already provides; sandbox stays on.

**Open the harness main window to public http(s).** Rejected: the main window still loads the harness UI and the user API key; only the guest document may be public `http(s)`.

## Consequences

Guest, main, and PiP isolation are a split, not one preference object. Pick overlay IPC is available only in the guest. Recording frames arrive over IPC into the host renderer; there is no second browser. Artifacts under `userData/preview-recordings/` are desktop-local files. Harness-only preview IPC stays authorized on `window.shell`; the boot window never receives guest control channels.

## Testing

`src/main/workspace-fs.test.js` pins the 1 MiB caps and traversal. `src/main/preview.test.js` pins public https guests, pick, PiP isolation, and automation method wiring against fakes. `src/main/preview-session.test.js` pins guest webPreferences and leftover UA-token strip. `src/preload/shell-api.test.js` pins authorized preview IPC. `ui-files` pins uncapped search, mention drag, revealLine, and Add to chat. `ui-preview` pins More occupancy hide including PiP, device-toolbar `setBounds`, pick markdown, and host MediaRecorder with a fake recorder. Live Electron MediaRecorder and live CDP on a real guest are not proven.

## Related

[Right-panel and terminal work loops](2026-08-16-surfaces-terminal-work-loops.md) owns the Files/Browser/Terminal loops this port fills. [Conversation links into Files and Browser](2026-08-19-conversation-surface-links.md) owns html/svg dual-open and the token workspace file server.

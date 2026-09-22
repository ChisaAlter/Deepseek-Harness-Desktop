# Agent Note: Surfaces workbench depth

Status: implemented
Archived: 2026-08-25

English | [中文](2026-08-15-surfaces-workbench-depth.zh.md)

## Problem

The official fourth column (`surfaces`) opened one occupant from five empty-state cards, then dropped the Files explorer when a file opened, had no way to open a second kind, and sent chat file clicks to the OS. The desktop workbench needed the Files tree to stay, a tab strip that can add kinds, in-app preview for images and Markdown, Git stage/unstage/discard on the Diff surface, and clickable Agents rows, without adopting a portal sidebar or a second host HTTP API.

## Decision

Chat file opens still funnel through `ctx.workspaces.openPath`. `@deepseek-ai/dsh-client-ui-surfaces` wraps that method and, only when `window.shell.listDir` exists and the path is inside the current session cwd, writes `openFile` on the surfaces store and calls `layout.openSurfaces()`. The web lane has no `listDir` and always falls through. `openFile` keeps the `files` singleton and adds a sibling `file:<relativePath>` tab. The tab strip exposes `+` (disabled for already-open singletons), middle-click close, a close context menu, and non-passive wheel-to-horizontal scroll. Tabs persist per session at `dsh-surfaces:v1:<sessionId>`; unknown kinds are dropped.

`ui-files` mentions a markdown file link through `appendToDraft`, copies relative/absolute paths, refreshes the tree, and previews images via `readFileMedia` and Markdown via `MarkdownText` with `codeLabels`. `ui-agents-panel` opens a catalog child through `sessions.openSubagent` when `subagentAddress` exists, otherwise `sessions.open`, and lists `jobsBySession` read-only. `ui-diff` receives owner `openFile`, groups porcelain staged/unstaged when `gitStatusEntries` is present, and stages/unstages/discards through new IPC that still uses `workspace-authority` (boot workspace plus harness-registered workspace paths). Titlebar `gitCommit` remains `git add -A`. An authorized cwd that is not a git work tree returns `{ isRepo: false }`; the trailing control then shows Initialize Git (`gitInit`) instead of a disabled Commit. `hasPrimaryRemote` defaults to false when omitted. The titlebar has no marketplace window-control. `PanelToggles` honors Ctrl/Cmd+\\ and Ctrl/Cmd+` except inside inputs, textareas, and contenteditable; inside the terminal pane (`[data-terminal-pane]`) the drawer chord still applies while the surfaces chord stays with the PTY. The user terminal is a Ghostty Canvas surface themed from `--dsw-*` aliases; Windows spawn resolves the `pwsh.exe` → `powershell.exe` candidate chain with `-NoLogo -NoProfile`.

The surfaces column stays the official layout slot. There is no `document.body` portal, `/sidebar/api`, second `node-pty`, `registerTab` service, arbitrary HTTPS iframe, PDF/Office preview, model-visible `terminal_*`, or bottom second workbench.

## Alternatives considered

**Preinstall `dsh-better-sidebar`.** Rejected: it portals out of the official column, pins an older harness, refuses localhost (the opposite of our Browser), and has no push. The interaction to copy is the `openPath` funnel and tab chrome, not the host.

**Change `ui-conversation` `openFile` or steal `conversation.chat.turnTail`.** Rejected: every production chat open already calls `workspaces.openPath`. Wrapping that one method covers tool rows and mentions without a second inject.

**Replace the Files tab with the preview.** Rejected: the explorer must stay so the user can open another file without returning to the empty grid.

**Writable preview (`writeFile` + Ctrl+S) in this change.** Rejected: image and Markdown preview do not require a write path; that remains deferred.

## Consequences

Desktop chat path clicks open the right column with Files still present. Web e2e must not assert intercept. Diff stage does not change titlebar Commit. File preview stays read-only. Occupant packages keep listing/read/git on `window.shell` plus multi-root workspace authority; they do not add a host HTTP/WS server.

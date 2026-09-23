# Decision: Chat file previews migrate to the right Sidebar resource route

Status: implemented

[中文](2026-09-21-chat-file-sidebar-resource-route.md) | English

## Problem

The client mounts both the new `ui-sidebar-right` and the legacy desktop surfaces column, while chat files, tool paths, and deliverable chips still funnel through `workspaces.openPath`. `ui-surfaces` intercepts that call and writes only to the legacy surfaces store. The visible right Sidebar therefore never receives the file-open intent, and clicking a file produces no right-side document or browser preview. The originating Session also cannot be inferred from the "current main-view Session" because the main view may switch while a token or asynchronous preview is pending. The native floating file window is a separate Files toolbar path and is not part of the chat-file click contract.

## Decision

The desktop `workspaces.openPath` interception remains the single funnel and tries `sidebarRight` before the legacy surfaces column. Chat explicitly carries the current Session when it calls that funnel; the interceptor prefers it and falls back to the main-view Session only when it is absent:

- The workspace root calls `sidebarRight.openTabIn(sessionId, 'files')`.
- Other workspace files first call `sidebarRight.openResourceIn(sessionId, fileAddressFor(sessionId, cwd, relative), { params: { line } })`; the parameters are omitted when there is no line.
- HTML, HTM, XHTML, and PDF keep that file-resource page, then obtain a token-protected loopback URL from `previewWorkspaceFile` and call `sidebarRight.openTabIn(sessionId, 'browser', { params: { url } })`. Browser is a second preview and does not replace the file-resource page.

Interception continues through the original surfaces branch only when the Sidebar service is absent, or when the target Session has neither an adopted store nor a matching live binding, preserving hosts without the new Sidebar. Once a Sidebar target is selected, a navigation exception propagates instead of silently falling back. A missing legacy surfaces occupant also throws instead of falling through to the Host system opener. `ui-surfaces` declares the Sidebar, Sidebar Browser, and Sidebar Document Preview type dependencies so their parameter declarations merge into the client program.

## Alternatives considered

- **Change only `ui-chat.openFile` to call `sidebarRight` directly** — rejected: tool rows, deliverable chips, skills, and terminal entries are other product paths; direct calls would create several sources of truth and bypass the existing desktop interception contract.
- **Remove the legacy surfaces interception and rely entirely on the new Sidebar** — rejected: with no Sidebar service, or with no adopted store or matching live binding for the target Session, a click would fall through to the Host opener; the legacy branch preserves host compatibility.
- **Make chat file clicks open the native floating file window** — rejected: floating preview is explicitly triggered from the Files toolbar as a singleton read-only window; the current chat-click contract opens the right-side workspace.

## Consequences

The new right Sidebar receives chat file opens and focuses a document tab; HTML, HTM, XHTML, and PDF keep the file-resource page and also open in Sidebar Browser; the workspace root opens Sidebar Files. Asynchronous opens always use the Session that originated the click, so a main-view switch cannot send the file to the wrong Sidebar. Behavior remains unchanged when there is no Sidebar target to take over; an error from a selected Sidebar target no longer falls through silently to the legacy surfaces or the Host opener. `ui-surfaces` gains compile-time dependencies on Sidebar Browser and Document Preview; runtime routing still depends on whether the service exists. Focused tests cover ordinary files, line numbers, the root, HTML/PDF, explicit Session routing, Sidebar errors, and a missing legacy surfaces occupant; the Chat inject and local Markdown `#L24` link suites remain green.

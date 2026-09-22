# Decision: Let the document tab read scratch-session files

Status: implemented

[中文](2026-09-23-scratch-cwd-document-tab-read.md) | English

## Problem

The Host pins a no-workspace session's cwd to `$DSH_HOME/no-workspace` (the scratch directory). After the model writes an HTML file in such a session, the chat file card offers "Open"; clicking it makes the right-side document tab read through `shell:read-file` / `shell:list-dir`, which answer `Path is outside the workspace.` and the page renders that error instead of the file. The same file opens through the Browser panel's `previewWorkspaceFile` and through the floating preview's `previewOpenFileWindow`, so the gap is specific to the authority used by those two document-tab IPC channels.

Root cause: both channels resolve through `workspace-fs`'s lazy production authority, which calls `loadWorkspaceAuthority()` without `allowScratchCwd`; `preview.js` calls `loadWorkspaceAuthority({ allowScratchCwd: true })`. The upstream fix `5c789fcba53` added the preview-side opt-in but never updated the document-tab side.

| Path | Result under the scratch cwd |
| --- | --- |
| `previewWorkspaceFile` (Browser panel) | Works; relative CSS / images and MIME are correct |
| `previewOpenFileWindow` (floating preview) | Works |
| `shell:read-file` / `shell:list-dir` (document tab) | Fails: `{ ok: false, message: "Path is outside the workspace." }` |

## Decision

`workspace-fs`'s lazy production authority matches preview: `loadWorkspaceAuthority({ allowScratchCwd: true })`. The scratch root still comes from `scratchWorkspacePath()` in `workspace-authority.js` (`$DSH_HOME/no-workspace`); this only adds it to the same allowlist. `resolveInside` keeps its traversal, absolute-path, symlink-escape, and `.git` rules unchanged, so a scratch session gains no access to arbitrary paths; parent directories and volume roots stay refused.

## Alternatives considered

- **Route the document tab through the preview authority (bind `shell:read-file` / `shell:list-dir` to `createWorkspaceFileReader(preview authority)`)** — rejected: the preview authority is tied to the lifecycle of `createWorkspacePreviewController` and the floating window, so reusing it would couple generic file IPC to preview-controller creation and teardown; `listDir` also needs directory enumeration, while the preview side only has a bounded read-only file adapter. That touches more files and makes document-tab availability depend on whether the preview stack has initialized.
- **Build a second scratch authority inside `workspace-fs`** — rejected: `workspace-authority.js` is already the single trust-root implementation, and `loadWorkspaceAuthority({ allowScratchCwd: true })` is the existing seam. A second copy would fork the `resolveInside` / `.git` / realpath rules.
- **Do not authorize scratch; require the user to pick a workspace first** — rejected: no-workspace sessions are already supported and generate files with an "Open" affordance; the product path must open them. Leaving the affordance in place and then showing an out-of-bounds error is the worst outcome.
- **Authorize `$DSH_HOME` or the user home** — rejected: that crosses beyond the scratch root and exposes tokens, imported data, SSH config, and other high-risk directories to renderer-initiated reads — a clear privilege expansion.

## Consequences

The file card in a no-workspace session now reads scratch text / HTML (and lists directories) in the right-side document tab, matching the Browser panel and the floating preview. The boundary remains the Host-pinned scratch root: `..`, absolute paths outside it, and symlink escapes are still refused by `resolveInside`, and `.git` segments remain unreadable and unwritable; URL-encoded traversal is refused by the token server after decoding, which this decision does not touch. The regression lives in `src/main/workspace-fs.test.js`: under the same production authority, a scratch file can be read and listed while the parent directory and an absolute path outside scratch still fail as out of bounds.

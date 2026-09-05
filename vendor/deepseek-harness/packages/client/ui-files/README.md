# @deepseek-ai/dsh-client-ui-files

English | [中文](README.zh.md)

Right-panel Files occupant: a read-only workspace tree on `surfaces.files` and a single-file preview on `surfaces.file`. Both slots are `single` + `session-maybe`, declared by ui-surfaces. Clicking a file calls the owner `openFile(relativePath)`. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

Workspace root is the current session `cwd` from one `useSessions` read. Listing and file bytes come from desktop `window.shell` `listDir` / `readFile` / `readFileMedia` / `writeFile`; the renderer never loads Node. Directories expand lazily; the tree can be filtered by name (uncapped DFS under the workspace root; picker rows with full paths open the file). Typing `@` in the composer uses official ui-reference, not a Files path menu. Mention is a row control into the composer (markdown file link) and is omitted without a session id; file-tree rows drag into the composer as the same markdown link (`application/x-dshd-composer-mention`). Skills use official `/` via ui-skill. An in-flight root listing shows a listing message instead of empty-directory. Refresh reloads the root listing; while a search is active it re-walks that search so nested matches are not dropped. Context menus can show a file in the folder, open it in a probed editor, or open it with the system default. The context menu copies relative or absolute path. Images render as data URLs. Text within the 1 MiB read cap can be edited and saved (write cap is also 1 MiB); a failed save keeps the editor and the unsaved buffer and reports the error above it. FilePreview rereads when its tab becomes active. A dirty draft stays in the editor (Markdown Source included) when that reread fails, returns truncated or binary bytes, or runs without a cwd; Save writes whenever cwd exists, and a successful write clears truncated/binary. Save rereads disk and keeps the draft with `error.changed` when the file moved under the buffer; a second save overwrites. The surfaces shell persists dirty drafts in localStorage across reload and quit. `.md` toggles source versus `MarkdownText`. Jump-to-line (`revealLine` / `revealRequestId`) scrolls the source textarea and shows source while that reveal is pending. A non-collapsed source selection shows Add to chat, which appends an `L` range and a `text` fence of those lines to the composer; outside click and Escape dismiss the selection.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; FilesPanel, FilePreview, and FileTree remain package-internal behind the slot registration.

Search filters the local file list by name or path subsequence before applying the result limit. Nonmatching files are omitted; an empty query keeps file order.

## Model Experience

None, as the Files surface only reads the workspace for display; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The tree does not mutate the workspace** — there is no create, rename, or delete.

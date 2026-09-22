---
description: "Document previews in the right Sidebar: shared file loading and controls, selectable Markdown, code, image, PDF, Office and HTML renderers, and plain-text fallback."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-documentpreview

English | [中文](README.zh.md)

## Summary

Preview readable files in the right Sidebar and choose among registered renderers without opening another tab. Markdown and code receive accumulated text pages; PDF, HTML, and common images receive complete bytes; unknown file extensions use plain text. Office documents convert locally to PDF. The tab owns loading, file status, renderer selection, wrap, and reload, while document bodies register through the same metadata registry and child slot. The Sidebar tab kind is `text`.

## Table of Contents

- [What it registers](#what-it-registers)
- [Addresses](#addresses)
- [How it reads](#how-it-reads)
- [Office preview](#office-preview)
- [Navigation](#navigation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with id `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` (this implementation's identity in the tab system, and the key its body registers under), kind `text`, pattern `dsh-resource://file/**`, band `fallback`. `canOpen` accepts only Session addresses, whose paths may be relative or absolute; bare `absolute` addresses are not claimed. A type registered at the `extension` or `builtin` band for a narrower pattern (say `*.png`) takes those addresses; other supported files land here. The whole address is the content identity, so two files with one name in different directories, or one path under two sessions, are two tabs; the decoded basename is the tab title, and the keyed `sidebar.right.pane.tab.title` seat places its extension-specific `FileTypeIcon` before that title.
- **The body** — the keyed `sidebar.right.pane.tab` seat under the type's id. Its fixed header shows the Host's absolute path when available, otherwise the requested path; directories use tertiary label colour, the name uses primary label colour, and a clipped path retains and fades toward its final segment while its tooltip exposes the full value. A dropdown appears when multiple supported renderers are available. Plain text is offered only for text-compatible sources; a single renderer shows no viewer control. A known binary container suffix without a registered renderer shows the file-type icon and an unsupported-preview message under the path header, without issuing a read. A wrap toggle appears only when the selected renderer declares `wrap: true`; its glyph describes the mode the click selects, and the per-tab preference starts on. Reload stays in this header, not the Sidebar's tab strip. The body reaches every pane edge; each renderer owns its content inset and may own an inner scrollport. This intentionally differs from the Files tab's 2px right-side scrollbar offset: previews keep the full pane width so edge-to-edge HTML and code scrollports end at the pane edge.
- **Shared loading and view state**, session-scoped and bucketed by tab id. The store holds accumulated pages or complete bytes, read and observed versions, loading/failure state, renderer choice, scroll offset, wrap, and the answered navigation revision. The ordinary inject face calls Remote readers and writes through declared store actions. Reloads and loading-mode changes retire older requests; the tab's abort signal forgets its state.

Document implementations register metadata with `ctx.documentPreviews.register({ id, extensions, binaryExtensions?, priority, title, loading, wrap? })` and a body under the same `id` in the keyed, Session-scoped `sidebar.right.tab.document` child slot. `binaryExtensions` lists suffixes in `extensions` that cannot be read as text and omit the plain-text option. Own both registrations with effects and wait for the child slot through `ctx.slots.inject`. Bodies receive `resourceAddress`, `content`, `wrap`, `scrollportRef`, and the standard `useTabInfo`/`useResource` hooks. An inner scrolling element attaches `scrollportRef`; unmounting restores the shared body as scroll owner. The registry retains all matching alternatives: `extension` (the default) ranks above `builtin`, then longer suffixes rank first, then registration order. The dropdown preserves a selected implementation while it remains available. HTML, SVG, and unmatched extensions retain the plain-text fallback independently of loading mode.

`loading: 'text-pages'` and `'bytes-complete'` use the shared file reader. With `'renderer'`, the selected body mounts before any bytes are read and receives `content: { kind: 'renderer', revision, loaded, reload }`. Its injected callbacks own content loading, errors, and cancellation. `loaded(version)` reports the displayed source version for the shared change notice; reports from replaced revisions are ignored. `reload()` increments the revision, which the body observes to cancel and replace its request. The body also cancels on unmount and tab closure, retains settled content in its declared tab store, and releases that state when the tab ends. [Office previews](#office-preview) use this mode without putting converted bytes or font metadata in the shared file store.

<a id="addresses"></a>
## Addresses

A tab uses the Session address built by `fileAddressFor`, carrying a relative or absolute path. `hostFileOf(address)` takes the Session only from that address, with no external Session argument; neither current nor Tab Session is borrowed. The Host resolves file and related paths through the Session filesystem, whose backend controls read authority. Metadata for the same complete address is shared by every UI, including Global components. The [Workspace Files README](../../api/workspace-files/README.md) owns these rules; renderer selection does not change the navigation address.

<a id="how-it-reads"></a>
## How it reads

The body reads its record, navigation and lifetime through `useTabInfo().tab`. `useResource<'file'>(tab.contentId)` supplies metadata; ordinary inject callbacks supply content reads:

- The resource snapshot contains only `status`, `value`, and `failure`; `value` is `WorkspaceFileStat` metadata. Content reads do not wait for the first metadata frame once the provider is available. Observation failures take precedence over Preview's change notice; neither automatically replaces loaded content.
- **Text pages** — plain text, Markdown, and code read through an inject callback to `remote.workspaceFiles.read(sessionId, path, { offset }, signal)`. The first mount reads page one; scrolling to the body end or **Load more** requests the next page until `eof`. The owner delivers the accumulated prefix as `{ kind: 'text', text, pages, eof }`, including source offsets and line counts. Markdown and code render that prefix incrementally; they do not render each page as a separate document. A newer-version page past page one restarts from the beginning rather than mixing versions. A failure before any content fills the body with the file-type icon, explanation, and retry; a later failure retains loaded content and adds the retry below it.
- **Complete bytes** — PDF, HTML, and common images use an inject callback to `remote.workspaceFiles.readAll(sessionId, path, signal)`. `rpc.ts` decodes the wire base64 into `data: Uint8Array<ArrayBuffer>` for `{ kind: 'bytes', data }`. The Host's `maxFileBytes` cap rejects oversized files rather than truncating them. PDF copies retained bytes before worker transfer, keeping the Preview buffer usable. Bytes stay in transient view state, never persisted layouts or Session JSONL. Loading-mode changes retire previous results.
- **Reload** — only the current Preview tab rereads through its Remote callbacks, preserving its scroll preference and retiring older requests. Its change notice compares the read version and the observation captured at read start with later `resource.value.version`; an already observed version does not become a new change after refresh. Reads neither refresh shared metadata nor clear another tab's notice.

HTML fills the body edge to edge in a Blob iframe with exactly `sandbox="allow-scripts"`, without `allow-same-origin`; scripts cannot access the parent application's origin or file reader. The renderer loads directly declared relative `.js` classic scripts and `.css` stylesheets through its ordinary inject callback to `remote.workspaceFiles.readRelated`, with fixed safety limits of 4 MiB per asset, 32 MiB total, and 64 distinct assets. Host code resolves the related path; `rpc.ts` decodes the returned bytes. Inside the renderer, base64 is used only to embed the iframe bootstrap payload in script text. A `<base href>` leaves dependency resolution to the browser, as do HTTPS resources. Local module imports, CSS `url()`/`@import`, and dynamic `fetch` do not use Host file access. Read failures, invalid UTF-8, or exceeded limits fail the preview rather than publishing a partial asset package. Replacing or unmounting the document releases its Blob URL.

PNG, JPEG, GIF, WebP, BMP, ICO, and SVG render through Blob URLs in an `<img>` static-image context, rounded inside a 12px inset. A wider image scales down to the pane's width at its intrinsic aspect ratio, a smaller image centres at its intrinsic CSS-pixel dimensions, and a taller image scrolls vertically. The renderer provides neither zoom nor drag-to-pan. SVG markup never enters the application DOM or an iframe, so its scripts cannot execute or reach the parent page. Replacing or unmounting the image revokes its Blob URL.

Shared copy comes from `sidebarDocumentPreview`; each builtin renderer owns its localized labels. PDF and converted Office previews use a graphite background in light mode and a matte-black background in dark mode, with subtle page shadows and original document colors.

Initial reads, additional pages, and HTML/PDF/image preparation share an icon-only loading spinner that exposes its label to assistive technology and respects reduced-motion preferences; every wait before content exists centres the spinner in the pane, so opening a file shows one spinner in one position until the body appears. Loaded pages stay visible while another page loads. The PDF body loads its package-local `client.pdf.js` chunk only when a PDF preview mounts; PDF.js, its Worker source, and embedded support data stay out of the startup `client.js`. PDF pages fill the pane's width edge to edge as one vertical sequence and render lazily near the viewport; an unrendered page holds its place as a quiet 3:4 placeholder block. PDF.js’s official TextLayerBuilder manages selection boundaries and normalized copying over an aligned text layer. Its companion styles keep blank line breaks unhighlighted; alignment accounts for PDF page units, page rotation, and viewport resizing, and page disposal cancels both layers. Image-only PDFs contain no selectable text. Code previews show source line numbers by default without including them in copied text; plain text uses the same font size and line height as code. Code sits on the pane's own background rather than the chat card's fill; its banner is adjacent to a full-height inner scrollport, so both scrollbars begin below the copy control.

<a id="office-preview"></a>
## Office preview

Open `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, and `.pptx` as PDF previews with the same loading state, controls, cancellation, and selectable text as PDF files. The [Host provider](../../document/office-to-pdf/README.md) performs local conversion; invalid files, conversion failures, and timeouts receive localized messages. Missing Host services show configuration guidance.

The [Web bundle](../../bundle/web-app/README.md) mounts this package as `ui-sidebar-documentpreview`. Configure its transient Office cache through that entry's `office` settings; the [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-client-ui-sidebar-documentpreview) defines accepted values. Settings are embedded in each served page; reload the browser page after changing YAML.

| Field | Default | Meaning |
|---|---|---|
| `office.maxCachedEntries` | `8` | Maximum retained completed PDFs |
| `office.maxCachedBytes` | `67108864` (64 MiB) | Maximum retained binary PDF bytes, counted by buffer `byteLength` |
| `office.maxPending` / `office.maxReaders` | `8` / `32` | Unsettled conversion RPCs / readers including metadata lookups |

Opening an Office file requests conversion on demand. Each read checks renderer generation and authorized source metadata before sharing an in-flight conversion or reusing a successful PDF. The cache uses renderer generation, Session, absolute source path, and source version as its identity; least-recently used PDFs leave to keep retention within both limits. Failures and PDFs larger than the byte limit are not retained. A converted PDF is retained only when its returned renderer generation matches the cache identity. Cancelling one reader leaves shared conversion running until the final reader leaves. Connection resets clear cached bytes and cancel pending reads; plugin disposal also waits for outstanding requests. PDFs are never persisted; transport strings, decoding storage, and PDF.js rendering memory remain outside the cache limit.

Background requests leave the final pending-request and reader slots available for foreground work; setting either limit to one rejects background reads. Renderer replacement restarts generation discovery and authorization once. Another replacement during that retry reports the localized busy message.

A yellow notice identifies fonts unavailable during conversion. Show more opens an anchored list; closing the list preserves the notice. Dismissing the notice collapses its space and moves the PDF upward. Dismissal applies to the same source version while the preview remains mounted; switching away from the tab and back shows the notice again. Long notice text fades before the action, and reduced-motion preferences disable the collapse animation.

<details>
<summary>Office implementation — click to expand</summary>

Office registration, loading, caching, and font notices live in `src/client/office/`. The Office body owns converted PDF bytes and font metadata, and declares a nested PDF slot that reuses the lazy PDF body and its tab viewing state. The notice sits above the Office scrollport. Registration remains available without the Host renderer; optional `remote.officeToPdf` and `remote.workspaceFiles` injections supply conversion and freshness callbacks, and their removal restores unavailable guidance. Registrations and tab retention follow effect lifetimes. The [conversion service](../../document/office-to-pdf/README.md) owns the Host Remote methods, mounted by `api/remotes`.

The shared `documentFileBytes()` helper decodes ordinary file and converted PDF responses into one owned byte buffer without expanding bytes into JavaScript array elements. Renderers borrow retained bytes read-only and copy them before Worker transfer.

</details>

<a id="navigation"></a>
## Navigation

`ctx.sidebarRight.openResource(address, { params: { line } })` carries a 1-based source line through the `file` parameters. In `text-pages` mode, the owner loads sequential pages until that line or EOF. Plain-text and code renderers expose source-line anchors; Markdown does not. A navigation remains pending while its selected renderer has no anchor and runs if the user switches to plain text or code. Code navigation scrolls the inner source viewport directly. Byte-mode renderers do not consume source-line navigation. Each completed navigation revision is answered once. Opening the same file without `revealIfOpened: false` focuses its existing tab and delivers a new revision.

<a id="model-experience"></a>
## Model Experience

None, as the preview is a browser-only viewer that registers no tool, prompt section, or session event.

#### KV Cache effect

No direct effect; what the user reads here never enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Preview, not editing.** The viewers provide no file editing or shared search interface; a directory address fails with `not-regular-file`. Unknown extensions use the plain-text reader and remain subject to its UTF-8/NUL checks.
- **Office conversion limits.** The preview does not launch native Office editors or download an engine. Binary `.doc`, `.xls`, and `.ppt` files return no missing-font diagnostics. Conversion fidelity and resource limits belong to the [LibreOffice provider](../../document/office-to-pdf/README.md).
- **Sequential text and bounded complete files.** Deep source lines require the preceding pages; PDF, HTML, and images require a complete result within the Host's `maxFileBytes` cap.
- **Byte-view scroll state is not restored.** PDF, HTML, and images can return to the top when their renderer remounts or reloads; images fit the pane's width and never scroll horizontally, and HTML iframe scrolling belongs to its opaque browsing context.
- **Finite local HTML dependencies.** Only direct classic `.js` and stylesheet `.css` references are packed. Browser-resolved resources retain browser origin and network restrictions; no runtime file-read bridge is exposed to the iframe.
- **Package-local wrap glyphs.** `IconWrapFill16` and `IconNowrapFill16` live in `src/client/icons.tsx` until the shared icon set carries them; their props already match the shared icon contract.
- **Scroll writes are unthrottled.** Every scroll event records its offset in the store; the line blocks are memoized so the resulting re-render hands React the same elements back.
- **A failed PDF chunk load requires a page reload.** React caches a rejected lazy import for the page lifetime; ordinary PDF open or render failures remain retryable inside the loaded body.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Renderer metadata, document loading, and view state belong to the local registry and declared Slot stores, with no independent runtime source to compare against; registration disposal and tab lifetimes are covered by behavior tests.

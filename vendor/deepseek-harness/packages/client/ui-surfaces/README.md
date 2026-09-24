# @deepseek-ai/dsh-client-ui-surfaces

English | [中文](README.zh.md)

The original DSHD right-panel shell. This package registers `SurfacesRoot` in the layout's `surfaces` column with the original top tab strip, empty picker, persisted tabs, and file drafts. Files, Browser, Terminal, Diff, and Agents register their bodies under `surfaces.*`. The [DSHD restoration decision](../../../../../docs/decisions/implemented/product/2026-09-23-right-sidebar-dshd-guide.md) owns the visual choice.

When the pinned Workspace Controller lacks `openPath`, this package first installs a Host-RPC-backed base method, then wraps it. On desktop the wrapper resolves the originating Session (an explicit Chat `sessionId`, otherwise the retained main-view Session). A workspace root opens Files, an ordinary file opens its DSHD file tab with an optional line reveal, and `.html`, `.htm`, `.xhtml`, and `.pdf` also open the token URL in Browser. Paths without a known cwd, non-desktop paths, and out-of-workspace paths use the base Host operation.

Opening the classic panel collapses the native Sidebar. Native resources exclusive to that Sidebar can still open it; its presentation closes the classic track, so only one right panel is visible. The titlebar button controls the classic track. The `/client` export includes the plugin body, store, surface types, and availability probe.

## Model Experience

None; the panel and file navigation do not reach a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- A Session without a cwd uses the Host path opener until the DSHD file surface supports absolute addresses.

# @deepseek-ai/dsh-client-ui-surfaces

English | [中文](README.zh.md)

Desktop navigation adapter: the visible right panel is `@deepseek-ai/dsh-client-ui-sidebar-right`. This package registers no `surfaces` occupant and publishes no empty state; at apply it synchronously calls `ctx.layout.closeSurfaces()` so a persisted legacy width cannot create a second column, then wraps `workspaces.openPath`. Contract: the [single visible right sidebar decision](../../../docs/decisions/proposed/architecture/2026-09-22-single-visible-right-sidebar.md).

When the pinned Workspace Controller lacks `openPath`, this package installs a Host-RPC-backed base method before wrapping it. On desktop the wrapper resolves the originating Session (an explicit Chat `sessionId`, otherwise the retained main-view Session) and routes into the native Sidebar: the root opens its Files page, ordinary files open through `sidebarRight.openResourceIn(sessionId, fileAddressFor(...))` with a line carried as `{ params: { line } }`, and `.html`, `.htm`, `.xhtml`, and `.pdf` keep that file resource before awaiting `previewWorkspaceFile` and opening the token URL in the Sidebar Browser. When the Sidebar service is absent, or the target Session has no adopted store and no matching live binding, the original Host opener runs. Once a Sidebar target is selected, a navigation exception propagates instead of silently changing route. Non-desktop or out-of-workspace paths use the base Host operation.

The dormant `surfaces.*` slot declarations and their owner-prop types stay in this package only so the upstream layout contract and the fork packages still type-check; nothing registers into them and no UI renders. The `/client` surface exports the plugin body (`apply`/`inject`) and `desktopListingAvailable` only.

## Model Experience

None, as this adapter only routes opens into the right Sidebar; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The legacy shell is retired** — Files, Diff, Browser, and Agents own their native `ui-sidebar-right` tab types in their own packages. The dormant slot declarations exist for compatibility only.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its routing behavior.

# Decision: One visible right Sidebar on Desktop

Status: proposed

[中文](2026-09-22-single-visible-right-sidebar.md) | English

## Problem

The Desktop app mounts two right panels at once: upstream's `ui-sidebar-right` (owning the layout `rightbar` track) and the desktop fork's `ui-surfaces` (owning the `surfaces` track). `ui-layout/AppFrame.tsx` is a four-column shell — `sidebar | center | rightbar | surfaces` — and each right track has its own width state, resize handle, and opening API, with no mutual-exclusion rule, so both are visible together.

The visible result: a chat file click only reaches `ui-sidebar-right`, while the far-right `ui-surfaces` empty-state card wall ("打开一个面板") remains. This is not a routing defect; the right-panel migration stopped halfway, with the new `ui-sidebar-*` family and the old `ui-surfaces` + `ui-files` / `ui-preview` / `ui-diff` / `ui-agents-panel` mounted together.

Documentation had drifted too: `ui-sidebar-right` calls itself "The right Sidebar" and current file/navigation work targets it, while `docs/design-language.md` still froze the old `ui-surfaces/EmptyState` square-tile geometry as the right-panel design contract.

## Proposal

Desktop shows exactly one visible right panel, and `@deepseek-ai/dsh-client-ui-sidebar-right` is its sole presentation owner. Upstream's `surfaces` track stays as a **dormant compatibility seam**: source, slots, width state, and APIs remain in place, while the Desktop composition holds it at zero width with no occupant.

- `ui-sidebar-right`'s guide becomes the only empty/start page and exposes five Desktop entries: Files | Terminal | Browser | Diff | Agents. Existing native rightbar resource tabs (Document Preview, changes review, and so on) remain in that same tab/dock domain.
- The five former occupants move into `ui-sidebar-right`'s type registry as `priority: 'extension'` overrides rather than nesting the old `ui-surfaces` shell inside a rightbar tab:
  - Files: `ui-files` registers a Desktop files page and a `dsh-resource://file/**` resource view, preserving search, edit/save, context menu, add-to-chat, line reveal, native floating preview, and draft persistence; `ui-sidebar-files` / `ui-sidebar-documentpreview` stay the non-Desktop builtins.
  - Browser: `ui-preview` registers a Desktop `browser` type, preserving BrowserView IPC, URL/history, and `dshd mini-player`; `ui-sidebar-browser` stays the builtin iframe implementation.
  - Terminal: keep the existing `ui-sidebar-terminal`; `ui-user-terminal` keeps only its conversation-column drawer, and local URLs open the rightbar Browser.
  - Diff / Agents: `ui-diff` and `ui-agents-panel` register rightbar page types instead of `surfaces.*` occupants.
- `ui-surfaces` is demoted to a `workspaces.openPath` compatibility adapter: it registers no `surfaces` slot, no occupant, and no empty state; at assembly it synchronously zeroes the legacy `surfaces` width and keeps the current session-scoped `sidebarRight.openResourceIn/openTabIn` routing.
- The titlebar right-panel button and `Ctrl+\` call `ctx.sidebarRight.toggleExpanded()`, with pressed state read from `rightbarShown`; the persisted key `surfacesToggle` survives as a compatibility key for this release.

Upstream-maintenance constraint: shared-upstream files may change only in two tiny increments plus one generic seam — `TitlebarTrailingOwnerProps` in `ui-layout/src/client/index.ts` gains `rightbarShown: boolean`, `ui-layout/src/client/AppFrame.tsx` forwards it to `shell.titlebar.trailing`, and `ui-sidebar-documentpreview/src/client/document/actions.ts` adds the platform-neutral `sidebar.right.tab.document.actions` list slot rendered by `TextPreview.tsx`'s document header. That seam carries no Electron API, scratch policy, or Desktop copy, and the header is unchanged with no registrant. `columns.ts`, `stores.ts`, `service.ts`, `persist.ts`, and `packages/bundle/web-app/cordis.patch.yml` receive no change from this decision.

Native floating preview is an explicit deliverable: the Desktop file view and the builtin Document Preview reach one Desktop-owned `ui-files` action; it accepts `{ cwd, relativePath }` and cwd-less `{ absolutePath }`, requires `result.ok === true`, and turns refusal, crash, or malformed response into a localized error while leaving the Sidebar usable — never falling back to the OS opener, `workspaces.openPath`, or a Browser tab. Main uses a preview-scoped `loadWorkspaceAuthority({ allowScratchCwd: true })` and a bounded read-only adapter, so text and HTML in the Host scratch directory can be previewed without broadening ordinary read/write IPC authority.

## Alternatives considered

- **Hide the `ui-surfaces` empty state only (CSS, or auto-close when the rightbar opens)** — rejected: two owners and two reopenable tracks remain, so the defect returns; it also violates the existing one-owner-per-capability convention.
- **Rewrite `ui-layout` as three columns, deleting the `surfaces` slot, width state, and APIs** — rejected: that is upstream architecture, and deleting it yields no Desktop-visible benefit while producing a large conflict on every upstream sync; leaving the upstream track at zero width achieves the same product outcome.
- **Move all seven Desktop client packages from `web-app/cordis.patch.yml` to a runtime overlay** — rejected: the `--patch` overlay mechanism suits new independent runtime plugins; these packages are already referenced by the shipped Web composition, the source build dependency graph, the `DESKTOP_PACKAGES` resolver check, and packaged-runtime verification. Moving them requires separately proving source-build discovery, packaged-artifact resolution, and the `--skip-user-plugins` recovery path — an independent composition-hardening task that should not be combined with this de-duplication.
- **Nest the whole old `ui-surfaces` shell inside one rightbar tab** — rejected: that stacks two tab semantics, keeps the old occupants' `surfaces.*` contract alive, and prevents future upstream improvements from landing normally under the builtin implementations.

## Acceptance criteria

- After Desktop assembly, `ui-sidebar-right` is the only visible right panel; the `surfaces` track is always zero width with no occupant.
- Chat file chips, the workspace root, and browser documents all open in the originating Session's right Sidebar; only a missing Sidebar or an unadopted Session falls back to the Host, and a failure after a Sidebar target was selected must surface explicitly.
- The `ui-titlebar` right-panel button and `Ctrl+\` both call `sidebarRight.toggleExpanded()`, with pressed state from `rightbarShown`.
- The Floating preview action in the unified Sidebar document header opens one native read-only always-on-top window for known-cwd and cwd-less absolute targets; failures are visible and never fall back to the OS opener or a Browser tab.
- Gates: `npm run check:governance`, `npm run doc-sync`, focused package vitest, `tsc -b`, `build:official`, and the Electron smoke all pass.

## Risks

- The few shared changes in upstream `ui-layout` and `ui-sidebar-documentpreview` need manual adjudication at the next `sync:harness`; `FORK_FILE_MARKERS` and the `single-right-panel-contract` test catch early regressions.
- If any Desktop capability was not truly moved to the Sidebar before the old shell retired, it disappears at runtime; the per-package registration tests and the Electron smoke are the release gate.
- Broadening native floating-preview authority would widen the main-process read surface; the preview-scoped authority contains only the existing Host scratch root and ordinary read/write IPC authority is unchanged.

## Consequences

Desktop has exactly one visible right panel: `ui-sidebar-right`. File clicks, the guide's Files/Browser/Diff/Agents entries, and Terminal all open inside `[data-rightbar-col]`; `Ctrl+\` and the titlebar icon toggle that same panel; the far-right empty state no longer exists.

Desktop-only Files/Browser capabilities survive through `priority: 'extension'` overrides of the builtins; if upstream later improves the builtin versions, both can coexist in the registry without kind collisions. Unsaved file drafts in the legacy `dsh-surfaces:v1:<sessionId>` keys are imported once into the rightbar file store before the old shell retires, and a legacy key is removed only after every selected draft was committed successfully; malformed or oversized data is ignored exactly as before.

The upstream `surfaces` composition row, slot declaration, and compatibility APIs remain but are unused by any Desktop production code, guarded by a contract test and fork markers: any Desktop package that registers into `surfaces` / `surfaces.*` or calls `openSurfaces` / `toggleSurfaces` fails the build. The file-click route is fixed: chat chip → unified Sidebar file/document tab → explicit Floating preview → one native read-only window; DockKit's in-page float and the Browser mini-player remain two different concepts. The next upstream sync is expected to need manual adjudication for the two small `ui-layout` additions and the generic document-action seam.

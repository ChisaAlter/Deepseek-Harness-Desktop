# Decision: Desktop Office runtime composition

Status: implemented

[中文](2026-09-25-desktop-office-runtime.md) | English

## Problem

Upstream 0.1.7-rc.2's Office capability composes four pieces: `dsh-tool-workspace-dependencies` (atomic install of the locked Python/Node/pnpm payload), `dsh-skill-office` (DOCX/PPTX/XLSX skills + the `check_office.py` assets), `libreoffice-kit@0.1.1` plus the `win32-x64` native engine (DOC/PPT/XLS conversion and CLI rendering), and `ui-sidebar-documentpreview` (Office→PDF and Spreadsheet presentation). The official `apps/desktop-host` supplies absolute `source/assetRoot/node/cli` at startup and ships `primary-runtime`/`office-skills` as packaged resources. Whale Isle composes a Node Web profile on its own rather than riding the Desktop Host, so vendored packages alone do not activate the capability: without overlay rows the plugins never mount, without the payload there is no Node/Python, and without yielding the desktop-file claim Office binaries land in the generic FilePreview as unreadable blobs.

## Decision

Four desktop-owned seams, all riding the existing overlay system:

1. **`src/main/office-runtime.js`**: locates the bundled payload (dev=`build/office-runtime`, packaged=`resources/runtime`), validates `runtime.json` (platform/arch/payloadDigest must match), the standalone `node.exe`, and `office-skills` (`check_office.py` plus three SKILL.md files), then anchors Node module resolution at `dsh-skill-office` to find the real `libreoffice-kit/lib/cli.js` — win32-x64 hard-validates the native engine package (version/status/platform/executable), no silent WASM fallback. It emits `desktop-plugins/office/desktop-office.patch.yml` (atomic write) with two insert rows: `workspace-dependencies` (source + `dsh-home/dsh-runtimes/dsh-primary-runtime` as root; the plugin owns staging→validate→atomic install) and `skill-office` (assetRoot/node/cli). `DSH_PRIMARY_RUNTIME` overrides the whole directory and an empty string opts out (upstream carrier semantics); `spawnEnv` additionally declares `DSH_BUNDLED_PRIMARY_RUNTIME` to every `dsh web` child.

2. **The overlay rides every start** (full + skip-user-plugins): Office is desktop built-in, the disable list never applies; a missing payload or incomplete closure is runtime damage under packaged builds and fails the start, while dev builds only warn and stay bootable.

3. **Packaging closure**: `build/office-runtime → resources/runtime` via extraResources; `prepare:office-runtime` drives upstream's locked `prepare.ts` (SHA-256-pinned archives) to produce the payload; `assertOfficeRuntime` (win32 targets) pins the payload plus the `dsh-office-to-pdf`/`dsh-skill-office`/`workspace-dependencies`/`libreoffice-kit`/`libreoffice-kit-win32-x64` closure and engine-manifest consistency — a missing piece fails the build. The skip-compose contract asserts both rows exactly once in both rounds.

4. **Preview routing**: the `desktop-file` tab type (extension-priority band) declines `doc/docx/ppt/pptx/xls/xlsx`, letting the `text` fallback claim them so documentpreview's Office→PDF/Spreadsheet renderers take over; `ui-surfaces`' `openFile`/`openInSurfaces` likewise hand binary Office paths to `sidebarRight.openResourceIn` (auto-expanding the column, exclusively closing surfaces). csv/tsv intentionally stay on the editable text view (a desktop enhancement — upstream `binaryExtensions` never included them).

## Alternatives considered

- **Rely on the sdk-app patch's env-gated rows**: those rows live in `sdk-app`'s patch, not the web profile, and carry no explicit `cli`/`root` config — neither dev nor packaged roots resolve correctly; rejected.
- **Always inject `DSH_PRIMARY_RUNTIME` into the shell env**: breaks the empty-string opt-out semantics (inherited env already passes user overrides through); `DSH_BUNDLED_PRIMARY_RUNTIME` is declared only when unset.
- **Mount the Office rows inside `cordis.patch.yml`**: violates user-layer ownership; the overlay layer is the established path for all built-in rows.
- **A literal new "Office content slot" API in ui-files per the plan**: the existing resource registry is already that slot — `patterns`/`canOpen` resolution plus `openResourceIn(sessionId, address)` passes the owning Session and normalized address props-only, and documentpreview's Office/Spreadsheet renderers already inject through it; a parallel slot API would only duplicate that protocol, so the `canOpen` decline + `text` fallback stands and no cross-feature interface is added.
- **Route csv/tsv to the read-only Spreadsheet too**: loses the desktop-file editable-text capability; the matrix pins XLSX→Spreadsheet only, so the current split stays and is recorded.

## Consequences

- On first use `load_workspace_dependencies` installs the payload atomically into `dsh-home/dsh-runtimes/dsh-primary-runtime`; a failed install keeps the old tree and never touches sessions or the profile.
- The three skills (office-docx/pptx/xlsx) are visible in the web profile; `check_office.py` and the standalone Node resolve inside the payload — PATH is never consulted.
- Kit 0.1.1 + win32-x64 native resolution and version consistency are verified at three layers: dev ensure, the pack-time assert, and the skip-compose contract; a stale 0.0.1 runtime cannot be accepted.
- Non-win32 targets ship no Office payload yet (assert is gated off; the limitation is recorded on the feature card).
- Coverage: `office-runtime.test.js` 13 cases (candidates/manifest/kit engine/overlay stability/packaged path), harness-controller 3 cases (block/both-start mounting/explicit opt-out), one or two vendored specs in `ui-files`/`ui-surfaces`; three fork markers registered.

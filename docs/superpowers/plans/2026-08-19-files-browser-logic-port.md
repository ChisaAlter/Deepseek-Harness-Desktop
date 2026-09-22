# Files + Browser logic port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Current checkout — do not create a worktree unless the user asks. Steps use checkbox (`- [ ]`) syntax. Do **not** commit unless the user asks.

**Goal:** Replace the thin Files / Browser work-loop rewrites with the reference behaviors, rebranded as `dshd`. Every Files/Preview method ships and works; the only skip is an import that would crash the app or disable an already-working related feature — in that case change the wiring, do not drop the capability.

**Architecture:** Copy helpers into `ui-files` / `ui-preview` / `src/main`. Peel Effect/Atom/Schema to `Promise` + `{ ok: boolean }` + `window.shell`. Guest is a main-process `BrowserView` with the same picker posture as the reference (`contextIsolation: false`, `sandbox: true`, `nodeIntegration: false`). Chrome stays `ui-primitives` + `--dsw-alias-*` so official WebUI chrome keeps working. Strip every `t3code` / `T3-` / `@t3tools` / `persist:t3code-` marker from production source.

**Tech Stack:** Electron main (`workspace-fs.js`, `preview.js`), preload IPC, Harness client plugins (React + vitest/jsdom), node:test for main.

**Spec:** `docs/superpowers/specs/2026-08-19-files-browser-logic-port-design.md`

## Global Constraints

- Official `dsh web` tokens / `ui-primitives` only in the slot tree. Do not add `@pierre`, lucide, shadcn, Tailwind, Effect, or `@t3tools` as dependencies (that disables official chrome). Port the **behaviors** onto existing primitives.
- Product copy Chinese in `locales.ts`; English keys in lockstep (`satisfies Record<Key, string>`).
- Rebrand table (verbatim): `persist:dshd-preview-` + sha256(scope).slice(0, 20); MIME `application/x-dshd-composer-mention`; localStorage `dshd.fileExplorerOpen` / `dshd.renderMarkdown` / `dshd.fileWordWrap`; comments English; no `t3code` / `T3-` / `@t3tools` in `src/` or `vendor/deepseek-harness/packages/`.
- Guest BrowserView: `contextIsolation: false`, `sandbox: true`, `nodeIntegration: false` (picker / react-grab). Harness **main window** stays `contextIsolation: true`.
- Address bar follows `normalizePreviewUrl`: bare loopback → `http`, bare public host → `https`. Guest documents may be any http(s). Harness **main window** loopback wall stays.
- Keep dshd extras: dirty-tab Keep/Discard/Save, `error.changed`, `previewHide` / `occluded`, token workspace file server.
- No silent drops. No fake buttons. No “cannot port” list. If an import would crash or disable a related live feature, change the wiring (IPC instead of WS, attach instead of `registerWebview`, textarea instead of Pierre) and still ship the capability.
- Do not commit unless the user asks.
- TDD: failing test first; watch RED; minimal production code; GREEN.
- Work on the current workspace, not a worktree.
- Reference sources live at `C:\Ai\t3code` (read-only). Never import that tree at runtime.
- Client plugins: no new public value exports without user sign-off. Tests import internals via relative `../src/client/…`. Repeat MIME / event strings in each package (slot rule).

## Wiring changes (capability stays)

These are **not** out of scope. They are the only places the import path changes so the app does not crash and live features stay usable.

| Reference import | dshd wiring |
|---|---|
| Effect `PreviewManager.ts` | `webContents.*` on the existing BrowserView in `preview.js` |
| `registerWebview` | `attach()` already holds `webContents`; do not invent a renderer webview id |
| Preview WS `preview.open/list/reportStatus/automation.*` | Same names on `shell:preview-*` IPC (single window, no extra WS server) |
| `@pierre` / lucide / shadcn JSX | `FileTree` / `Menu` / textarea / `--dsw-alias-*` |
| Atom `projectFilesQueryState` | `listDir` + `readFile` + `fileContentRevision` |
| `detectComposerTrigger` `/` branch | Leave Harness `ui-commands` in charge of `/`; port `@` and `$` only |
| Pierre `diffs-container` dismissal | Same outside-click / Escape on the Files `textarea` |
| Pierre line annotations | Selection range helpers + composer insert; no `@pierre/diffs` |

## File map

**Files (new, package-internal):**

- `vendor/deepseek-harness/packages/client/ui-files/src/client/composerMention.ts` — serializers, MIME, `detectComposerTrigger` (`@` / `$` only)
- `vendor/deepseek-harness/packages/client/ui-files/src/client/fileSaveCoordinator.ts` — debounce persist; `{ ok: boolean }`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/filePath.ts` — `fileBreadcrumbs`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/filePreviewMode.ts` — `isMarkdownPreviewFile`, `setMarkdownTaskChecked`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/fileContentRevision.ts`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/fileLineReveal.ts` — `resolveCenteredFileLineScrollTop`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/filePreview.ts` — html/pdf vs image extension sets
- `vendor/deepseek-harness/packages/client/ui-files/src/client/fileTreeDragMention.ts`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/fileEditorDismissal.ts`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/fileCommentAnnotations.ts`
- `vendor/deepseek-harness/packages/client/ui-files/src/client/projectFilePicker.ts` — `getProjectFilePickerMatches` + `normalizeSearchQuery`
- `src/main/editors.js` — `EDITORS` table (no Effect Schema) + `openInEditor` / `listAvailableEditors` / `showItemInFolder`

**Files (modify):** `apply.ts`, `FileTree.tsx`, `FilePreview.tsx`, `FilesPanel.tsx`, `filter.ts`, `locales.ts`, `FilePreview.module.css`, README pair, tests.

**Host Files:** `src/main/workspace-fs.js` + `.test.js` — 1 MiB, mkdir, gitignore hide.

**Surfaces / terminal:** `stores.ts` (`revealLine`, `revealRequestId`), `apply.ts` (`openFile` options + `.pdf` in `BROWSER_DOCUMENTS`), `FileOwnerProps`, `ui-user-terminal` `resolveOpenPath` keep line and pass it through intercept.

**Conversation:** `InputBar.tsx` drop handler for `application/x-dshd-composer-mention` (string repeated, not imported).

**Primitives (optional callback only):** `MarkdownText` / `render.tsx` — checkboxes stay `disabled` unless `onTaskChecked` is passed.

**Browser (new/modify):**

- `ui-preview/src/client/url.ts` — `normalizePreviewUrl` family
- `ui-preview/src/client/zoom.ts` — `ZOOM_LEVELS`, `nextZoomLevel`
- `ui-preview/src/client/viewport.ts` — copy `browserViewportLayout.ts` (fill vs preset vs freeform)
- `src/main/preview-url.js` — CJS twin of `url.ts`
- `src/main/preview-session.js` — partition hash, permissions, UA strip
- `src/main/preview-guest-preload.js` — peeled `PickPreload.ts` (dshd CSS vars, dshd IPC channels)
- `src/main/preview-pip-preload.js` — peeled PiP preload, `contextIsolation: true` on the PiP window
- `src/main/preview.js` — http(s), IPC including pick / PiP / record / screenshot / automation / viewport bounds
- preload + `shell-api.test.js` + `ui-preview` shell/locales/PreviewPanel

**Docs:** update work-loop Agent Note in place; add `2026-08-19-files-browser-logic-port` triplet; READMEs describe shipped behavior (not a cannot-port dump).

## Task graph

```text
Files track (1→8, 16–18)
  1 mention serialize ── 5 mention + drag + composer drop ── 18 @path/$skill
  2 FileSaveCoordinator ── 6 FilePreview autosave
  3 path/mode/revision/reveal/extensions ── 6, 7
  4 workspace-fs ── 6, 17 picker matches
  7 surfaces revealLine ── terminal keep :line
  8 search uncap
  16 dismissal + line comments into composer
  17 project file picker matches + open-in-editor / folder

Browser track (9→14, 19–22)
  9 preview-url ── 11 guest policy (isolation false + sandbox true)
  10 COMMON_DEV_PORTS
  11 partition/permissions/UA/http(s)/guest preload
  12 IPC hardReload/zoom/scheme/cookies/stop/fail/screenshot
  13 More menu (includes PiP + device toolbar + record + pick)
  14 pdf dual-open
  19 device toolbar setBounds
  20 pick overlay + annotation theme
  21 PiP window + capturePage frames
  22 recording + automation* + artifacts

23 Agent Note + brand grep last
```

---

### Task 1: Composer mention serializers (`dshd` MIME)

**Files:**

- Create: `vendor/deepseek-harness/packages/client/ui-files/src/client/composerMention.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-files/tests/composer-mention.client.spec.ts`

**Interfaces:**

- Consumes: nothing
- Produces:

```ts
export const COMPOSER_MENTION_DRAG_TYPE = 'application/x-dshd-composer-mention'
export function serializeComposerMentionPath(path: string): string
export function serializeComposerFileLink(path: string): string
export function composerMentionFromTreePath(treePath: string): string | null
export function dataTransferHasComposerMention(types: readonly string[]): boolean
```

Copy function bodies from `C:\Ai\t3code\packages\shared\src\composerTrigger.ts` (`serializeComposerMentionPath` / `serializeComposerFileLink` only — do not copy `detectComposerTrigger`) and `C:\Ai\t3code\apps\web\src\components\chat\composerMentionDrag.ts` (`composerMentionFromTreePath`). Replace `application/x-t3code-composer-mention` with `application/x-dshd-composer-mention`. Do not copy Effect or `@t3tools` imports.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MENTION_DRAG_TYPE,
  composerMentionFromTreePath,
  serializeComposerFileLink,
  serializeComposerMentionPath,
} from '../src/client/composerMention.ts'

describe('serializeComposerMentionPath', () => {
  it('keeps simple mention paths unquoted', () => {
    expect(serializeComposerMentionPath('src/index.ts')).toBe('src/index.ts')
  })
  it('quotes mention paths containing whitespace', () => {
    expect(serializeComposerMentionPath('docs/My File.md')).toBe('"docs/My File.md"')
  })
  it('escapes quoted mention path content', () => {
    expect(serializeComposerMentionPath('docs/My "File".md')).toBe('"docs/My \\"File\\".md"')
  })
})

describe('serializeComposerFileLink', () => {
  it('uses the basename as the markdown label', () => {
    expect(serializeComposerFileLink('path/to/package.json')).toBe(
      '[package.json](path/to/package.json)',
    )
  })
  it('encodes markdown-sensitive destination characters', () => {
    expect(serializeComposerFileLink('docs/My File (draft).md')).toBe(
      '[My File (draft).md](docs/My%20File%20%28draft%29.md)',
    )
  })
  it('supports windows paths', () => {
    expect(serializeComposerFileLink('C:\\repo\\src\\index.ts')).toBe(
      '[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)',
    )
  })
  it('preserves paths that legitimately start with an at sign', () => {
    expect(serializeComposerFileLink('@scope/package.json')).toBe(
      '[package.json](@scope/package.json)',
    )
  })
})

describe('composerMentionFromTreePath', () => {
  it('serializes a relative tree path as a markdown file link', () => {
    expect(composerMentionFromTreePath('src/a.ts')).toBe('[a.ts](src/a.ts)')
  })
  it('returns null for empty or slash-only paths', () => {
    expect(composerMentionFromTreePath('')).toBeNull()
    expect(composerMentionFromTreePath('///')).toBeNull()
  })
  it('uses the dshd mention MIME', () => {
    expect(COMPOSER_MENTION_DRAG_TYPE).toBe('application/x-dshd-composer-mention')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (cwd `vendor/deepseek-harness`): `pnpm --filter @deepseek-ai/dsh-client-ui-files exec vitest run tests/composer-mention.client.spec.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Paste the serializer bodies. `composerMentionFromTreePath` strips trailing `/`, then `serializeComposerFileLink`.

- [ ] **Step 4: Run tests and make sure they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit** — skip unless the user asks.

---

### Task 2: `FileSaveCoordinator` (peel AtomCommandResult)

**Files:**

- Create: `vendor/deepseek-harness/packages/client/ui-files/src/client/fileSaveCoordinator.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-files/tests/file-save-coordinator.client.spec.ts`

**Interfaces:**

- Consumes: nothing
- Produces:

```ts
export interface FileSaveResult { ok: boolean }
export interface FileSaveCoordinatorOptions {
  readonly debounceMs: number
  readonly persist: (contents: string) => Promise<FileSaveResult>
  readonly onPendingChange: (pending: boolean) => void
  readonly onConfirmed: (contents: string) => void
}
export class FileSaveCoordinator {
  constructor(options: FileSaveCoordinatorOptions)
  change(contents: string): void
  dispose(): void
}
```

Copy control flow from `C:\Ai\t3code\apps\web\src\components\files\fileSaveCoordinator.ts`. Replace `result._tag === "Success"` with `result.ok === true`. Default `debounceMs` at call sites is `500`. No `@t3tools` types.

- [ ] **Step 1: Write the failing test** (fake timers; three cases from the reference: debounce latest only; overlapping write keeps pending; failed write stays pending)

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileSaveCoordinator } from '../src/client/fileSaveCoordinator.ts'

function deferred() {
  let resolve!: (result: { ok: boolean }) => void
  const promise = new Promise<{ ok: boolean }>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('FileSaveCoordinator', () => {
  afterEach(() => { vi.useRealTimers() })

  it('debounces edits and persists only the latest contents', async () => {
    vi.useFakeTimers()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true })
    const onPendingChange = vi.fn()
    const onConfirmed = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange, onConfirmed,
    })
    coordinator.change('first')
    await vi.advanceTimersByTimeAsync(300)
    coordinator.change('latest')
    await vi.advanceTimersByTimeAsync(499)
    expect(persist).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(persist).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledWith('latest')
    expect(onConfirmed).toHaveBeenCalledWith('latest')
    expect(onPendingChange.mock.calls).toEqual([[true], [true], [false]])
  })

  it('keeps pending state until an edit made during a write is also saved', async () => {
    vi.useFakeTimers()
    const firstWrite = deferred()
    const persist = vi.fn<(contents: string) => Promise<{ ok: boolean }>>()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce({ ok: true })
    const onPendingChange = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500, persist, onPendingChange, onConfirmed: vi.fn(),
    })
    coordinator.change('first')
    await vi.advanceTimersByTimeAsync(500)
    coordinator.change('latest')
    await vi.advanceTimersByTimeAsync(500)
    expect(persist).toHaveBeenCalledTimes(1)
    firstWrite.resolve({ ok: true })
    await vi.runAllTimersAsync()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenLastCalledWith('latest')
    expect(onPendingChange.mock.calls.at(-1)).toEqual([false])
  })

  it('leaves the file pending when the latest write fails', async () => {
    vi.useFakeTimers()
    const onPendingChange = vi.fn()
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      persist: vi.fn().mockResolvedValue({ ok: false }),
      onPendingChange,
      onConfirmed: vi.fn(),
    })
    coordinator.change('latest')
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    expect(onPendingChange).toHaveBeenCalledWith(true)
    expect(onPendingChange).not.toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @deepseek-ai/dsh-client-ui-files exec vitest run tests/file-save-coordinator.client.spec.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — copy the class; `succeeded = result.ok`.

- [ ] **Step 4: GREEN** with the same command.

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 3: Path crumbs, markdown mode, revision, line reveal, preview extensions

**Files:**

- Create: `filePath.ts`, `filePreviewMode.ts`, `fileContentRevision.ts`, `fileLineReveal.ts`, `filePreview.ts` under `ui-files/src/client/`
- Tests: `file-path.client.spec.ts`, `file-preview-mode.client.spec.ts`, `file-content-revision.client.spec.ts`, `file-line-reveal.client.spec.ts`, `file-preview-ext.client.spec.ts`

**Interfaces:**

- Produces:

```ts
export type FileBreadcrumb = { label: string; path: string; kind: 'project' | 'directory' | 'file' }
export function fileBreadcrumbs(projectName: string, relativePath: string): FileBreadcrumb[]
export function isMarkdownPreviewFile(path: string): boolean // /\.(?:md|mdx)$/i
export function setMarkdownTaskChecked(markdown: string, markerOffset: number, checked: boolean): string
export function fileContentRevision(contents: string): string
export function projectFileCacheKey(cwd: string, relativePath: string, contents: string): string
export function projectFileEditorCacheKey(
  environmentId: string, cwd: string, relativePath: string, contents: string,
  editorFile: { cacheKey?: string; contents: string } | undefined,
): string
export function resolveCenteredFileLineScrollTop(input: {
  scrollTop: number; scrollHeight: number; viewportTop: number; viewportHeight: number
  fileTop: number
  estimatedLine: { top: number; height: number }
  renderedLine?: { top: number; height: number }
}): number
export const WORKSPACE_BROWSER_PREVIEW_EXTENSIONS = ['.htm', '.html', '.pdf'] as const
export const WORKSPACE_IMAGE_PREVIEW_EXTENSIONS = ['.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp'] as const
export function isWorkspaceBrowserPreviewPath(path: string): boolean
export function isWorkspaceImagePreviewPath(path: string): boolean
```

Copy bodies from `C:\Ai\t3code\apps\web\src\components\files\filePath.ts`, `filePreviewMode.ts`, `fileContentRevision.ts`, `fileLineReveal.ts`, and `C:\Ai\t3code\packages\shared\src\filePreview.ts`. Breadcrumb fixture uses project name `dshd` (not `t3code`).

- [ ] **Step 1: Write failing tests** matching those reference fixtures. Breadcrumbs:

```ts
expect(fileBreadcrumbs('dshd', 'apps/web/src/main.tsx')).toEqual([
  { label: 'dshd', path: '', kind: 'project' },
  { label: 'apps', path: 'apps', kind: 'directory' },
  { label: 'web', path: 'apps/web', kind: 'directory' },
  { label: 'src', path: 'apps/web/src', kind: 'directory' },
  { label: 'main.tsx', path: 'apps/web/src/main.tsx', kind: 'file' },
])
```

Line reveal: estimated → `830`; rendered correction → `1160` (same numbers as `fileLineReveal.test.ts`).

`setMarkdownTaskChecked('- [ ] x', 2, true)` → `'- [x] x'`; invalid offset returns the original string.

`isMarkdownPreviewFile('a.mdx') === true`; `isWorkspaceBrowserPreviewPath('x.pdf') === true`; `isWorkspaceImagePreviewPath('x.svg') === true`.

- [ ] **Step 2: RED** — modules missing.

- [ ] **Step 3: Copy implementations.** Strip any `t3code` in comments.

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 4: Host `workspace-fs` — 1 MiB, mkdir, gitignore

**Files:**

- Modify: `src/main/workspace-fs.js`
- Test: `src/main/workspace-fs.test.js`

**Interfaces:**

- Change `MAX_READ_BYTES` and `MAX_WRITE_BYTES` to `1024 * 1024`.
- `writeFile`: `fs.promises.mkdir(path.dirname(target), { recursive: true })` then write. Do **not** require the file to already exist.
- `listDir`: omit `.git`; if `git` is on PATH, hide paths that `git -C cwd check-ignore --no-index -q <rel>` exits 0 for. If git is missing, still hide `.git` only.
- Keep workspace-authority traversal rejects.

- [ ] **Step 1: Write failing tests** in `workspace-fs.test.js`:

```js
test('writeFile creates missing parent directories', async () => {
  const cwd = makeTempDir();
  try {
    const written = await writeFile(cwd, 'nested/new.txt', 'hi\n');
    assert.equal(written.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'nested', 'new.txt'), 'utf8'), 'hi\n');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('listDir hides gitignored names when git is available', async () => {
  const cwd = makeTempDir();
  try {
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'secret.txt\n');
    fs.writeFileSync(path.join(cwd, 'secret.txt'), 'nope');
    fs.writeFileSync(path.join(cwd, 'keep.txt'), 'yes');
    fs.mkdirSync(path.join(cwd, '.git'));
    const listed = await listDir(cwd, '');
    assert.equal(listed.ok, true);
    const names = listed.entries.map((e) => e.name);
    assert.equal(names.includes('.git'), false);
    assert.equal(names.includes('keep.txt'), true);
    if (names.includes('secret.txt')) {
      // git missing: ignore-file skip is best-effort; .git still hidden
    } else {
      assert.equal(names.includes('secret.txt'), false);
    }
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
```

Also bump any existing “too large” assertion from 512 KiB to 1 MiB if present.

- [ ] **Step 2: RED** — mkdir write fails with “Could not write file.”

- [ ] **Step 3: Implement.** Spawn `git` with `windowsHide: true`; treat spawn failure as “git missing”.

- [ ] **Step 4:** `node --test src/main/workspace-fs.test.js` GREEN.

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 5: Mention wiring, tree drag, composer drop

**Files:**

- Modify: `ui-files/src/client/apply.ts` — mention uses `serializeComposerFileLink`
- Modify: `ui-files/src/client/FileTree.tsx` — Copy mention menu; `draggable`; `data-item-path`; `createFileTreeDragMentionController`
- Create: `ui-files/src/client/fileTreeDragMention.ts` (copy from reference; import MIME from `composerMention.ts`)
- Modify: `ui-files/src/client/locales.ts` — `'copy.mention': '复制引用'` / `'Copy mention'`
- Modify: `ui-conversation/src/client/skeleton/InputBar.tsx` — if `dataTransfer.types` includes the **literal** `'application/x-dshd-composer-mention'`, `preventDefault` and insert `getData(...)` into the composer (do not import ui-files)
- Tests: `ui-files/tests/apply.client.spec.ts`, `files-panel.client.spec.tsx`, `ui-conversation/tests/input-bar.client.spec.tsx`

**Interfaces:**

- `mentionFile` still `(sessionId, relativePath) => void`; body becomes `appendToDraft(ctx, sessionId, serializeComposerFileLink(relativePath))`.
- Keep the row `@` **and** context “Copy mention” / “Mention in composer”. Copy mention writes the markdown link to clipboard via existing `writeClipboard`.
- Drag: `setData(COMPOSER_MENTION_DRAG_TYPE, mentions.join(' '))` plus `text/plain` fallback of the same string.

- [ ] **Step 1: Failing tests**

`apply.client.spec.ts`: spy `appendToDraft` or read conversation draft — `mentionFile('sess', 'docs/My File.md')` writes `[My File.md](docs/My%20File.md)` not `` `@docs/My File.md` ``.

`files-panel.client.spec.tsx`: context menu includes Copy mention; choosing it calls `writeClipboard` with the file link.

`input-bar.client.spec.tsx`: drop `{ types: ['application/x-dshd-composer-mention'], getData: () => '[a.ts](src/a.ts)' }` inserts that markdown into the composer. Image `Files` drop still works. A `t3code` MIME must **not** be handled.

- [ ] **Step 2: RED** — mention still uses backtick `@path`.

- [ ] **Step 3: Implement.** Copy drag controller; FileTree rows `draggable={entry.kind === 'file'}` and `data-item-path={entry.path}`. While `isDragInProgress()`, ignore selection-as-open (FileTree has no Pierre selection; skip `deselect` no-ops if unused).

- [ ] **Step 4: GREEN** those three specs.

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 6: FilePreview — autosave, crumbs, mdx, wrap, tasks, html globe

**Files:**

- Modify: `FilePreview.tsx`, `FilePreview.module.css`, `locales.ts`
- Modify: `ui-primitives` markdown render **only** if adding optional `onTaskChecked`; default path stays `disabled` so DOM fixtures do not change
- Tests: `files-panel.client.spec.tsx`, `ui-primitives/tests/markdown.client.spec.tsx` (optional callback)

**Interfaces:**

- On draft change call `coordinator.change(draft)` with `persist: async (text) => writeFile(...)` then existing conflict reread (`error.changed` still wins: if disk diverged, persist returns `{ ok: false }` and the coordinator stays pending). Explicit Save / Ctrl+S / close-dialog Save still call the same write path.
- Toolbar path label uses `fileBreadcrumbs(basename(cwd), relativePath)` (project crumb + segments). Clicking a directory crumb is out of scope (tree already lists dirs).
- `isMarkdownPreviewFile(relativePath)` for Source/Rendered. Persist `localStorage['dshd.renderMarkdown']` as `'1' | '0'`. Default `'0'` (source), matching the reference.
- Word wrap toggle: `localStorage['dshd.fileWordWrap']`; CSS `white-space: pre-wrap` vs `pre`. Tokens only.
- Rendered markdown: pass `onTaskChecked` that runs `setMarkdownTaskChecked` then `coordinator.change`. Conversation `MarkdownText` omits the callback.
- Tree click: if `isWorkspaceBrowserPreviewPath`, still `openFile` (source tab) **and** the surfaces intercept already dual-opens html; add `.pdf` in Task 14. FilePreview image set uses `isWorkspaceImagePreviewPath` (svg stays image in Files; Browser dual-open for svg remains `openPath`).

Keep: dirty-close dialog, `onDirtyChange`, buffer persist, no editor until first read.

- [ ] **Step 1: Failing tests**

Autosave: change textarea, `advanceTimers(500)`, `writeFile` called with latest text.

mdx: `notes.mdx` shows Source/Rendered toggle.

Word wrap: toggle sets `white-space: pre-wrap` on the textarea.

Task: FilePreview with `onTaskChecked` — click checkbox updates draft via `setMarkdownTaskChecked`. Conversation markdown spec: checkbox still `disabled` without the callback.

Breadcrumbs: toolbar contains project name (cwd basename) and `src` for `src/a.ts`.

- [ ] **Step 2: RED**

- [ ] **Step 3: Wire coordinator in FilePreview `useEffect`; dispose on unmount (flush).** Toolbar wrap/markdown keys. Optional MarkdownText prop: `onTaskChecked?: (markerOffset: number, checked: boolean) => void`. When set, `disabled={false}` on the task input and `onChange` finds the `[` offset of that GFM item (store `data-task-offset` on the checkbox at render time from the source index). If offset cannot be recovered, leave conversation fixtures unchanged and only enable the callback path when `data-task-offset` is present.

- [ ] **Step 4: GREEN** focused ui-files + markdown specs. Do not run full `test:gui` unless those fail for an unrelated reason you must note.

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 7: Jump-to-line (`revealLine` / `revealRequestId`)

**Files:**

- Modify: `ui-surfaces/src/client/stores.ts` — file surface `{ revealLine?: number; revealRequestId?: number }`
- Modify: `FileOwnerProps` + `SurfacesRoot` so `FilePreview` receives `revealLine` + `revealRequestId`
- Modify: `openFile(sessionId, relativePath, options?: { revealLine?: number })` increments `revealRequestId` when line is set
- Modify: `ui-files FilePreview.tsx` — `clampFileLine`, scroll via `resolveCenteredFileLineScrollTop` using textarea line height (`estimatedLine.top = (line - 1) * lineHeight`)
- Modify: `ui-user-terminal/src/client/links.ts` + `apply.ts` — **keep** `:line`; pass line into intercept
- Modify: `openpath-intercept.ts` — `openPath(path: string, options?: { line?: number })`; extra arg ignored when falling through to OS
- Tests: `ui-surfaces` store/openPath specs; `ui-files` FilePreview scroll; `ui-user-terminal` `resolveOpenPath` / apply

**Interfaces:**

```ts
openFile: (draft, sessionId, relativePath, options?: { revealLine?: number }) => void
```

Copy `clampFileLine` from the reference `FilePreviewPanel` (1-based, clamp to line count).

- [ ] **Step 1: Failing tests**

Store: `openFile(s, 'sess', 'a.ts', { revealLine: 12 })` sets `revealLine: 12` and bumps `revealRequestId`.

Terminal: `splitPathAndPosition('src/a.ts:10:2')` still parses; `workspaces.openPath(abs, { line: 10 })` (or intercept options) results in that `revealLine`.

FilePreview: with `revealLine={3}` and three newline-separated lines, `scrollTop` equals `resolveCenteredFileLineScrollTop(...)` for estimated geometry (mock `getBoundingClientRect` / line height 20).

- [ ] **Step 2: RED** — terminal still strips line.

- [ ] **Step 3: Implement.** Update README Known Limitations: jump-to-line **exists**. Remove “FilePreview has no revealLine” sentences.

- [ ] **Step 4: GREEN** those packages’ focused specs.

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 8: Uncapped name search + Copy mention already in 5

**Files:**

- Modify: `ui-files/src/client/filter.ts` — delete `MAX_SEARCH_DEPTH`, `MAX_SEARCH_DIRS`, `mayListSearchDir`
- Modify: `FilesPanel.tsx` — search walk lists without budget; remove `search.truncated` UI
- Modify: `locales.ts` — remove `search.truncated` keys (zh+en lockstep)
- Tests: `filter.client.spec.ts`, `files-panel.client.spec.tsx` (delete truncated-banner cases)

- [ ] **Step 1: Change tests first** — `mayListSearchDir` import should fail; replace with “walk lists nested dirs with no depth cap” using a 10-deep fake `listDir`.

- [ ] **Step 2: RED**

- [ ] **Step 3: Delete budget helpers; walk every expanded/needed dir for the query.** Host `listDir` already hides gitignore from Task 4.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 9: `normalizePreviewUrl` family (client + main twins)

**Files:**

- Modify: `ui-preview/src/client/url.ts`
- Create: `src/main/preview-url.js` (CJS; same behavior)
- Tests: `ui-preview/tests/url.client.spec.ts`, `src/main/preview-url.test.js`

**Interfaces:**

```ts
export function isLoopbackHost(host: string): boolean
export function isPreviewableUrl(rawUrl: string): boolean
export class PreviewUrlNormalizationError extends Error {
  readonly reason: 'empty' | 'parse' | 'unsupported-protocol'
  readonly inputLength: number
  readonly protocol?: string
}
export function normalizePreviewUrl(rawUrl: string): string
export function newPreviewTabId(): string // prefix `dshd-tab_`
```

Copy logic from `C:\Ai\t3code\packages\shared\src\preview.ts`. Peel Schema: plain `class PreviewUrlNormalizationError extends Error`. Keep `LSOF_LOCAL_HOST_TOKENS` in main if Task 10 uses lsof; otherwise omit.

Client URL bar: on submit, `try { url = normalizePreviewUrl(raw) } catch { show rejected }`. Empty input still no-op (catch `empty`).

- [ ] **Step 1: Failing tests**

```ts
expect(normalizePreviewUrl('localhost:5173')).toBe('http://localhost:5173/')
expect(normalizePreviewUrl('example.com')).toMatch(/^https:\/\/example\.com\/?/)
expect(() => normalizePreviewUrl('')).toThrow(PreviewUrlNormalizationError)
expect(isPreviewableUrl('http://127.0.0.1:3000')).toBe(true)
expect(isPreviewableUrl('https://example.com')).toBe(false)
```

`newPreviewTabId()` starts with `dshd-tab_`.

Main twin: same cases in node:test.

- [ ] **Step 2: RED** — current helper leaves `example.com` unchanged.

- [ ] **Step 3: Implement both copies.** Delete `normalizeLocalPreviewUrl` or alias it to `normalizePreviewUrl` and update callers. Grep `normalizeLocalPreviewUrl`.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 10: Seventeen-port discovery

**Files:**

- Modify: `src/main/preview.js` `DISCOVER_PORTS`
- Test: `src/main/preview.test.js`

**Interfaces:**

```js
const DISCOVER_PORTS = Object.freeze([
  3000, 3001, 3333, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 5500, 8000, 8080, 8081, 8888, 9000,
]);
```

Keep TCP probe (200ms). Do **not** require lsof processName on Windows; Unix lsof enrichment is optional. If omitted, README: “discovered rows are url+port only.”

- [ ] **Step 1: Failing test** — `discoverLocalServers(async (port) => port === 5175)` returns `[{ url: 'http://127.0.0.1:5175', port: 5175 }]`. Probe of `9000` is in the table (`DISCOVER_PORTS.includes(9000)`).

- [ ] **Step 2: RED** — 5175 not probed.

- [ ] **Step 3: Replace the 7-port list.** Keep 8s client rescan interval unless you also copy 3s; **copy 3s** to match the reference (`PreviewPanel` discover interval).

- [ ] **Step 4: GREEN** `node --test src/main/preview.test.js` plus preview-panel discover interval test if present.

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 11: Guest session — hashed partition, permissions, UA, http(s) documents

**Files:**

- Create: `src/main/preview-session.js` + `preview-session.test.js`
- Modify: `src/main/preview.js` — `isAllowedPreviewUrl` = http(s) via `preview-url.js`; `will-navigate` / `will-redirect` / `previewRequestFilter` frames allow http(s), still cancel `file:` and non-http
- Modify: `setWindowOpenHandler` — `loadURL` any rewritten http(s), not loopback-only
- Keep: token workspace file server; harness window guards in `window.js` / `local-url.js` **unchanged**

**Interfaces:**

```js
const PREVIEW_PARTITION_PREFIX = 'persist:dshd-preview-'
function previewPartitionForScope(scope = 'shared') // sha256 hex slice 0,20
const ALLOWED_PREVIEW_PERMISSIONS = new Set([
  'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'geolocation',
])
function configurePreviewSession(ses)
```

`configurePreviewSession`: strip `/Electron\/[\d.]+ /` from UA; also strip `/\s*t3code\/[\d.]+/` **if present on a migrated machine**; `setPermissionRequestHandler` + `setPermissionCheckHandler` allow-list only.

Guest `BrowserView` webPreferences (copy the reference picker posture, dshd names):

```js
{
  sandbox: true,
  contextIsolation: false,
  nodeIntegration: false,
  session: ses,
  preload: pathToPreviewGuestPreload, // Task 20 fills pick IPC; this task may ship an empty preload that only exposes ipcRenderer
}
```

A test must pin `nodeIntegration === false` and `sandbox === true`. Do **not** change harness main-window isolation.

Scope: session cwd or `'shared'`. Pass cwd into `previewOpen` from the client (`previewOpen({ url, bounds, scope: cwd })`). Preload must forward `scope`. Old constant `'dshd-preview'` partition is abandoned (cookies reset once).

- [ ] **Step 1: Failing tests**

`previewPartitionForScope('shared')` starts with `persist:dshd-preview-` and is 20 hex chars after the prefix. Different scopes differ.

`previewRequestFilter({ url: 'https://example.com/', resourceType: 'mainFrame' })` → `{ cancel: false }`.

`previewNavigate` to `https://example.com` → `ok: true` and `loadURL` called.

`will-navigate` to `https://example.com/steal` is **not** prevented; `file:///etc/passwd` is prevented.

UA helper: `'Mozilla/5.0 Electron/43.0.0 t3code/1.0 Safari'` → no `Electron/` and no `t3code/`.

- [ ] **Step 2: RED** — existing tests currently **assert** remote navigate is denied. **Rewrite those tests** in this step (they encode the old policy). Do not keep both policies.

- [ ] **Step 3: Implement.** `rewriteLoopbackLoadUrl` still maps `0.0.0.0` → `127.0.0.1`. For public URLs return `new URL(raw).href` after protocol check.

- [ ] **Step 4: GREEN** `preview.test.js`, `preview-session.test.js`, `local-url.test.js` (main window still loopback).

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 12: Guest IPC — hardReload, zoom, colorScheme, cookies, cache, stop, load/fail, Cmd+R

**Files:**

- Modify: `preview.js` controller methods + `registerPreviewIpc`
- Modify: `src/preload/index.js`, `src/preload/shell-api.test.js`
- Modify: `ui-preview/src/client/shell.ts`
- Create: `ui-preview/src/client/zoom.ts` (copy `ZOOM_LEVELS` / `nextZoomLevel` from reference `Manager.ts` lines 91–97 / 326–338)
- Tests: `preview.test.js` (fake `webContents`), `shell-api.test.js`, `ui-preview` shell spec if any

**Interfaces (preload + shell, all required names):**

```ts
previewReload(id) // wc.reload()
previewHardReload(id) // wc.reloadIgnoringCache()
previewStop(id) // wc.stop()
previewZoomIn(id) / previewZoomOut(id) / previewResetZoom(id)
previewSetColorScheme(id, scheme: 'system' | 'light' | 'dark')
previewClearCookies() / previewClearCache()
```

`PreviewNavState` gains optional `loading?: boolean`, `title?: string`, `unreachable?: boolean`, `zoomFactor?: number`.

Wire `did-start-loading` / `did-stop-loading` / `did-fail-load` / `page-title-updated` → `onState`.

`before-input-event`: if `(control || meta) && key === 'r'` then `event.preventDefault()` and `reload()` (not hard reload).

`setColorScheme`: `wc.debugger.attach('1.3')` if needed then `Emulation.setEmulatedMedia` with `prefers-color-scheme` value `'' | 'light' | 'dark'`. Tests fake `debugger.sendCommand`.

Zoom table:

```ts
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const
export const DEFAULT_ZOOM_FACTOR = 1
export const ZOOM_EPSILON = 0.001
export function nextZoomLevel(current: number, direction: 'in' | 'out'): number
```

Main calls `wc.setZoomFactor(next)` and returns `zoomFactor` on state.

`clearCookies`: `ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'] })`.

`clearCache`: `ses.clearCache()`.

Also in this task (needed by later UI; do not leave them for a Limitations dump):

```ts
previewCaptureScreenshot(id): Promise<{ ok: boolean; pngBase64?: string }>
```

`wc.capturePage()` then `toPNG().toString('base64')`. Pick / PiP / record / automation IPC land in Tasks 20–22; this task still adds screenshot so More-menu capture is not a dead item.

- [ ] **Step 1: Failing tests** on the fake attach used in `preview.test.js`:

`hardReload` calls `reloadIgnoringCache`.

`zoomIn` from 1.0 → `setZoomFactor(1.1)`.

`setColorScheme('dark')` sends `Emulation.setEmulatedMedia` with value `dark`.

`clearCache` / `clearCookies` invoked on the partition session.

`emit('did-fail-load')` → `onState` with `unreachable: true`.

`emitBeforeInput({ control: true, key: 'r' })` prevents default and calls `reload`.

Preload harness role exposes the new functions; boot role does not.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement methods + ipc handle names `shell:preview-hard-reload`, `shell:preview-stop`, `shell:preview-zoom-in|out|reset`, `shell:preview-color-scheme`, `shell:preview-clear-cookies`, `shell:preview-clear-cache`, `shell:preview-capture-screenshot`. Authorize with existing `authorizeHarness`.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 13: Browser More menu + loading chrome (ui-primitives only)

**Files:**

- Modify: `PreviewPanel.tsx`, `locales.ts`, `PreviewPanel.module.css`
- Tests: `preview-panel.client.spec.tsx`

**Interfaces — menu item ids (Chinese labels in zh):**

| id | zh | calls |
|---|---|---|
| `hardReload` | 强制刷新 | `previewHardReload` |
| `devtools` | 开发者工具 | existing |
| `pip` | 打开独立预览窗口 / 关闭独立预览窗口 | Task 21 IPC; until 21, the click must call the IPC (test with a stub that resolves `{ ok: true }`) |
| `deviceToolbar` | 显示设备工具栏 / 隐藏设备工具栏 | Task 19; stub store toggle in this task if 19 is later |
| `pick` | 选取元素 | Task 20 IPC stub |
| `record` | 开始录制 / 停止录制 | Task 22 IPC stub |
| `screenshot` | 截图 | `previewCaptureScreenshot` |
| `appearance-system/light/dark` | 系统 / 浅色 / 深色 | `previewSetColorScheme` |
| zoom cluster | 缩小 / `N%` / 放大 / 重置 | zoom IPC |
| `clearCookies` | 清除 Cookie | `previewClearCookies` |
| `clearCache` | 清除缓存 | `previewClearCache` |

If Task 19–22 are not done yet, still **render** the items and call the named IPC. Tests may stub `{ ok: false, message }` until those tasks land; do not hide the items.

Loading: while `state.loading`, show Stop (calls `previewStop`) in place of Reload. Unreachable: banner using new locale `unreachable`. Update `rejected` to invalid URL / unsupported protocol, not “local only”.

URL bar: `normalizePreviewUrl`; public https is valid.

Keep: `previewHide` while More is open; occluded; inactive hide.

- [ ] **Step 1: Failing tests** — More contains Hard reload, Appearance Dark, Clear cache, 打开独立预览窗口, 显示设备工具栏, 选取元素, 开始录制, 截图. Hard reload calls `previewHardReload`. Dark calls `previewSetColorScheme('pv-1', 'dark')`. Screenshot calls `previewCaptureScreenshot`. Loading state shows Stop. `did-fail-load` snapshot shows unreachable copy. Paste `example.com` + Enter calls `previewNavigate`/`previewOpen` with `https://example.com/` (or href equivalent).

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement with existing `Menu`. Tokens only.

- [ ] **Step 4: GREEN** `preview-panel.client.spec.tsx` and occlusion spec (More still hides guest).

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 14: Workspace `.pdf` dual-open

**Files:**

- Modify: `src/main/preview-workspace.js` MIME `pdf: 'application/pdf'`
- Modify: `ui-surfaces/src/client/apply.ts` `BROWSER_DOCUMENTS` add `.pdf`
- Tests: `preview-workspace.test.js`, `ui-surfaces` openPath intercept spec

- [ ] **Step 1: Failing tests** — `fileUrl` for `doc.pdf` returns loopback URL; `openPath('/tmp/proj/doc.pdf')` opens Files **and** Browser pending URL. `.pdf` is `isWorkspaceBrowserPreviewPath`.

- [ ] **Step 2: RED**

- [ ] **Step 3: Add MIME + set membership. html/svg behavior unchanged.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 16: File editor dismissal + line comments into composer

**Files:**

- Create: `ui-files/src/client/fileEditorDismissal.ts`
- Create: `ui-files/src/client/fileCommentAnnotations.ts`
- Modify: `FilePreview.tsx`, `locales.ts` (`preview.comment` / `Add to chat`)
- Tests: `file-editor-dismissal.client.spec.ts`, `file-comment-annotations.client.spec.ts`, `files-panel.client.spec.tsx`

**Interfaces:**

```ts
export function installFileEditorDismissal(options: {
  root: HTMLElement
  editor: { blur(): void; setSelectionRange?(start: number, end: number): void }
  isBlocked: () => boolean
  onDismiss: () => void
}): () => void

export type SelectedLineRange = { start: number; end: number }
export type FileCommentAnnotationEntry = {
  id: string; kind: 'draft' | 'comment'
  startLine: number; endLine: number; text: string
}
export function nextFileCommentId(): string
export function normalizeFileCommentRange(range: SelectedLineRange): { startLine: number; endLine: number }
export function formatFileCommentRange(startLine: number, endLine: number): string
export function remapFileCommentAnnotations(
  annotations: ReadonlyArray<{ lineNumber: number; metadata: { entries: FileCommentAnnotationEntry[] } }>,
): Array<{ lineNumber: number; metadata: { entries: FileCommentAnnotationEntry[] } }>
export function selectionToLineRange(text: string, selectionStart: number, selectionEnd: number): SelectedLineRange
```

Copy dismissal control flow from `C:\Ai\t3code\apps\web\src\components\files\fileEditorDismissal.ts`. Replace `diffs-container` / shadowRoot with: focused if `root.contains(document.activeElement)` and that element is `textarea`. Pointerdown outside `root` + Escape while focused → `onDismiss` + blur + collapse selection.

Copy id/range/format/remap from `fileCommentAnnotations.ts`. Replace Pierre `LineAnnotation` / `SelectedLineRange` with the types above. `selectionToLineRange` counts `\n` before start/end (1-based).

Selecting lines in the textarea and choosing 「添加到对话」 inserts:

```md
L12 to L20 `src/a.ts`

```text
<selected lines>
```
```

via existing `appendToDraft` / `mentionFile`. This is the working `addReviewComment` equivalent. Do not import Pierre.

- [ ] **Step 1: Failing tests**

Dismissal: pointerdown outside calls `onDismiss` and `blur`; Escape while textarea focused does the same; pointerdown inside does not.

`normalizeFileCommentRange({ start: 8, end: 3 })` → `{ startLine: 3, endLine: 8 }`.

`formatFileCommentRange(4, 4)` → `L4`.

`selectionToLineRange('a\nb\nc', 2, 4)` → lines covering `b`.

FilePreview: select two lines, click Add to chat, `mentionFile` or draft contains `L` range and the selected text.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement.** Wire `installFileEditorDismissal` in FilePreview `useEffect`.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 17: Project file picker matches + open in editor / folder

**Files:**

- Create: `ui-files/src/client/projectFilePicker.ts` — copy `getProjectFilePickerMatches` from `ProjectFilePicker.logic.ts` and `normalizeSearchQuery` from `C:\Ai\t3code\packages\shared\src\searchRanking.ts` (only that helper, not the whole ranking module if unused).
- Create: `src/main/editors.js` + `editors.test.js` — copy `EDITORS` from `C:\Ai\t3code\packages\contracts\src\editor.ts` as a plain array (no Effect Schema).
- Modify: `src/main/ipc.js`, `src/preload/index.js` — `shell:list-editors`, `shell:open-in-editor`, `shell:show-item-in-folder`
- Modify: `FileTree.tsx` / `locales.ts` — context menu 「在文件夹中显示」、每个已探测编辑器一项、「系统默认程序」
- Tests: `project-file-picker.client.spec.ts` (copy `ProjectFilePicker.logic.test.ts` cases), `editors.test.js`, `files-panel.client.spec.tsx`

**Interfaces:**

```js
const EDITORS = [ /* same ids, labels, commands, launchStyle as the reference table */ ]
async function listAvailableEditors() // which commands exist on PATH (where.exe / command -v)
async function openInEditor({ editor, cwd, relativePath, line, column })
function showItemInFolder(absolutePath) // electron.shell.showItemInFolder
```

Launch styles: `goto` → `code --goto path:line:column`; `direct-path` → `zed path`; `line-column` → JetBrains `idea --line N path`; `file-manager` → `showItemInFolder`. `filesystem.browse` is `listDir` (Task 4). Picker matches feed Files search: when the query is non-empty, show `getProjectFilePickerMatches` rows that jump via `openFile`.

- [ ] **Step 1: Failing tests** — picker match cases from the reference; `openInEditor({ editor: 'vscode', ...})` spawns `code --goto` with a fake spawn; missing command → `{ ok: false }`; showItemInFolder called with the absolute path; FileTree menu includes 「在文件夹中显示」.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement.** Do not paste JetBrains SVG icons; labels from `EDITORS.label` on `ui-primitives` Menu.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 18: Composer `@path` / `$skill` trigger (do not steal `/`)

**Files:**

- Modify: `ui-files/src/client/composerMention.ts` — add `detectComposerTrigger` copied from `composerTrigger.ts`
- Modify: `ui-conversation` InputBar (or the existing command menu host) — when trigger kind is `path`, show picker using Task 17 matches; kind `skill` lists session skills if a skill catalog inject exists; kind `slash-command` / `slash-model` **must not** open a second menu (Harness `ui-commands` already owns `/`)
- Tests: `composer-mention.client.spec.ts` extra cases; `input-bar.client.spec.tsx` — typing `@src` offers `src/a.ts`; typing `/` does **not** call the Files picker

**Interfaces:** same `ComposerTrigger` type as the reference (`kind`, `query`, `rangeStart`, `rangeEnd`).

- [ ] **Step 1: Failing tests** — `detectComposerTrigger('see @fo', 7)` → `{ kind: 'path', query: 'fo', ... }`; `detectComposerTrigger('/model', 6)` returns slash-model but InputBar test proves `/` still uses commands, not this picker.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement.** Insert `serializeComposerFileLink` on pick, replacing the `@query` range.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 19: Device toolbar viewport via `setBounds`

**Files:**

- Create: `ui-preview/src/client/viewport.ts` — copy `browserViewportLayout.ts` + constants (`BROWSER_DEVICE_TOOLBAR_HEIGHT`, min/max dimension). Peel contract types to:

```ts
export type PreviewViewportSetting =
  | { _tag: 'fill' }
  | { _tag: 'preset'; presetId: string; width: number; height: number }
  | { _tag: 'freeform'; width: number; height: number }
```

- Modify: `PreviewPanel.tsx` — when device toolbar is on, compute letterboxed rect inside the occupant, call existing `previewResize(id, bounds)` with that guest rect (not the full occupant). Toolbar row: width × height fields + preset chips (copy the reference preset list if present; otherwise iPhone/iPad/Desktop numbers from `browserViewportLayout` / contracts).
- Tests: `viewport.client.spec.ts` (copy layout unit tests from the reference), `preview-panel.client.spec.tsx`

Homonym: dshd `previewResize` **is** the guest rectangle. Device mode is a smaller rectangle plus chrome around it. Fill mode uses the full occupant bounds as today.

- [ ] **Step 1: Failing tests** — preset `{ width: 375, height: 667 }` inside a 800×600 occupant yields a guest `setBounds` smaller than 800×600; fill uses the occupant rect; More 「显示设备工具栏」 toggles this.

- [ ] **Step 2: RED**

- [ ] **Step 3: Copy layout math. Tokens only for the letterbox (`--dsw-alias-bg-base`).

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 20: Pick overlay + annotation theme

**Files:**

- Create: `src/main/preview-guest-preload.js` — peel `C:\Ai\t3code\apps\desktop\src\preview\PickPreload.ts`. Rename channels `t3code` → `dshd`, CSS `--t3-*` → `--dshd-preview-*`. Keep `react-grab/primitives` `getElementContext` **if** that package can be a desktop dependency without breaking the harness renderer; otherwise resolve component names as `null` but still return tag, selector, size, screenshot crop (picker still usable).
- Modify: `preview.js` — `pickElement(id)`, `cancelPickElement(id)`, `setAnnotationTheme(id, theme)` send IPC into the guest; `wc.capturePage` crop like the reference.
- Modify: `ipc` / preload / `ui-preview` shell + PreviewPanel More 「选取元素」
- Tests: `preview.test.js` fake `wc.send` / `wc.ipc`; guest preload unit tests for channel names (no `t3` strings)

Guest already has isolation false + sandbox from Task 11. Preload uses `ipcRenderer` only.

- [ ] **Step 1: Failing tests** — `pickElement` sends `dshd-preview-start-pick`; `cancelPickElement` sends cancel; completing a pick returns `{ annotation, screenshot? }`; theme send uses `--dshd-preview-primary` not `--t3-primary`.

- [ ] **Step 2: RED**

- [ ] **Step 3: Copy overlay behavior. Insert picked payload into composer as markdown image+selector if the Files mention path exists; otherwise keep it on the preview store until the user confirms.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 21: Picture-in-picture window

**Files:**

- Create: `src/main/preview-pip-preload.js` — peel `preview-pip-preload.cjs`; `contextIsolation: true`, `sandbox: true`
- Modify: `preview.js` — copy `openPictureInPicture` / `closePictureInPicture` / `fitPictureInPictureContentSize` from `Manager.ts` (BrowserWindow `alwaysOnTop`, `skipTaskbar`, load the data URL helper). Frame pump: `wc.capturePage` → JPEG → `pipWindow.webContents.send('dshd-preview-pip-frame', ...)`
- Modify: ipc / preload / PreviewPanel More pip item
- Tests: `preview.test.js` with fake `BrowserWindow`; `fitPictureInPictureContentSize([480, 320], 16/9)` equals `[523, 294]` (reference fixture)

When PiP is open, keep the in-panel BrowserView hidden (`previewHide`) so hit-testing does not fight. Closing PiP shows it again if the surface is active.

- [ ] **Step 1: Failing tests** — open creates `alwaysOnTop: true` window; close destroys it; menu label flips; brand grep no `t3code` in pip preload.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement. Title `Browser preview` / `预览 · {guest title}`.

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 22: Recording, artifacts, automation*

**Files:**

- Modify: `preview.js` — `startRecording` / `stopRecording` (JPEG frames at `Math.ceil(1000/12)` via `capturePage`, emit `shell:preview-recording-frame`); `saveRecording` writes `userData/preview-recordings/{id}.webm`; `revealArtifact` → `shell.showItemInFolder`; `copyArtifactToClipboard` → `clipboard.writeImage` / write file bytes
- Modify: `ui-preview` — peel `browserRecording.ts` MediaRecorder + canvas.captureStream(12) in the **host renderer** (same as the reference: frames arrive over IPC, canvas lives in the chrome page not the guest). No Effect Schema; plain Error classes with the same `operation` tags.
- Modify: `preview.js` automation methods peeled from `Manager.ts`: `automationStatus`, `automationSnapshot` (`capturePage` + `executeJavaScript` for title/url/html), `automationClick` / `Type` / `Press` / `Scroll` via `webContents.debugger` `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `dispatchMouseEvent` wheel, `automationEvaluate` via `executeJavaScript`, `automationWaitFor` poll loop copied from the reference. Prefer CDP on the existing guest; add `playwright-core` **only** if a method cannot work without the injected runtime. Do not download a second Chromium. Packing extra browser binaries would bloat/break electron-builder — that is the explode case; CDP on the guest is the wiring.
- Tests: fake `capturePage` / `debugger.sendCommand` / `executeJavaScript`; recording test uses fake MediaRecorder like `browserRecording.test.ts`; automation click sends CDP mousePressed at (120, 80)

**Interfaces (preload):**

```ts
previewStartRecording(id) / previewStopRecording(id)
onPreviewRecordingFrame(handler)
previewSaveRecording(id, { mimeType, data: ArrayBuffer })
previewRevealArtifact(absolutePath)
previewCopyArtifactToClipboard(absolutePath)
previewAutomationStatus(id)
previewAutomationSnapshot(id)
previewAutomationClick(id, { x, y })
previewAutomationType(id, { text })
previewAutomationPress(id, { key })
previewAutomationScroll(id, { x, y, deltaX, deltaY })
previewAutomationEvaluate(id, { expression })
previewAutomationWaitFor(id, { selector?, text?, urlIncludes?, timeoutMs })
```

- [ ] **Step 1: Failing tests** for each IPC name above (one assertion per method).

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement until every name has a success path in tests.

- [ ] **Step 4: GREEN** `preview.test.js` + preview-panel record toggle.

- [ ] **Step 5: Commit** — skip unless asked.

---

### Task 23: Agent Notes, READMEs, brand grep

**Files:**

- Update in place: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md` + `.zh.md` + `.i18n.yaml` — Files/Browser paragraphs must match shipped behavior (autosave, mention markdown, public https guest, More menu including PiP/device/pick/record, revealLine, comments into composer, open-in-editor). Present tense. Remove “stay out” sentences that this plan shipped.
- Create triplet: `2026-08-19-files-browser-logic-port.md` / `.zh.md` / `.i18n.yaml` — decision: port behaviors, rebrand `dshd`, peel Effect, guest sandbox+no isolation for pick, main window isolation unchanged. No cannot-port table.
- Update: `ui-files` / `ui-preview` README.md + README.zh.md to current behavior. Known Limitations only for things still actually missing after Tasks 1–22 (should be empty or lsof processName-on-Windows if Unix-only).
- Root/desktop docs only if they still say “local URLs only” for the **guest**.

- [ ] **Step 1: Brand grep (must be empty in production trees)**

Run from repo root (PowerShell):

```powershell
rg -i "t3code|t3tools|application/x-t3code|persist:t3code" src vendor/deepseek-harness/packages --glob "!**/node_modules/**"
```

Allowed: this spec/plan under `docs/superpowers/`, Agent Note that names the reference as an external tree. Forbidden: `src/`, `packages/client/**`.

Also grep `T3-` in those trees.

- [ ] **Step 2: If grep hits, rename. No leftover `tab_` prefix without `dshd-`.

- [ ] **Step 3: Write/update notes with `dsh-prose-standard` (actors, current state, no PR archaeology). Record sidecar yaml.

- [ ] **Step 4: Re-run grep. Focused tests still GREEN.

- [ ] **Step 5: Commit** — skip unless asked.

---

## Verification (before claiming done)

From desktop root:

```powershell
node --test src/main/workspace-fs.test.js src/main/preview.test.js src/main/preview-url.test.js src/main/preview-session.test.js src/main/preview-workspace.test.js src/preload/shell-api.test.js
```

From `vendor/deepseek-harness`:

```powershell
pnpm --filter @deepseek-ai/dsh-client-ui-files --filter @deepseek-ai/dsh-client-ui-preview --filter @deepseek-ai/dsh-client-ui-surfaces --filter @deepseek-ai/dsh-client-ui-user-terminal --filter @deepseek-ai/dsh-client-ui-conversation --filter @deepseek-ai/dsh-client-ui-primitives exec vitest run tests/composer-mention.client.spec.ts tests/file-save-coordinator.client.spec.ts tests/file-path.client.spec.ts tests/file-preview-mode.client.spec.ts tests/file-line-reveal.client.spec.ts tests/files-panel.client.spec.tsx tests/apply.client.spec.ts tests/filter.client.spec.ts tests/url.client.spec.ts tests/preview-panel.client.spec.tsx tests/preview-occlusion.client.spec.tsx tests/openpath-intercept.client.spec.ts tests/apply.client.spec.ts
```

(Adjust vitest paths per package; run each filter separately if exec glob is package-local.)

Do **not** run full `pnpm test` / `test:coverage` unless a change is irreducibly repo-wide.

## Self-review vs spec

| Spec decision | Task |
|---|---|
| No cannot-port list; change wiring if import would crash | header table + 11, 16–22 |
| Rebrand table | 1 MIME, 9 tab id, 11 partition, 23 grep |
| `normalizePreviewUrl` + guest http(s) | 9, 11, 13 |
| Keep dirty-close / occlude / token server | 6, 13, 11 |
| Pick / PiP / record / automation / viewport / comments / editors | 16–22 |
| Guest isolation false + sandbox true; main window isolated | 11, 20, 21 |

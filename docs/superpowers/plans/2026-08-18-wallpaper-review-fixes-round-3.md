# Wallpaper Review Fixes Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. This session is current `main` checkout — user declined worktrees. Steps use checkbox (`- [ ]`) syntax for tracking. Do **not** commit unless the user asks.

**Goal:** Close the line-by-line review holes on the shipped wallpaper gallery/crop path: cancel must ignore an in-flight crop even when `open` has not flipped yet, the Presence exit must not paint `<img src="">`, dismissing the gallery must ignore a finishing download, and a huge local file must not be read into memory.

**Architecture:** Keep user HTTPS JSON catalogs as the main source, Bing optional and off by default, window-aspect JPEG bake, stream-capped main fetch. Fail-closed tokens live in refs and bump **synchronously** in the dismiss path, not only in `useEffect`. Renderer file-size cap matches main `MAX_IMAGE_BYTES` (12MB) but lives in `wallpaper.ts` so ui-theme does not import Electron main.

**Tech Stack:** Electron main `wallpaper-catalog.js` unchanged except unused-export cleanup. ui-theme React + vitest/jsdom. node:test only if catalog export tests break.

**Spec:** Line-by-line review canvas `wallpaper-line-review.canvas.tsx` (2026-08-18) plus locked product plan `C:\Users\48818\.cursor\plans\wallpaper_gallery_crop_98197f04.plan.md` as superseded by the later “network catalogs, Bing default off, 500/4MB” decision. Round-1 and round-2 review-fix plans already landed.

## Global Constraints

- Official `dsh web` tokens / `ui-primitives` only; no marketplace hex.
- Product copy Chinese in `locales.ts`; English keys in lockstep (`satisfies Record<ThemeKey, string>`).
- Timeline / UHD / Unsplash / search / favorites / R18 stay out.
- Do **not** add a private-host / LAN SSRF denylist. User-typed `https:` catalogs (and `DSHD_WALLPAPER_ALLOW_HTTP=1` fixtures) are in-product.
- Do **not** put `crossOrigin="anonymous"` on gallery thumbs. Bing/custom thumbs often lack CORS for the harness origin; that would break the grid the Agent Note allows (`<img src={thumbUrl}>`).
- Do **not** require `downloadWallpaper(url)` to be in the last catalog list (needs a main-process allow-set; out of this slice).
- Do **not** retune `downscaleWallpaper`’s 200ms abort; live persist is `cropWallpaper` / `CROP_DECODE_TIMEOUT_MS`.
- Do **not** delete `encodeWallpaperFile` in this round (no UI caller; already fail-closed).
- Do not commit.
- TDD: failing test first; watch it fail; minimal production code.
- Work on current workspace `main`, not a worktree.
- `ipc.js` / `preload/index.js` also contain unrelated plugin-recovery and git hunks. Touch wallpaper lines only. Do not “clean” those other hunks here.

## Out of scope

- Timeline / 拾光 HTML, login, cookies, R18.
- Unsplash, Pexels, 360 scrape, Bing GitHub archives.
- Search, categories, auto daily swap, favorites, UHD, bundled image packs, virtualization.
- LAN/loopback denylist; binding downloads to the last catalog snapshot.
- `test:web` snapshot.
- Splitting unrelated `ipc.js` / preload diffs into other commits (no commit this round).

## File map

- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperCropModal.tsx` — sync session bump on dismiss; skip empty `img` src.
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperRow.tsx` — download generation token; local `file.size` cap.
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx` — `referrerPolicy="no-referrer"` on thumbs; comment no longer says Bing is always on.
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/wallpaper.ts` — `MAX_WALLPAPER_FILE_BYTES`.
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/locales.ts` — `wallpaper.fileTooLarge`; broader `catalogRejected`; en `glassHint` capital-G.
- Modify: `src/main/wallpaper-catalog.js` — stop exporting unused `DEFAULT_BING_URL`.
- Test: `appearance-section.client.spec.tsx`; new `wallpaper-crop-modal.client.spec.tsx`.
- Docs: Agent Note en/zh Testing + Decision sentences; re-record pairing.

## Task graph

```text
Task 1 (crop dismiss token) ──┐
Task 2 (empty img src)       ─┼─ can run after 1 (same modal; 2 depends on 1’s dismiss wrapper)
Task 3 (gallery download token)
Task 4 (local file byte cap)
Task 5 (thumb referrer + copy/comment + unused export)
Task 6 (Agent Note + pairing) ── last; quotes Tasks 1–5 behavior
```

Tasks 3 and 4 are independent of 1–2. Task 5 is independent polish. Task 6 last.

---

### Task 1: Synchronous crop-cancel token

**Files:**
- Create: `vendor/deepseek-harness/packages/client/ui-theme/tests/wallpaper-crop-modal.client.spec.tsx`
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperCropModal.tsx:54-110` (`useEffect` session bump, `Modal onClose`, footer 取消)
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/tests/appearance-section.client.spec.tsx:443-457` — keep the existing cancel test as an integration pin. Do not treat `vi.waitFor` dialog-role-null as proof of a same-turn token bump.

**Root cause:** `session.current += 1` runs in `useEffect([open, image])` (`WallpaperCropModal.tsx` 54–74). Cancel is `onClose` → parent `setCropSource(null)` (`WallpaperRow.tsx` 254). If the parent has not flipped `open` yet, the effect does not run, `confirm` still sees the old token, and `onConfirm` fires. The appearance test waits until `queryByRole('dialog')` is null (Modal `aria-hidden` as soon as `open` is false) then `act(finish)`, which flushes effects — it does not cover a no-op / deferred `onClose`. Overlay/Escape also call `Modal` `onClose`; the dismiss wrapper must cover that path, not only the footer button.

**Interfaces:**
- Consumes: existing `WallpaperCropModal` props `{ open, image, t, onClose, onConfirm }`.
- Produces: dismiss wrapper that increments `session.current` **before** calling `onClose`. `confirm` still compares token after `await cropWallpaper`.

- [ ] **Step 1: Write the isolated failing test**

Create `wallpaper-crop-modal.client.spec.tsx` (first line `// @vitest-environment jsdom`). Mock `cropWallpaper` like Appearance does. `onClose` is a no-op so `open` stays `true` and `image` stays the PNG data URL — this is the race the effect-only bump misses.

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WallpaperCropModal } from '../src/client/WallpaperCropModal.tsx'
import { cropWallpaper } from '../src/wallpaper.ts'
import { zh, type ThemeKey } from '../src/client/locales.ts'

vi.mock('../src/wallpaper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/wallpaper.ts')>()
  return { ...actual, cropWallpaper: vi.fn() }
})

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const CROPPED = 'data:image/png;base64,Y3JvcA=='

describe('WallpaperCropModal', () => {
  beforeEach(() => {
    vi.mocked(cropWallpaper).mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not confirm after cancel even when open stays true', async () => {
    let finish!: (value: string | null) => void
    vi.mocked(cropWallpaper).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const onConfirm = vi.fn()
    const t = (key: ThemeKey) => zh[key]
    render(
      <WallpaperCropModal
        open={true}
        image={PNG}
        t={t}
        onClose={() => { /* parent has not flipped open yet */ }}
        onConfirm={onConfirm}
      />,
    )
    const crop = screen.getByRole('dialog', { name: zh['wallpaper.crop'] })
    const img = crop.querySelector('img')
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: 1920, configurable: true })
      Object.defineProperty(img, 'naturalHeight', { value: 1080, configurable: true })
      fireEvent.load(img)
    }
    fireEvent.click(within(crop).getByRole('button', { name: zh['wallpaper.use'] }))
    await vi.waitFor(() => { expect(cropWallpaper).toHaveBeenCalled() })
    fireEvent.click(within(crop).getByRole('button', { name: zh['editor.cancel'] }))
    await act(async () => { finish(CROPPED) })
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify RED**

Run from `vendor/deepseek-harness`:

`pnpm exec vitest run packages/client/ui-theme/tests/wallpaper-crop-modal.client.spec.tsx`

Expected: FAIL — `onConfirm` called with `CROPPED` because `open`/`image` never changed so `useEffect` did not bump `session`.

- [ ] **Step 3: Minimal implementation**

In `WallpaperCropModal.tsx`:

```tsx
const dismiss = (): void => {
  session.current += 1
  stopDrag.current?.()
  stopDrag.current = null
  onClose()
}
```

Pass `onClose={dismiss}` to `Modal`. Footer Cancel must call `dismiss`, not raw `onClose`. Keep the `useEffect` bump as a backup when `open`/`image` actually change. `confirm` stays: after `await cropWallpaper`, `if (token !== session.current) return`.

- [ ] **Step 4: Run to verify GREEN**

Same vitest command. Expected: PASS.

Also run: `pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx -t "does not persist a crop after cancel"` — still PASS.

---

### Task 2: No empty crop `<img src="">` on Presence exit

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperCropModal.tsx:143-161` (preview `<img>`)
- Test: `vendor/deepseek-harness/packages/client/ui-theme/tests/appearance-section.client.spec.tsx:443-457`

**Root cause:** `WallpaperRow` passes `image={cropSource ?? ''}` (`WallpaperRow.tsx` 250–252). Modal `usePresence` keeps children mounted ~200ms after `open=false` (`vendor/deepseek-harness/packages/client/ui-primitives/src/Modal.tsx` ~45–56). That paints `<img src="">`, which fetches the Appearance document.

**Interfaces:**
- Consumes: Task 1 `dismiss`.
- Produces: crop preview `<img>` only when `image.length > 0`.

- [ ] **Step 1: Extend the Appearance cancel test**

In `does not persist a crop after cancel while decode is in flight`, after clicking 取消 and **before** `finish()`, assert:

```ts
expect(document.querySelector('img[src=""]')).toBeNull()
```

Do not wait for the dialog role to vanish first; Presence still has the tree. If the existing test’s `waitFor` dialog-null runs first, add this assertion immediately after the Cancel click, then keep the rest.

- [ ] **Step 2: Run to verify RED**

`pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx -t "does not persist a crop after cancel"`

Expected: FAIL — `img[src=""]` exists (`cropSource` already `null`, `image === ''`).

- [ ] **Step 3: Minimal implementation**

In `WallpaperCropModal.tsx`, do not render the preview `<img>` when `image.length === 0`. Keep the crop frame for layout. Do **not** keep a stale `src` as a second strategy in this task (empty-skip is enough).

```tsx
{image.length > 0 ? (
  <img className={css.cropImage} src={image} alt="" draggable={false} /* existing style + onLoad */ />
) : null}
```

- [ ] **Step 4: Run to verify GREEN**

Same appearance test + Task 1 isolated spec. Expected: PASS. Preview `onLoad` / ready-gate tests still pass because they only run while `image` is a data URL.

---

### Task 3: Ignore a gallery download after dismiss

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperRow.tsx:66-137,257-266`
- Test: `vendor/deepseek-harness/packages/client/ui-theme/tests/appearance-section.client.spec.tsx` — new `it` next to the existing gallery download-error case (~586–633)

**Root cause:** `pickCatalog` (`WallpaperRow.tsx` 120–136) has no generation token. Gallery `onClose` only `setGalleryOpen(false)` (264). A finishing `downloadWallpaper` still `setCropSource(result.dataUrl)` and opens crop. The list effect at 75–87 already uses `cancelled`; download does not.

**Interfaces:**
- Consumes: existing `downloadWallpaper` inject.
- Produces: `downloadSession` ref; bump on gallery close and at the start of each pick; ignore results when token mismatches.

- [ ] **Step 1: Write the failing test**

Add to `appearance-section.client.spec.tsx` (reuse the Bing-list mount that already injects `listWallpaperCatalog` / `downloadWallpaper`):

```tsx
it('does not open crop when a gallery download finishes after close', async () => {
  let finish!: (value: { dataUrl?: string; error?: string }) => void
  const listWallpaperCatalog = vi.fn(async () => ({
    items: [{
      id: 'a', title: 'A', copyright: '', thumbUrl: 'https://example.com/a.jpg',
      imageUrl: 'https://example.com/a-full.jpg', source: 'custom',
    }],
  }))
  const downloadWallpaper = vi.fn(() => new Promise<{ dataUrl?: string; error?: string }>((resolve) => { finish = resolve }))
  const b = mount('system', { wallpaperCatalogUrls: ['https://example.com/keep.json'] }, { listWallpaperCatalog, downloadWallpaper })
  fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
  await screen.findByRole('button', { name: 'A' })
  fireEvent.click(screen.getByRole('button', { name: 'A' }))
  expect(await screen.findByText('正在下载壁纸…')).toBeDefined()
  const gallery = screen.getByRole('dialog', { name: '浏览图库' })
  fireEvent.click(within(gallery).getByRole('button', { name: '取消' }))
  await act(async () => { finish({ dataUrl: PNG }) })
  expect(screen.queryByRole('dialog', { name: '裁剪背景图' })).toBeNull()
  expect(b.setWallpaper).not.toHaveBeenCalled()
})
```

`PNG` is already in that spec (`appearance-section.client.spec.tsx` 28). Gallery title is `wallpaper.browse` = `浏览图库`. Overlay/Escape also call `onClose`; the same `downloadSession` bump on that callback covers them.

- [ ] **Step 2: Run to verify RED**

`pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx -t "does not open crop when a gallery download finishes after close"`

Expected: FAIL — crop dialog appears (`setCropSource` ran).

- [ ] **Step 3: Minimal implementation**

In `WallpaperRow.tsx`:

```tsx
const downloadSession = useRef(0)

const pickCatalog = async (item: WallpaperCatalogItem): Promise<void> => {
  const download = downloadWallpaper
  if (download === undefined) return
  const token = ++downloadSession.current
  setBusyId(item.id)
  try {
    const result = await download(item.imageUrl)
    if (token !== downloadSession.current) return
    // existing dataUrl / error handling
  } finally {
    if (token === downloadSession.current) setBusyId(undefined)
  }
}

// gallery onClose:
onClose={() => {
  downloadSession.current += 1
  setBusyId(undefined)
  setGalleryOpen(false)
}}
```

Do not bump `downloadSession` at the start of `pickCatalog` **and** on close in a way that a second pick is ignored — start-of-pick increment is for overlapping picks (`busyId` already disables cards). Close increment is for dismiss. Both are required.

- [ ] **Step 4: Run to verify GREEN**

That new test plus existing “skips a download without bytes” / Bing crop-write tests. Expected: PASS.

---

### Task 4: Cap local file reads at 12MB

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/wallpaper.ts` — export `MAX_WALLPAPER_FILE_BYTES = 12 * 1024 * 1024`
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperRow.tsx:90-111` — reject before `readFileAsDataUrl`
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/locales.ts` — zh ~43 and en ~124 lockstep `wallpaper.fileTooLarge`
- Test: `appearance-section.client.spec.tsx` — new `it` next to the local pick-failed case (~419–441)

**Root cause:** `pick` reads the whole File (`WallpaperRow.tsx` 90–110). Main `downloadWallpaper` already caps at `MAX_IMAGE_BYTES` (12MB in `src/main/wallpaper-catalog.js`). A huge local pick can OOM in the renderer. Do not import `src/main/wallpaper-catalog.js` from ui-theme.

**Interfaces:**
- Produces: `export const MAX_WALLPAPER_FILE_BYTES = 12 * 1024 * 1024` in `wallpaper.ts` (must stay equal to main `MAX_IMAGE_BYTES`; comment that in JSDoc).
- `pick` returns before `readFileAsDataUrl` when `file.size > MAX_WALLPAPER_FILE_BYTES`.

- [ ] **Step 1: Copy + failing test**

`locales.ts` (zh / en, lockstep):

- `wallpaper.fileTooLarge`: `图片太大。` / `This image is too large.`

Test (do not allocate 12MB):

```tsx
it('rejects a local file over the wallpaper byte cap before reading it', async () => {
  const b = mount('system')
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
  try {
    const big = new File([PNG_BYTES], 'huge.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 12 * 1024 * 1024 + 1 })
    await pickWallpaperFile(b, big)
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByText(COPY['wallpaper.fileTooLarge'])).toBeDefined()
    expect(screen.queryByRole('dialog', { name: '裁剪背景图' })).toBeNull()
    expect(b.setWallpaper).not.toHaveBeenCalled()
  } finally {
    read.mockRestore()
  }
})
```

`PNG_BYTES`, `pickWallpaperFile`, and `COPY` already exist in that spec. After `wallpaper.ts` exports `MAX_WALLPAPER_FILE_BYTES`, switch the size literal to `MAX_WALLPAPER_FILE_BYTES + 1`. Add the zh/en locale keys in the same change as the test so `ThemeKey` / `COPY['wallpaper.fileTooLarge']` typecheck; RED is then “FileReader ran / crop opened / copy not shown”, not a compile error.

- [ ] **Step 2: Run to verify RED**

`pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx -t "rejects a local file over the wallpaper byte cap"`

Expected: FAIL — `readAsDataURL` called and/or crop dialog opens; `wallpaper.fileTooLarge` copy is not shown.

- [ ] **Step 3: Minimal implementation**

`wallpaper.ts`:

```ts
/** Longest local File Appearance will read. Must match main MAX_IMAGE_BYTES. */
export const MAX_WALLPAPER_FILE_BYTES = 12 * 1024 * 1024
```

`WallpaperRow.tsx` `pick`, after the type/name check, before `readFileAsDataUrl`:

```ts
if (file.size > MAX_WALLPAPER_FILE_BYTES) {
  setPickError(t('wallpaper.fileTooLarge'))
  return
}
```

- [ ] **Step 4: Run to verify GREEN**

That test + existing local-pick crop test (small PNG). Expected: PASS.

---

### Task 5: Thumb referrer, copy, comments, unused export

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx:1-3,61` — file comment; thumb `<img>`
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/client/locales.ts` — `wallpaper.catalogRejected` (zh 52 / en 133) and en `wallpaper.glassHint` (124)
- Modify: `src/main/wallpaper-catalog.js:4,347-356` — `DEFAULT_BING_URL` is unused except the export (`bingCatalogUrls` already inlines the two HPImageArchive URLs). Delete the const and drop it from `module.exports`.
- Test: `appearance-section.client.spec.tsx:553-584` (thumb attribute on the existing Bing-rows test) and `:635-650` (catalogRejected string).

**Do not** set `crossOrigin="anonymous"` (breaks non-CORS thumbs).

- [ ] **Step 1: Failing assertions**

After opening the gallery in the existing Bing-rows test (or the Task 3 fixture), assert:

```ts
const thumb = screen.getByRole('button', { name: /晨湖|A/ }).querySelector('img')
expect(thumb?.getAttribute('referrerpolicy') ?? thumb?.getAttribute('referrerPolicy')).toBe('no-referrer')
```

React may set `referrerPolicy` as the DOM `referrerpolicy` attribute. Use whichever jsdom reports; pin one after a quick RED run.

If you change `catalogRejected` text, update the existing `http:` add test to the new zh string.

- [ ] **Step 2: Run to verify RED**

Appearance gallery test. Expected: FAIL — no referrerpolicy.

- [ ] **Step 3: Minimal implementation**

```tsx
<img className={css.galleryThumb} src={item.thumbUrl} alt="" referrerPolicy="no-referrer" />
```

Copy (zh / en):

- `wallpaper.catalogRejected`: `无法添加：需要互不相同的 HTTPS 地址，且不能过长。` / `Could not add that catalog URL. Use a unique HTTPS URL that is not too long.`
- `wallpaper.glassHint` en: `High glass opacity covers the wallpaper. Lower glass opacity to let more of the image show through.`

Stop exporting `DEFAULT_BING_URL`. If tests imported it, they do not today (grep is catalog.js only).

- [ ] **Step 4: Run to verify GREEN**

Appearance catalog-reject + gallery tests. `node --test src/main/wallpaper-catalog.test.js` from repo root — still 15 PASS (export removal must not break tests).

---

### Task 6: Agent Note + pairing

**Files:**
- Modify: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md`
- Modify: `.../2026-08-18-wallpaper-gallery-and-crop.zh.md`
- Pairing: `pnpm run verify-translation-pairing -- --write .agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md` then the check without `--write`.

**Present tense only.** No “previously / now / round 3”.

- [ ] **Step 1: Decision sentences to add (English)**

In the crop paragraph, after “Closing the dialog while `cropWallpaper` is in flight does not persist”:

- Dismiss bumps the crop session token synchronously even if `open` has not flipped yet.
- The crop preview `<img>` is not rendered when `image` is empty, so Presence exit does not fetch `src=""`.
- Closing the gallery bumps a download session token; a finishing `downloadWallpaper` does not open crop.
- Local picks larger than `MAX_WALLPAPER_FILE_BYTES` (12MB, same as main image fetch) are rejected before `FileReader`.
- Gallery thumbs use `referrerPolicy="no-referrer"`; they still load in `<img src>` (not `crossOrigin`).

Mirror in the Chinese Decision paragraph.

Testing paragraph: pin the isolated crop-modal cancel-with-open-still-true spec, empty `img[src=""]` absence, gallery download-after-close, and oversize local File.

- [ ] **Step 2: Pairing**

From `vendor/deepseek-harness`:

```sh
pnpm run verify-translation-pairing -- --write .agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md
pnpm run verify-translation-pairing -- .agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md
pnpm run verify-agent-note-format
```

Expected: write records the sidecar; check reports the named pair consistent; format 581 notes OK.

- [ ] **Step 3: Regression sweep**

From repo root: `node --test src/main/wallpaper-catalog.test.js` — 15 PASS.

From `vendor/deepseek-harness`:

```sh
pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx packages/client/ui-theme/tests/wallpaper-crop-modal.client.spec.tsx packages/client/ui-theme/tests/wallpaper.client.spec.ts packages/client/ui-theme/tests/theme.client.spec.ts packages/client/ui-theme/tests/apply.client.spec.ts packages/client/ui-theme/tests/wallpaper-shell.client.spec.ts packages/client/ui-theme/tests/settings-store.client.spec.ts
```

Expected: all PASS.

Do not run `test:web` unless the user asks.

---

## Spec coverage

| Review finding | Task |
|---|---|
| Crop cancel token only in `useEffect`; appearance test flushes effects | Task 1 isolated spec + sync `dismiss` |
| Presence exit `<img src="">` | Task 2 |
| `pickCatalog` ignores gallery close | Task 3 |
| Local File no byte cap | Task 4 |
| Thumb cookies / referrer | Task 5 `referrerPolicy` only |
| `catalogRejected` reused for duplicate/long | Task 5 copy |
| en “Lower Glass opacity” | Task 5 |
| Unused `DEFAULT_BING_URL` export | Task 5 |
| Gallery file comment still “Bing and custom” | Task 5 |
| Agent Note must match shipped reality | Task 6 |
| LAN SSRF denylist | Out of scope (product) |
| `downloadWallpaper` membership in last list | Out of scope |
| `crossOrigin="anonymous"` on thumbs | Out of scope (would break thumbs) |
| `downscaleWallpaper` 200ms / delete `encodeWallpaperFile` | Out of scope |
| Unrelated ipc/preload hunks | Out of scope |

## Placeholder scan

No TBD. Each task has the test source, the RED command, the production snippet, and the GREEN command.

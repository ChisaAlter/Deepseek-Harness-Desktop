# Wallpaper Review Fixes Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this session, current `main` checkout — user declined worktrees). Steps use checkbox (`- [ ]`) syntax for tracking. Do **not** commit unless the user asks.

**Goal:** Close the second-pass review holes on the locked Bing+JSON+crop path: crop decode fail-closed, JPEG bake evidence, rejected catalog URL copy, plus the related silent local-pick and confirm-before-load races.

**Architecture:** Keep Bing + HTTPS JSON catalogs + window-aspect JPEG bake. `cropWallpaper` settles `null` when decode never fires. The crop dialog does not confirm until the preview has natural size, and rereads window aspect on resize. Appearance validates catalog URLs before persist. Tests assert JPEG mime, not a PNG stub.

**Tech Stack:** Electron main unchanged for this round. ui-theme React + vitest/jsdom. Host `ui-theme` settings.

**Spec:** Second-pass review canvas `wallpaper-strict-spec-review.canvas.tsx` plus locked plan `wallpaper_gallery_crop_98197f04.plan.md`. Round-1 fixes already landed.

## Global Constraints

- Official `dsh web` tokens / `ui-primitives` only.
- Product copy Chinese in `locales.ts`; English keys in lockstep (`satisfies Record<ThemeKey, string>`).
- Timeline / UHD / Unsplash / search / favorites stay out.
- Do not commit.
- TDD: failing test first; watch it fail; minimal production code.
- Work on current workspace `main`, not a worktree.

## Out of scope

- Timeline / 拾光 adapters, private-host SSRF deny list, `test:web` snapshot, `downscaleWallpaper` 200ms on the unused encode path.

## File map

- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/wallpaper.ts` — `CROP_DECODE_TIMEOUT_MS`, crop timeout, named catch.
- Modify: `WallpaperCropModal.tsx` — ready gate, resize aspect.
- Modify: `WallpaperSources.tsx` — reject non-https before persist.
- Modify: `WallpaperRow.tsx` — local pick failure copy.
- Modify: `locales.ts` — `wallpaper.catalogRejected`, `wallpaper.pickFailed`.
- Modify: `appearance-section.client.spec.tsx`, `wallpaper.client.spec.ts`.
- Modify: Agent Note en/zh + ui-theme README Known Limitations; re-record pairing.

---

### Task 1: Crop decode fail-closed

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/wallpaper.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-theme/tests/wallpaper.client.spec.ts`

**Interfaces:**
- Produces: `export const CROP_DECODE_TIMEOUT_MS = 8_000`
- `cropWallpaper` resolves `null` when Image never loads/errors before that timer.

- [x] **Step 1: Replace the hang-pins-as-correct test**

Change `does not abort a pending decode after 200ms` to:

```ts
it('returns null when decode never settles', async () => {
  vi.useFakeTimers()
  class HangImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { /* decode never settles */ }
  }
  vi.stubGlobal('Image', HangImage)
  const pending = cropWallpaper(PNG, { x: 0, y: 0, width: 1, height: 1 })
  await vi.advanceTimersByTimeAsync(8_000)
  expect(await pending).toBeNull()
})
```

Import `CROP_DECODE_TIMEOUT_MS` and use that number instead of a literal once the constant exists.

- [ ] **Step 2: Run to verify RED**

Run: `pnpm exec vitest run packages/client/ui-theme/tests/wallpaper.client.spec.ts -t "returns null when decode never settles"` from `vendor/deepseek-harness`.

Expected: FAIL — promise still pending / test times out or `settled` stays false.

- [ ] **Step 3: Minimal implementation**

In `cropWallpaper`, mirror `downscaleWallpaper`’s `finish` + timer, but use `CROP_DECODE_TIMEOUT_MS` (8000), not 200. `onload` / `onerror` / zero-size / missing context still `finish(null)` immediately. Name the `toDataURL` catch: tainted or throwing canvas export.

- [ ] **Step 4: Run to verify GREEN**

Same vitest command. Expected: PASS. Full `wallpaper.client.spec.ts` still green.

---

### Task 2: JPEG bake evidence

**Files:**
- Test: `wallpaper.client.spec.ts` crop success case
- Test: `appearance-section.client.spec.tsx` mock + persist assertion

- [ ] **Step 1: Failing assertions**

Tiny JPEG fixture (valid `isWallpaperDataUrl`):

```ts
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp8rKztLW2t7a3uHl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uHl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIQAxAAAAH/2Q=='
```

In crop success: `toDataURL` returns `JPEG`; capture args; expect `['image/jpeg', 0.82]` and result `JPEG` (not `PNG`).

Appearance `beforeEach`: `mockResolvedValue(JPEG)`. Persist assertions: `toMatch(/^data:image\/jpeg/)`.

- [ ] **Step 2: Run RED** (success test still returns PNG stub).

- [ ] **Step 3:** Only the test/fixture change is required if production already calls `toDataURL('image/jpeg', 0.82)`. Do not weaken `isWallpaperDataUrl`.

- [ ] **Step 4: GREEN** wallpaper + appearance crop persist tests.

---

### Task 3: Confirm-before-load + live aspect

**Files:**
- Modify: `WallpaperCropModal.tsx`
- Test: `appearance-section.client.spec.tsx`

- [ ] **Step 1: Tests**

`使用` is `disabled` until `img` `load` with non-zero natural size.

After `load`, `window.innerWidth=1600` / `innerHeight=900` + `resize` event, then confirm: `cropWallpaper` second arg matches `wallpaperCropRect(naturalW, naturalH, 1600/900, zoom, panX, panY)` (unmock `wallpaperCropRect` — it is not mocked).

Rewrite `confirmCrop` helper: do **not** set `innerHeight` to 0; fire `load` with real `naturalWidth`/`naturalHeight`; then click 使用.

Existing fail-crop test must `load` first or 使用 stays disabled.

- [ ] **Step 2: RED**

- [ ] **Step 3:** `ready` false until onLoad. `disabled={busy || !ready}`. Aspect in state; `resize` listener while `open`. Reset `ready` when `open`/`image` changes.

- [ ] **Step 4: GREEN**

---

### Task 4: Rejected catalog URL + local pick copy

**Files:**
- Modify: `locales.ts`, `WallpaperSources.tsx`, `WallpaperRow.tsx`
- Test: `appearance-section.client.spec.tsx`

Copy:

- `wallpaper.catalogRejected`: 只接受 HTTPS 目录地址。 / Only HTTPS catalog URLs are accepted.
- `wallpaper.pickFailed`: 无法读取这张图片。 / Could not read this image.

- [ ] **Step 1: Tests**

Type `http://127.0.0.1/x.json`, click 添加: `setWallpaperSources` not called with that URL; status `只接受 HTTPS 目录地址。`; draft may remain.

Type `not-a-url`, Enter: same status, no persist.

Existing https add still works and clears status.

Local pick of `notes.txt`: status `无法读取这张图片。`; no crop dialog. FileReader error path: same copy.

- [ ] **Step 2: RED**

- [ ] **Step 3:** `WallpaperSources.add` runs `sanitizeWallpaperCatalogUrls([...wallpaperCatalogUrls, url])`. If length unchanged, set status, do not call persist (or call is harmless if identical — **must not clear draft without copy**). `WallpaperRow.pick` sets `pickFailed` on early return; shows `role="status"` on the row when gallery is closed.

- [ ] **Step 4: GREEN**

---

### Task 5: Docs match shipped behavior

**Files:** Agent Note en/zh, ui-theme README en/zh Known Limitations.

Facts:

- `cropWallpaper` returns null after `CROP_DECODE_TIMEOUT_MS` if decode never settles.
- Crop 使用 stays disabled until preview load.
- Host add of a non-https catalog URL shows `catalogRejected` and does not persist.
- Tests pin JPEG `toDataURL('image/jpeg')`, not a PNG stub.

- [ ] Wrap/links; `pnpm run verify-translation-pairing --write` on the touched pairs.
- [ ] Narrow tests green.

## Verification

From `vendor/deepseek-harness`:

```
pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx packages/client/ui-theme/tests/wallpaper.client.spec.ts packages/client/ui-theme/tests/theme.client.spec.ts
```

From repo root:

```
node --test src/main/wallpaper-catalog.test.js
```

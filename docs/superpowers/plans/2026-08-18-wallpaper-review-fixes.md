# Wallpaper Review Fixes Implementation Plan

> **For agentic workers:** Use executing-plans in this workspace. TDD per task. Do **not** commit unless the user asks. Work on current `main` (existing uncommitted wallpaper feature).

**Goal:** Close the review’s correctness holes and the silent product cuts, without reopening locked tradeoffs (Timeline, UHD, Unsplash, search, favorites, R18).

**Architecture:** Keep Bing + JSON catalogs + window-aspect crop. Fail closed on crop/download. Fetch redirects hop-by-hop. Persist only `https:` catalog URLs. Built-in Bing uses two HPImageArchive pages (`idx=0` and `idx=8`) so the gallery covers ~16 days.

**Tech Stack:** Electron main `fetch`; ui-theme React + vitest/jsdom; node:test for `wallpaper-catalog.js`.

**Spec:** Adversarial review 2026-08-18 (canvas `wallpaper-requirement-downgrade.canvas.tsx`) plus locked plan `wallpaper_gallery_crop_98197f04.plan.md`.

## Global Constraints

- Official `dsh web` tokens / `ui-primitives` only; no marketplace hex.
- Product copy Chinese in `locales.ts`; English keys stay in lockstep.
- Timeline HTML/partner/R18 stay out. Custom source remains the two JSON forms.
- No UHD. Still bake JPEG through `setWallpaper` / `MAX_WALLPAPER_EDGE=1920`.
- Do not commit.
- Tests first; watch them fail; then minimal production code.

## Out of scope

- Timeline / 拾光 adapters, account, cookies, R18.
- Unsplash, Pexels, 360 scrape, Bing GitHub archives.
- Search, categories, auto daily swap, favorites.
- Extra Electron window or marketplace tab.

## File map

- `src/main/wallpaper-catalog.js` + `.test.js` — Bing pages, redirects, fetch.
- `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts` — HTTPS-only persist.
- `vendor/deepseek-harness/packages/client/ui-theme/src/wallpaper.ts` — crop decode must not abort at 200ms.
- `WallpaperCropModal.tsx`, `WallpaperRow.tsx`, `WallpaperGalleryModal.tsx`, `WallpaperSources.tsx`, `locales.ts`.
- Tests: `appearance-section.client.spec.tsx`, `wallpaper.client.spec.ts`, `theme.client.spec.ts`.
- Docs: Agent Note + ui-theme README pairing.

---

### Task 1: Crop fail-closed

**Files:**
- Modify: `WallpaperCropModal.tsx`, `wallpaper.ts` (`cropWallpaper` timer)
- Test: `appearance-section.client.spec.tsx`, `wallpaper.client.spec.ts`

**Root cause:** Confirm does `onConfirm(cropped ?? image)`. `cropWallpaper` also `finish(null)` after 200ms (jsdom leftover), so a slow decode persists the uncropped original.

- [ ] **Step 1:** In the unsavable-crop test, stub `cropWallpaper` to resolve `null` and assert `setWallpaper` is not called and the dialog stays. Remove the 250ms sleep. Add a success path that stubs `cropWallpaper` to resolve the PNG data URL so local-pick / gallery crop tests still write.

- [ ] **Step 2:** Run that spec; expect FAIL because confirm still passes `image` through.

- [ ] **Step 3:** If `cropped` is null, set a `wallpaper.cropFailed` status, keep the dialog, do not call `onConfirm`. Remove the 200ms abort from `cropWallpaper` (onload/onerror/zero-size/canvas still return null). Leave `downscaleWallpaper`’s timer unless a crop-path test requires it — crop is the persist path.

- [ ] **Step 4:** Re-run appearance + wallpaper crop specs. Expected: PASS.

---

### Task 2: Gallery download and catalog-fail copy

**Files:**
- Modify: `WallpaperRow.tsx`, `WallpaperGalleryModal.tsx`, `locales.ts`
- Test: `appearance-section.client.spec.tsx`

**Root cause:** `pickCatalog` ignores `result.error`. List `catch` maps to `wallpaper.galleryEmpty`.

- [ ] **Step 1:** Test: download resolving `{ error: '壁纸不是可用的图片' }` shows that (or `wallpaper.downloadFailed`) and does not open crop. Test: list throw shows `wallpaper.galleryFailed`, not empty copy. Empty `{ items: [] }` still shows `wallpaper.galleryEmpty`.

- [ ] **Step 2:** Run; expect FAIL (error unused; throw uses empty string).

- [ ] **Step 3:** On download error, set gallery status from `result.error` or `wallpaper.downloadFailed`. On list throw, `{ items: [], warning: t('wallpaper.galleryFailed') }`. Keep empty copy for zero items.

- [ ] **Step 4:** Re-run appearance spec. Expected: PASS.

New copy (zh / en):

- `wallpaper.cropFailed`: 无法裁剪这张图。 / Could not crop this image.
- `wallpaper.downloadFailed`: 下载壁纸失败。 / Wallpaper download failed.
- `wallpaper.galleryFailed`: 无法读取图库。 / Could not load the gallery.

---

### Task 3: HTTPS-only Host catalog URLs

**Files:**
- Modify: `theme-settings.ts` `sanitizeWallpaperCatalogUrls`
- Test: `theme.client.spec.ts`

**Root cause:** Sanitize keeps `http:`; production fetch rejects it.

- [ ] **Step 1:** Add `'http://127.0.0.1/x.json'` to the sanitizer input; expect it dropped.

- [ ] **Step 2:** Run; expect FAIL (http survived).

- [ ] **Step 3:** Persist `https:` only. `DSHD_WALLPAPER_ALLOW_HTTP` stays a main-process fetch fixture switch, not a Host schema hole.

- [ ] **Step 4:** Re-run theme spec. Expected: PASS.

---

### Task 4: Real redirect hop cap + Bing ~16 days

**Files:**
- Modify: `src/main/wallpaper-catalog.js`
- Test: `src/main/wallpaper-catalog.test.js`

**Root cause:** `redirect: 'follow'` plus nonexistent `x-redirect-count`. Built-in Bing is `idx=0&n=8` only; recommended product was ~two weeks.

- [ ] **Step 1:** Test: fixture 302 chain longer than `MAX_REDIRECTS` (4) yields warning/error `重定向过多` and does not return the final image/catalog. Test: 2 hops to a PNG still downloads. Test: `DSHD_BING_WALLPAPER_URL` with `{idx}` fetches idx 0 and 8 and merges both `hsh` ids. Test: `bingCatalogUrls()` default (no env) is idx=0 and idx=8 on `cn.bing.com`.

- [ ] **Step 2:** Run `node --test src/main/wallpaper-catalog.test.js`; expect FAIL.

- [ ] **Step 3:** `fetchBuffer` uses `redirect: 'manual'`, follows `Location` via `parseHttpUrl` / `resolveAgainst`, max 4 hops, then reads the body. `bingCatalogUrls()`: env override without `{idx}` stays one URL (existing tests); with `{idx}` or no override, fetch idx 0 and 8.

- [ ] **Step 4:** Re-run catalog tests. Expected: PASS.

---

### Task 5: Bing wallpaper-use hint + dsh web description

**Files:**
- Modify: `locales.ts`, `WallpaperRow.tsx`, `WallpaperSources.tsx`
- Test: `appearance-section.client.spec.tsx`

- [ ] **Step 1:** Without catalog inject, description must not mention 图库/gallery. With inject, Bing switch has a hint that the Bing archive is wallpaper-use only. `catalogHint` stays JSON-format help.

- [ ] **Step 2:** Run; expect FAIL.

- [ ] **Step 3:** `wallpaper.descriptionLocal` for no-shell; keep `wallpaper.description` for desktop. `wallpaper.bingHint` under the Bing switch.

Copy:

- `wallpaper.descriptionLocal`: 选一张图铺在整个界面后面。确认前先按窗口比例裁剪。玻璃透明度越高，图越被盖住。设好之后可以拉毛玻璃和像素化。
- `wallpaper.descriptionLocal` en: Choose a local image to sit behind the whole UI. Crop it to the window before it is saved. Higher glass opacity hides more of it. Frost and pixelate sliders appear after it is set.
- `wallpaper.bingHint`: 必应每日壁纸接口仅限壁纸用途。 / Bing’s daily archive is licensed for wallpaper use only.

- [ ] **Step 4:** Re-run appearance spec. Expected: PASS.

---

### Task 6: Docs match shipped behavior

**Files:**
- Modify: Agent Note en/zh, ui-theme README en/zh
- Then: `pnpm run verify-translation-pairing --write` on those pairs

Facts to rewrite in present tense:

- Built-in Bing is two HPImageArchive pages (`idx=0` and `idx=8`, `n=8`).
- Crop confirm never persists the uncropped source.
- Host `wallpaperCatalogUrls` stores `https:` only.
- Fetch follows at most 4 redirects by hand.

- [ ] Wrap/links/format on the touched notes.
- [ ] Narrow tests listed below all green.

## Verification

```
node --test src/main/wallpaper-catalog.test.js src/preload/shell-api.test.js
```

From `vendor/deepseek-harness`:

```
pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx packages/client/ui-theme/tests/wallpaper.client.spec.ts packages/client/ui-theme/tests/theme.client.spec.ts packages/client/ui-theme/tests/apply.client.spec.ts packages/client/ui-theme/tests/wallpaper-shell.client.spec.ts
```

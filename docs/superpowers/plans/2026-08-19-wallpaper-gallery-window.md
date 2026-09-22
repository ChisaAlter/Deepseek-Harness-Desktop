# Wallpaper Gallery Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Current `main` checkout — user declined worktrees. Steps use checkbox (`- [ ]`) syntax. Do **not** commit unless the user asks.

**Goal:** Replace the Appearance URL-dump gallery with a browse window (categories + search + grid + favorites + confirm-then-crop). Source add / edit / delete lives inside that window, not on Appearance. Sources: Bing, Wallhaven SFW, named HTTPS JSON catalogs.

**Architecture:** Host `ui-theme` persists `wallpaperSources` and `wallpaperFavorites`. The gallery Modal lists one source at a time through an extended `listWallpaperCatalog` query. Main-process `wallpaper-catalog.js` fetches Bing today, Bing year archives, Wallhaven search (`purity=100` hardcoded), and custom catalogs. Crop and `downloadWallpaper` stay as they are.

**Tech Stack:** Electron main `wallpaper-catalog.js`, preload IPC, ui-theme React + vitest/jsdom, Host settings Zod.

**Spec:** `docs/superpowers/specs/2026-08-19-wallpaper-gallery-window-design.md`

## Global Constraints

- Official `dsh web` tokens / `ui-primitives` only; no `marketplace.css` hex; no new Electron window.
- Product copy Chinese in `locales.ts`; English keys in lockstep (`satisfies Record<ThemeKey, string>`).
- Wallhaven `purity=100` only; no API key field; no NSFW toggle.
- Unsplash / Pexels / Pixabay / Timeline / R18 stay out.
- Appearance **row** is pick / browse / crop / sliders only. Source CRUD is inside the browse window.
- Do not commit.
- TDD: failing test first; watch RED; minimal production code; GREEN.
- Work on current workspace `main`, not a worktree.
- Touch wallpaper files only. Do not “clean” unrelated ipc/plugin-recovery hunks.

## Out of scope

- Independent BrowserWindow, marketplace skin, UHD-only Wallhaven, Wallhaven API keys.
- `test:web` unless assembled Appearance copy forces it.
- Binding downloads to a last-catalog allow-set.

## File map

- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts` — `WallpaperSource`, `WallpaperFavorite`, sanitize, migrate, Zod.
- Modify: `settings-store.ts`, `src/client/index.ts` ThemeRuntime `setWallpaperSources` / `setWallpaperFavorites`.
- Modify: `src/main/wallpaper-catalog.js` + `.test.js` — query by kind; Bing year; Wallhaven.
- Modify: `src/main/ipc.js`, `src/preload/index.js` — pass the query object.
- Modify: `wallpaper-shell.ts` — `listWallpaperCatalog(query)`.
- Modify: `WallpaperGalleryModal.tsx` — 880 dialog, Pill tabs, chips, search, star, confirm, source pane.
- Do not mount `WallpaperSources` from Appearance.
- Modify: `WallpaperRow.tsx`, `AppearanceSection.tsx`, `locales.ts`, CSS module as needed.
- Tests: `appearance-section.client.spec.tsx`, `theme.client.spec.ts` / settings-store, `wallpaper-shell.client.spec.ts`.
- Docs: Agent Note triplet + ui-theme README Known Limitations.

## Task graph

```text
Task 1 settings model ── Task 4 source CRUD UI
Task 2 main catalog    ── Task 3 IPC/preload ── Task 5 gallery fetch UI
                         Task 6 favorites (needs 1 + 5)
                         Task 7 confirm-then-crop (needs 5)
Task 8 Agent Note last
```

---

### Task 1: Host source and favorite records

**Files:**
- Modify: `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts`
- Modify: `settings-store.ts`, `src/client/index.ts` (ThemeSettings snapshot + `setWallpaperSources` / `setWallpaperFavorites`)
- Test: `vendor/deepseek-harness/packages/client/ui-theme/tests/theme.client.spec.ts` and/or a focused `theme-settings` import in an existing spec that already imports `resolveThemeSettings` / `sanitizeWallpaperCatalogUrls`

**Interfaces:**
- Produces:

```ts
export type WallpaperSourceKind = 'bing' | 'wallhaven' | 'catalog'
export type WallpaperSource = { id: string; kind: WallpaperSourceKind; name: string; url?: string }
export type WallpaperFavorite = {
  id: string; sourceId: string; title: string; thumbUrl: string; imageUrl: string
}
export const DEFAULT_WALLPAPER_SOURCES: WallpaperSource[] = [
  { id: 'bing', kind: 'bing', name: '必应' },
  { id: 'wallhaven', kind: 'wallhaven', name: 'Wallhaven' },
]
export const MAX_WALLPAPER_CATALOG_SOURCES = 5
export const MAX_WALLPAPER_FAVORITES = 100
export function sanitizeWallpaperSources(values: unknown): WallpaperSource[]
export function sanitizeWallpaperFavorites(values: unknown): WallpaperFavorite[]
```

`resolveThemeSettings`: if `wallpaperSources` is an array (including `[]`), sanitize it; else seed `DEFAULT_WALLPAPER_SOURCES` plus catalogs migrated from `wallpaperCatalogUrls` (name = hostname). Do not re-seed when the array is empty.

Keep old Zod keys with defaults so old yaml still parses. New keys: `wallpaperSources`, `wallpaperFavorites`.

- [ ] **Step 1: Failing tests**

```ts
it('seeds bing and wallhaven when wallpaperSources is omitted', () => {
  const resolved = resolveThemeSettings({
    ...DEFAULT_THEME_SETTINGS,
    wallpaperSources: undefined as never,
  } as ThemeSettings)
  // If ThemeSettings requires the field, call resolve with a partial via the Host parse path.
})
```

Use the same style as existing Host-omit tests. Concrete cases:

1. Parsed section **without** `wallpaperSources` → ids `bing`, `wallhaven`.
2. `wallpaperSources: []` → stays `[]`.
3. Old `wallpaperCatalogUrls: ['https://example.com/a.json']` and omitted sources → third source `kind: 'catalog'`, `url` that href, `name` `example.com`.
4. Two bing rows in input → one bing.
5. Sixth catalog dropped.
6. 101 favorites → 100.
7. catalog without https url dropped.

- [ ] **Step 2: RED** — `pnpm exec vitest run packages/client/ui-theme/tests/theme.client.spec.ts` (or the file you added). Expected: FAIL missing functions/fields.

- [ ] **Step 3: Implement** sanitize + Zod + resolve + store snapshot fields + ThemeRuntime writers that `queueWrite` the new fields. `setWallpaperSources` replaces the list (already sanitized). `setWallpaperFavorites` replaces the list.

- [ ] **Step 4: GREEN** — same vitest. Also update `boot-theme.client.spec.ts` fixtures that construct full ThemeSettings.

---

### Task 2: Main-process Bing year + Wallhaven

**Files:**
- Modify: `src/main/wallpaper-catalog.js`, `src/main/wallpaper-catalog.test.js`

**Interfaces:**
- Change `listWallpaperCatalog(options)` to:

```js
listWallpaperCatalog({
  kind, // 'bing' | 'wallhaven' | 'catalog'
  year, // bing archive, integer
  url,  // catalog
  q,    // wallhaven
  categories, // '100' | '010' | '001'
  page, // wallhaven, default 1
})
```

Legacy `{ includeBing, catalogs }` may be removed in this task (only desktop gallery will call it after Task 3–5). If a test still uses the old shape, update those tests in this task.

Bing today (`kind === 'bing'` && no year): existing two HPImageArchive URLs; set item `source` to `'bing'`.

Bing year: GET `https://bing.npanuhin.me/CN-zh.${year}.json` (array). Map `{ date, title, copyright, bing_url, url }` → item `id: bing-${date}`, `imageUrl`/`thumbUrl` from allowed `bing_url` else `url`, `source: 'bing'`. Cap 500.

Wallhaven: GET `https://wallhaven.cc/api/v1/search?purity=100&categories=${categories||'100'}&sorting=toplist&atleast=1920x1080&page=${page||1}` plus `q` if non-empty. Ignore any purity in options. Map `data[]`: `id: wallhaven-${id}`, `thumbUrl: thumbs.large || thumbs.small`, `imageUrl: path`, `title: id`, `source: 'wallhaven'`. Return `{ items, nextPage?: number }` when `meta.current_page < meta.last_page`.

Catalog: existing parse; `source` = catalog url or pass-through.

- [ ] **Step 1: Failing tests** in `wallpaper-catalog.test.js` with `withHttp` + `DSHD_WALLPAPER_ALLOW_HTTP=1` and env override for archive/search base if you add `DSHD_BING_ARCHIVE_URL` / `DSHD_WALLHAVEN_SEARCH_URL` (recommended so tests never hit the network). If you add env overrides, production defaults remain the two URLs in the spec.

```js
test('listWallpaperCatalog wallhaven hardcodes purity=100', async () => {
  // server records request url; return { data: [{ id: 'ab', path: `${origin}/full.jpg`, thumbs: { large: `${origin}/t.jpg` } }], meta: { current_page: 1, last_page: 2 } }
  const result = await listWallpaperCatalog({ kind: 'wallhaven', categories: '010', q: 'lake' })
  assert.match(recordedUrl, /purity=100/)
  assert.doesNotMatch(recordedUrl, /purity=111/)
  assert.equal(result.items[0].id, 'wallhaven-ab')
  assert.equal(result.nextPage, 2)
})

test('listWallpaperCatalog bing year maps archive json', async () => {
  // GET /CN-zh.2024.json → [{ date: '2024-01-16', title: 'T', copyright: 'C', url: `${origin}/a.jpg` }]
})
```

- [ ] **Step 2: RED** from repo root: `node --test src/main/wallpaper-catalog.test.js`

- [ ] **Step 3: Implement** fetch + map. Keep 4MB/500/stream-cap.

- [ ] **Step 4: GREEN** — existing 15 tests plus new ones all PASS.

---

### Task 3: IPC and preload query

**Files:**
- Modify: `src/main/ipc.js` `shell:list-wallpaper-catalog`
- Modify: `src/preload/index.js` (only the wallpaper invoke — do not restyle unrelated handlers)
- Modify: `wallpaper-shell.ts` + `wallpaper-shell.client.spec.ts`

**Interfaces:**

```ts
listWallpaperCatalog: (query: {
  kind: 'bing' | 'wallhaven' | 'catalog'
  year?: number
  url?: string
  q?: string
  categories?: '100' | '010' | '001'
  page?: number
}) => Promise<{ items?: WallpaperCatalogItem[]; warning?: string; nextPage?: number }>
```

IPC: pass the object through; coerce `kind` to one of the three strings; numbers as numbers.

- [ ] **Step 1: Fail shell spec** if it still types `includeBing`. Update assertions to the query object.

- [ ] **Step 2: RED**

- [ ] **Step 3: Wire ipc + types**

- [ ] **Step 4: GREEN** wallpaper-shell spec + any preload test that lists the API.

---

### Task 4: Gallery-window source CRUD

**Files:**
- Move source list into `WallpaperGalleryModal.tsx` (or keep `WallpaperSources.tsx` as a child of the gallery Modal only).
- `AppearanceSection.tsx`: do **not** mount a source list. Wallpaper row only.
- `locales.ts`: add/edit/delete/type labels.
- Gallery / appearance specs: replace Bing-switch and raw URL tests; assert Appearance has no 图源 heading.

**UI:** gallery title bar has 图源. That pane lists rows (name, type, 编辑, 删除). 新增 opens a stacked Modal: type select (disable bing/wallhaven if already present), name, catalog URL if catalog. 编辑 Modal. Delete immediately.

Copy (zh / en lockstep), examples:

- `wallpaper.sources`: `图源` / `Sources`
- `wallpaper.addSource`: `新增图源` / `Add source`
- `wallpaper.editSource`: `编辑图源` / `Edit source`
- `wallpaper.sourceKindBing`: `必应` / `Bing`
- `wallpaper.sourceKindWallhaven`: `Wallhaven` / `Wallhaven`
- `wallpaper.sourceKindCatalog`: `目录` / `Catalog`
- `wallpaper.sourceExists`: `已经添加过这个图源。` / `That source is already added.`

- [ ] **Step 1: Tests**

```tsx
it('adds, edits, and deletes a catalog source', () => {
  const b = mount('system', {}, { listWallpaperCatalog, downloadWallpaper })
  fireEvent.click(screen.getByRole('button', { name: '新增图源' }))
  // choose 目录, name 我的, url https://example.com/pack.json, save
  expect(b.setWallpaperSources).toHaveBeenCalledWith(expect.objectContaining({
    wallpaperSources: expect.arrayContaining([
      expect.objectContaining({ kind: 'catalog', url: 'https://example.com/pack.json' }),
    ]),
  }))
})
```

Pin: Appearance has no 图源 list. No Bing switch. URL lives in the add Modal inside the gallery. Default seeded names 必应 / Wallhaven appear in the gallery 图源 pane.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement CRUD** calling `setWallpaperSources({ wallpaperSources: next })` with sanitized lists from Task 1 helpers imported from `theme-settings.ts`.

- [ ] **Step 4: GREEN** gallery source tests. Appearance still has no 图源 list. Existing wallpaper slider tests still pass.

---

### Task 5: Gallery window — tabs, chips, search, grid

**Files:**
- `WallpaperGalleryModal.tsx`, `WallpaperRow.tsx`, CSS module, locales, appearance spec.

**Behavior:** Opening browse does **not** merge every source. It opens the Modal, selects the first source tab (or 收藏 if none), and calls `listWallpaperCatalog` with that query. Bing chips: 今日 + years `new Date().getFullYear()` down 7 more. Wallhaven chips: 常规/动漫/人物. Search: bing/catalog filter client-side; wallhaven passed as `q` (debounce 300ms). `referrerPolicy="no-referrer"`. Generation token on list like today’s download token.

- [ ] **Step 1: Test**

```tsx
it('lists bing today when the gallery opens', async () => {
  const listWallpaperCatalog = vi.fn(async () => ({
    items: [{ id: 'bing-1', title: '晨湖', copyright: '©', thumbUrl: 'https://example.com/t.jpg', imageUrl: 'https://example.com/f.jpg', source: 'bing' }],
  }))
  mount('system', { wallpaperSources: DEFAULT_WALLPAPER_SOURCES }, { listWallpaperCatalog, downloadWallpaper: vi.fn() })
  fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
  await screen.findByRole('button', { name: /晨湖/ })
  expect(listWallpaperCatalog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bing' }))
})

it('requests wallhaven with purity-safe categories when that tab is selected', async () => {
  // click Wallhaven tab → listWallpaperCatalog({ kind: 'wallhaven', categories: '100', page: 1 })
})
```

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement Modal chrome + WallpaperRow fetch.** Clicking a card in this task may still download (old behavior) until Task 7; or disable card activate until Task 7 if easier — **prefer leaving click as a no-op except star until Task 7** so Task 7’s confirm test is RED for the right reason. If you leave old download-on-click, Task 7 must replace it.

- [ ] **Step 4: GREEN**

---

### Task 6: Favorites

**Files:** `WallpaperGalleryModal.tsx`, `WallpaperRow.tsx` or Appearance wiring `setWallpaperFavorites`, appearance spec.

Star on each card (aria-pressed). 收藏 tab shows `wallpaperFavorites`. Toggle writes the sanitized list (max 100).

- [ ] **Step 1: Test** click star on 晨湖 → `setWallpaperFavorites` with that item; open 收藏 → card present without a new listWallpaperCatalog for favorites.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement**

- [ ] **Step 4: GREEN**

---

### Task 7: Confirm then crop

**Files:** gallery Modal or a small confirm Modal in WallpaperRow; appearance spec.

Click card (not the star) → dialog 「将这张图设为背景？」 buttons 设为壁纸 / 取消. 取消: no download. 设为壁纸: `downloadWallpaper` then crop (existing crop Modal + JPEG bake). Keep download generation token on gallery close.

- [ ] **Step 1: Test** click 晨湖 → confirm visible; 取消 → `downloadWallpaper` not called; click again → 设为壁纸 → download + crop dialog `裁剪背景图`. Close gallery during download → no crop (existing race).

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement**

- [ ] **Step 4: GREEN** plus cancel-during-download pin from round-3.

---

### Task 8: Agent Note, README, pairing

**Files:**
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md` (+ zh + sidecar)
- ui-theme `README.md` / `README.zh.md` Known Limitations

Present tense. Describe the window, source CRUD, Bing+Wallhaven SFW, migrate-once, favorites. No “previously / round”.

- [ ] **Step 1: Edit notes + README**
- [ ] **Step 2: Pairing** from `vendor/deepseek-harness`:

```sh
pnpm run verify-translation-pairing -- --write .agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md
pnpm run verify-translation-pairing -- .agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md
pnpm run verify-agent-note-format
```

If README pairing is required by the package, write both locales in the same change.

- [ ] **Step 3: Sweep**

Repo root: `node --test src/main/wallpaper-catalog.test.js`

`vendor/deepseek-harness`:

```sh
pnpm exec vitest run packages/client/ui-theme/tests/appearance-section.client.spec.tsx packages/client/ui-theme/tests/theme.client.spec.ts packages/client/ui-theme/tests/wallpaper-shell.client.spec.ts packages/client/ui-theme/tests/wallpaper.client.spec.ts packages/client/ui-theme/tests/settings-store.client.spec.ts packages/client/ui-theme/tests/wallpaper-crop-modal.client.spec.tsx
```

Expected: all PASS.

---

## Spec coverage

| Spec decision | Task |
|---|---|
| Browse window categories + search + grid | 5 |
| Favorite | 6 |
| Confirm then crop | 7 |
| Settings add/edit/delete sources | 4 |
| Bing today + year archive | 2, 5 |
| Wallhaven SFW only | 2 |
| Named HTTPS catalogs | 1, 2, 4 |
| Host persist sources + favorites | 1 |
| Migrate old URLs once; empty list stays empty | 1 |
| Agent Note / README | 8 |

## Placeholder scan

No TBD. Env overrides for archive/search bases are specified in Task 2 so tests stay keyless and offline.

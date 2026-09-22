# Agent Note: Wallpaper gallery and crop

Status: implemented

English | [中文](2026-08-18-wallpaper-gallery-and-crop.zh.md)

## Problem

Appearance stored an optional wallpaper as a data URL with frost and pixelate sliders. A local file write used CSS `object-fit: cover` at paint time, so the user could not choose which region survived, and there was no in-app catalog. Third-party wallpaper APIs that require keys, hotlinking, or HTML gallery pages do not match the existing Host data-URL cap or the desktop fetch rules.

## Decision

**Browse opens a gallery Modal, not a second Electron window.** Appearance keeps pick / browse / crop / frost / pixelate. Source add / edit / delete lives inside the gallery under 图源. Category tabs are the persisted `wallpaperSources` names plus a fixed Favorites tab. Search sits beside the tabs. Cards show a star and open a confirm dialog before download; yes runs `downloadWallpaper` then the existing crop Modal.

**Host `ui-theme` owns `wallpaperSources` and `wallpaperFavorites`.** Built-in kinds are `bing` and `wallhaven` (at most one each). Custom sources are named HTTPS JSON catalogs (`kind: catalog`, at most five). Favorites store up to 100 `{ id, sourceId, title, thumbUrl, imageUrl }` rows. When Host omits `wallpaperSources`, resolve seeds Bing + Wallhaven and migrates old `wallpaperCatalogUrls` into catalog rows; an explicit empty array stays empty. Old `wallpaperBingEnabled` is ignored after migrate. `dsh web` without `window.shell` hides Browse and source CRUD.

**Desktop main process lists one source at a time.** `listWallpaperCatalog({ kind, year?, url?, q?, categories?, page? })` fetches Bing today (two HPImageArchive pages), Bing year archives (`CN-zh.{year}.json`), Wallhaven search with `purity=100` hardcoded (SFW only; no API key), or a custom catalog URL. Caps: 4MB JSON, 500 items per source, 12MB image, at most four redirects with `Location` re-checked, no cookies. Thumbs use `<img referrerPolicy="no-referrer">`; crop sources always go through `downloadWallpaper`. Bing chips are Today plus the last eight years; Wallhaven chips are general / anime / people; Wallhaven search is debounced into `q` and supports Load more via `nextPage`.

**Every persist path crops to the current window aspect.** Local file pick and a confirmed gallery pick open the same crop dialog (pan, wheel/slider zoom, mask locked to `window.innerWidth / innerHeight`). Confirm stays disabled until the preview `load` reports a natural size; a window `resize` updates the mask. Confirm bakes JPEG through `cropWallpaper` then `setWallpaper`; a failed crop keeps the dialog and does not write the uncropped source. Closing the gallery bumps a download session token so a late download does not open crop.

This extends the Appearance extras in the [theme-family Appearance system](2026-08-14-theme-family-appearance-system.md). The gallery fields ride the same Host `ui-theme` section as the other Appearance extras ([Host-backed preferences](../bug-fix/2026-08-06-host-backed-web-preferences.md)). The baked JPEG still obeys the [canvas solidity and data-URL cap](../bug-fix/2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.md).

## Alternatives considered

**Unsplash / Pexels / Pixabay as built-in sources.** Rejected: those APIs want developer keys and hotlinked originals rather than a baked data URL.

**Timeline / partner galleries with login, cookies, or R18.** Rejected: fetch carries no cookies, Wallhaven stays SFW-only, and originals must become a data URL without a third-party paywall.

**Hotlink the catalog `imageUrl` as the wallpaper layer.** Rejected: the Host document already stores a data URL with a size cap; a live remote URL would CORS-taint canvas, break offline, and skip the crop bake.

**A second Electron window or a marketplace settings tab.** Rejected: the product surface is Appearance `settings.section` id `appearance`, using `ui-primitives` and `--dsw-alias-*`.

## Consequences

Desktop Appearance can browse Bing, Wallhaven (SFW), and up to five named HTTPS catalogs, star favorites, search the active tab, confirm, then crop before save. Plain `dsh web` keeps local pick and crop only. A bad list query warns on that tab without merging other sources. Adult feeds and third-party API keys stay out.

## Testing

Desktop `wallpaper-catalog.test.js` pins Bing today, Bing year archive mapping, Wallhaven `purity=100` and `nextPage`, catalog parse, byte and item caps, and redirect rules. `appearance-section.client.spec.tsx` pins Appearance without a source list, gallery-window source CRUD, open → Bing list, Wallhaven tab query, client-side Bing search filter, star → Favorites tab, confirm cancel without download, confirm yes → download + crop, local pick → crop, cancel paths, and download-after-close race. `wallpaper-crop-modal.client.spec.tsx` pins cancel while crop stays open. `theme.client.spec.ts` and settings-store specs pin source/favorite sanitize, seed, empty-array non-reseed, and migrate. `apply.client.spec.ts` pins desktop inject of source and favorite writers when the shell is present.

## Related

- [Theme-family Appearance system](2026-08-14-theme-family-appearance-system.md)
- [Host-backed Web preferences](../bug-fix/2026-08-06-host-backed-web-preferences.md)
- [Appearance nav contrast and wallpaper canvas cap](../bug-fix/2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.md)

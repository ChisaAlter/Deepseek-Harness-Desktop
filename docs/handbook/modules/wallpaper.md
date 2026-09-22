# 模块：壁纸与外观桥接

## 职责与非目标

**职责：** Appearance 壁纸行 + 图库窗 + 无图时的「背景特效」block；main 提供 catalog / download。
**非目标：** Appearance 上堆图源列表；Unsplash 等禁源；独立市场风窗口。

## 用户路径

见 [../flows/wallpaper-set.md](../flows/wallpaper-set.md)。契约正文以 Feature Card 为准，本章不双写长文。

## 架构要点

- 持久化在 Host `ui-theme`（图源、收藏、图片 data URL）。
- Desktop：`wallpaper-catalog.js` → `listWallpaperCatalog` / `downloadWallpaper`。

## 实现入口

- UI：`ui-theme` `WallpaperRow` / `WallpaperGalleryModal` / `WallpaperSources` / `BackgroundEffectRow` / `CursorEffectRow`
- Main：`src/main/wallpaper-catalog.js`
- Card：[../../features/wallpaper-gallery.md](../../features/wallpaper-gallery.md)、[../../features/background-gradient.md](../../features/background-gradient.md)、[../../features/cursor-effects.md](../../features/cursor-effects.md)

## 不变量

- 同 Feature Card + [.cursor/rules/wallpaper-gallery-product.mdc](../../../.cursor/rules/wallpaper-gallery-product.mdc)

## 门槛

- QA：`TC-APP-002` … `TC-APP-010`
- 单测：`ui-theme` appearance-section；`wallpaper-catalog.test.js`

## 延伸阅读

- [../superpowers/specs/2026-08-19-wallpaper-gallery-window-design.md](../../superpowers/specs/2026-08-19-wallpaper-gallery-window-design.md)

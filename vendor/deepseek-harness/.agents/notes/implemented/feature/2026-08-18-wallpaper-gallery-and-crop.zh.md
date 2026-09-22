# Agent Note: 壁纸图库与裁剪

Status: implemented

[English](2026-08-18-wallpaper-gallery-and-crop.md) | 中文

## 问题

外观页把可选背景图存成 data URL，并提供毛玻璃和像素化滑杆。本地选图在绘制时靠 CSS `object-fit: cover` 覆盖裁切，用户无法选择留下哪一块，应用内也没有图库。需要密钥、热链原图或 HTML 画廊页的第三方壁纸 API，对不上现有 Host data URL 上限，也不符合桌面拉取规则。

## 决策

**浏览打开图库 Modal，不开第二个 Electron 窗口。** 外观页只留选择图片、浏览图库、裁剪、毛玻璃、像素化。图源的新增／编辑／删除在图库标题栏「图源」里。分类页签是持久化的 `wallpaperSources` 显示名，外加固定「收藏」。搜索在页签旁。卡片带星标；点图先确认再下载，确认后走 `downloadWallpaper` 再打开现有裁剪对话框。

**Host `ui-theme` 拥有 `wallpaperSources` 与 `wallpaperFavorites`。** 内置种类是 `bing` 与 `wallhaven`（各最多一条）。自定义源是具名 HTTPS JSON 目录（`kind: catalog`，最多五条）。收藏最多 100 条 `{ id, sourceId, title, thumbUrl, imageUrl }`。Host 省略 `wallpaperSources` 时解析预置必应 + Wallhaven，并把旧 `wallpaperCatalogUrls` 迁成 catalog；显式空数组保持为空。迁入后忽略旧 `wallpaperBingEnabled`。没有 `window.shell` 的普通 `dsh web` 不显示浏览和图源 CRUD。

**桌面主进程按单个图源列表。** `listWallpaperCatalog({ kind, year?, url?, q?, categories?, page? })` 拉取必应今日（两页 HPImageArchive）、必应年份归档（`CN-zh.{year}.json`）、写死 `purity=100` 的 Wallhaven 搜索（仅 SFW，不要 API key），或自定义目录 URL。上限：JSON 4MB、每源 500 条、原图 12MB、最多四次重定向并复核 `Location`、不带 cookie。缩略图用 `<img referrerPolicy="no-referrer">`；裁剪源一律经 `downloadWallpaper`。必应子分类是「今日」加最近八年；Wallhaven 子分类是常规／动漫／人物；Wallhaven 搜索防抖写入 `q`，并用 `nextPage` 做「加载更多」。

**每条持久化路径都按当前窗口比例裁剪。** 本地选图与确认后的图库选图打开同一个裁剪对话框（平移、滚轮／滑杆缩放，遮罩锁定为 `window.innerWidth / innerHeight`）。确认按钮在预览 `load` 给出自然尺寸之前保持禁用；窗口 `resize` 会更新遮罩。确认后经 `cropWallpaper` 烘焙 JPEG，再走 `setWallpaper`；裁剪失败时对话框留下，不写入未裁原图。关闭图库会抬高下载会话令牌，迟到的下载不会打开裁剪。

这是对[主题家族外观系统](2026-08-14-theme-family-appearance-system.zh.md)里 Appearance 附加项的延伸。图库字段与其他 Appearance 附加项同写 Host `ui-theme` 分节（[Host settings 支撑的偏好](../bug-fix/2026-08-06-host-backed-web-preferences.zh.md)）。烘焙出的 JPEG 仍遵守[画布实心度与 data URL 上限](../bug-fix/2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.zh.md)。

## 曾考虑的替代方案

**把 Unsplash／Pexels／Pixabay 做成内置源。** 否决：那些 API 要开发者 Key，并要求热链原图，而不是烘焙 data URL。

**带登录、cookie 或 R18 的 Timeline／合作画廊。** 否决：拉取不带 cookie，Wallhaven 保持仅 SFW，原图必须变成 data URL，不能依赖第三方付费墙。

**把目录 `imageUrl` 热链成壁纸层。** 否决：Host 文档已经按带上限的 data URL 存储；活的远程 URL 会污染 canvas CORS、离线失效，并跳过裁剪烘焙。

**再开一个 Electron 窗口，或放进插件市场设置页。** 否决：产品面是 Appearance `settings.section`（`id: appearance`），只用 `ui-primitives` 和 `--dsw-alias-*`。

## 后果

桌面外观页可以浏览必应、Wallhaven（SFW）和最多五个具名 HTTPS 目录，收藏、搜索当前页签，确认后再裁剪保存。普通 `dsh web` 只保留本地选图和裁剪。列表失败只警告当前页签，不合并其它源。不提供成人源和第三方 API key。

## 测试

桌面 `wallpaper-catalog.test.js` 钉住必应今日、必应年份归档映射、Wallhaven `purity=100` 与 `nextPage`、目录解析、字节与条目上限，以及重定向规则。`appearance-section.client.spec.tsx` 钉住外观页无图源列表、图库内图源 CRUD、打开即拉必应、Wallhaven 页签查询、必应客户端搜索过滤、星标进收藏页、确认取消不下载、确认后下载并裁剪、本地选图裁剪、取消路径，以及关闭后迟到下载竞态。`wallpaper-crop-modal.client.spec.tsx` 钉住裁剪仍打开时取消。`theme.client.spec.ts` 与 settings-store 规格钉住图源／收藏 sanitize、预置、空数组不回种与迁入。`apply.client.spec.ts` 钉住有 shell 时注入图源与收藏写入。

## 相关

- [主题家族外观系统](2026-08-14-theme-family-appearance-system.zh.md)
- [Host settings 支撑的 Web 偏好](../bug-fix/2026-08-06-host-backed-web-preferences.zh.md)
- [外观导航对比度与壁纸画布上限](../bug-fix/2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.zh.md)
